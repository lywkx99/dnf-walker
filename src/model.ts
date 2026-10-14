// TRACK-DNF walker 的示意模型（不是定量模拟）。
// DNF 画成一颗表面崎岖的小星球（丘陵、山脊、陨坑、跳台、折叠区、吸附井、晶体柱），H1 位点撒在地表上。
// 结合规则：腿只能和“够得到的、还没用过”的 H1 结合；结合一段时间后 H2 把腿置换下来，这个 H1 被打开，不能再用。
// 驱动规则：想达到的速度取决于同时结合的腿数——太少抓不牢（打滑）；适中最顺；太多会被“钉住”（多条腿同时成双链造成的固定）。
// 自陷：纳米花表面是折叠的，在拓扑受限、产物富集的折叠区（游戏里的“自陷区”）walker 会被物理卡住。
// （稿件把自陷、多条腿同时成双链造成的固定、非特异性相互作用等列为周转变慢的候选原因，没有定论；这里是示意。）
// 物理：重力指向星球中心；腿像悬挂一样把球托在地表上方（弹簧 + 阻尼，落地会晃几下）；结合的腿把球往下拽；
// 冲出跳台会腾空，腾空时腿够不着位点；落回足够近时腿重新抓住位点（LATCH）；撞到晶体柱会弹开；松开油门靠惯性滑行。
import * as THREE from 'three'

export type Density = 'LT' | 'MT' | 'HT'

// 三档对应稿件的低 / 中 / 高密度轨道：环形模板锚定间隔 85 / 53 / 27 nt。spacing 是画面里位点的间距（示意单位）。
export const DENSITY: Record<Density, { spacing: number; code: string; nt: number }> = {
  LT: { spacing: 1.7, code: 'LT', nt: 85 },
  MT: { spacing: 1.2, code: 'MT', nt: 53 },
  HT: { spacing: 0.85, code: 'HT', nt: 27 },
}

export const PLANET_R = 36 // DNF 星球半径（地表起伏另加）
export const LEG_REACH = 1.75 // 腿能抓住位点的距离（球心到发夹顶端）
export const LEG_BREAK = 2.05 // 超过这个距离，结合的腿被扯断
export const MAX_LEGS = 14 // 同时结合的腿数上限
export const OPT_LEGS = 7 // 走得最顺时的结合腿数
export const TRAP_LEGS = 9 // 结合的腿达到这个数就开始被“钉住”（多条腿同时成双链造成的固定）
export const V_MAX = 12 // 驱动能达到的最快速度（第七版从 9.5 提到 12）
const K = 3.4 / V_MAX // 置换和自陷按速度同倍加快（第一版速度 3.4）
export const TRAP_UP = 0.5 / K // 腿 ≥ TRAP_LEGS 时陷进去的速度（第六版从 0.3 加到 0.5）
export const TRAP_DOWN = 0.035 / K // 腿少下来后恢复的速度（第六版从 0.06 降到 0.035）
export const SLIP = 0.25 // 抓不牢时的驱动速度（相对 V_MAX）
export const TURN = 2.2 // 转向速度（弧度/秒）
export const WALKER_R = 0.55 // AuNP 半径
export const HOVER = 1.0 // 静止时球心离地表的高度（腿撑着）
export const STEM = 0.45 // H1 茎的高度
export const GRAVITY = 10
const SUSP_K = 70 // 悬挂刚度
const SUSP_C = 7 // 悬挂阻尼（偏小：落地会弹几下）
const AIR_GAP = HOVER + 0.3 // 球心离地超过这个高度算腾空
const TETHER_PULL = 3 // 每条结合的腿往下拽的力度
const RESTITUTION = 0.3 // 球砸到地面的反弹系数
const BOUNCE_CRYSTAL = 0.6 // 撞晶体柱的反弹系数
const BOOST_ACC = 11 // 冲刺台坡面上的额外推力
const BOOST_CAP = 1.25 // 冲刺台上能加到的最快速度（相对 V_MAX）
const LAUNCH_UP = 1.3 // 冲出冲刺台那一刻额外的向上速度
const LAUNCH_FWD = 1.0 // 以及额外的向前速度
const SPEED_CAP = 1.5 // 平时的限速（相对 V_MAX）；空中和冲刺台落地后放宽到 1.9
const CARRY_MAX = 5 // 冲刺台落地后保留惯性多久（秒）：期间超速部分掉得慢、贴地掠过、置换随车速加快、自陷区外不累积自陷
const CARRY_DECEL = 0.8 // 这段时间里超速的部分每秒掉这么多（平时是 3）
const CARRY_DOWN = 25 // 惯性保留期间离地时额外往下压（高速贴地掠过，腿一直够得着位点）
const CARRY_TURN = 1.3 // 惯性保留期间置换至少加快到这个倍数（高速翻滚时腿周转更快）
const TURN_AIR = 0.5 // 空中转向的速度（相对地面）
const AIR_CONTROL = 1 // 空中转向时，速度方向跟着转的比例（用来躲开落点的障碍；1 = 完全跟着转，落地不会侧滑损失速度）
// 非特异性吸附（吸附井）：靠近被往中心吸；在井里贴地（或贴着井面低空掠过）会慢慢沾上，沾到一定程度、
// 或者冲进井中心那一圈，黏丝一下子粘满（held）；粘住后按住前进一下一下挣断黏丝（不再长新的），
// 挣脱后有一小段时间不会再被粘、吸力也减弱，用来滚出去
const WELL_PULL = 11 // 往井中心的吸力（井半径一半处最强）
const STICK_UP = 2.0 // 在井里沾上的速度（越靠中心越快）
const CATCH_CORE = 0.55 // 进到井半径的这个比例以内就直接粘满（速度再快也一样）
const CATCH_LOW = 1.0 // 离井面低于“悬停高度 + 这个值”都算贴着井面（低空掠过也会被粘）
const STICK_DOWN = 1.5 // 出了井（或刚挣脱）黏丝松开的速度
const CATCH_AT = 0.35 // 沾到这个程度就被粘满
const STRUGGLE = 2.5 // 按住前进时每秒挣断几根黏丝
const SNAP_DROP = 0.12 // 每挣断一根，粘住程度降多少
const FREE_AT = 0.2 // 降到这个程度就挣脱了
const FREE_T = 3 // 挣脱后多久不会再被粘（秒）
const LURCH = 2.2 // 挣断一根时往前一冲的速度
const TRAP_SLOW = 0.8 // 被卡住 / 钉住时置换变慢（×(1 − TRAP_SLOW×程度)）：颗粒动不了，H2 也不容易把腿置换下来
const TRAP_SPEED = 0.6 // 被卡住 / 钉住时驱动变慢（×(1 − TRAP_SPEED×程度)）
// 自陷区（折叠区：拓扑受限、产物富集，位点加密）：贴地进去就开始被物理卡住（不管速度、不管腿数），进去就打断冲刺台的惯性保留；
// 卡住 / 钉住时腿额外刹车，在区里还有额外阻力——高速也冲不过去
const TRAP_BRAKE = 6 // 被卡住 / 钉住时额外的刹车（×程度）
const ZONE_DRAG = 1.6 // 在自陷区里被卡住时的额外阻力（×程度）
// H2 燃料：捡到那一下往前推一把，之后一段时间里跑得更快、置换也更快（燃料链多，腿被置换得快，walker 走得快）
const FUEL_T = 8 // 持续时间（秒）
const FUEL_RESPAWN = 25 // 被捡走后多久重新出现（秒）
const FUEL_BOOST = 1.8 // 置换加快的倍数
const FUEL_SPEED = 1.25 // 驱动能达到的速度提高的倍数
const FUEL_KICK = 0.35 // 捡到那一下往前推的速度（相对 V_MAX）
const FUEL_R = 1.7 // 离燃料多近算捡到
// 砸地：腾空够久的落地会震开落点周围一圈还没用过的发夹；飞得越高、越远，冲击圈越大
const SLAM_AIR = 0.5 // 腾空超过这么久才算砸地（秒）
const SLAM_R0 = 0.8 // 冲击圈的起始半径
const SLAM_H = 0.35 // 跃升高度每 1 单位，半径加多少
const SLAM_D = 0.06 // 飞行距离每 1 单位，半径加多少
const SLAM_RMAX = 5.5 // 冲击圈最大半径
// 撞晶体柱：冲击速度超过 CRASH_V 算一次撞车（扣分在游戏里做），之后 CRASH_CD 秒内不重复算
const CRASH_V = 1.0
const CRASH_CD = 1.0

// 结合腿数 → 相对速度：在 OPT_LEGS 处最快（=1），两边都下降
export function relSpeed(legs: number) {
  if (legs <= 0) return 0
  const x = legs / OPT_LEGS
  return Math.pow(x, 1.5) * Math.exp(1.5 * (1 - x))
}

// ---------------------------------------------------------------- 噪声
function hash(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}
export function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = x - ix, fy = y - iy, fz = z - iz
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash(ix, iy, iz), hash(ix + 1, iy, iz), u), l(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v),
    l(l(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u), l(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v),
    w,
  )
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- 地形
// 地形特征：陨坑（坑底下凹、坑沿隆起，冲出坑沿能起跳）、跳台（缓坡起、陡坎落，冲上去会飞）、
// 搓板路（一片细密的鼓包，球会一路颠簸）、晶体柱（障碍物，撞上会弹开）。
// 出生点正前方的大圆上专门摆了一串跳台：一直往前开就能连续起飞。
type V3 = THREE.Vector3
export type Crater = { c: V3; r: number; depth: number; rim: number }
export type Ramp = { c: V3; f: V3; s: V3; H: number; L: number; W: number }
export type Mogul = { c: V3; r: number } // 折叠区 = 自陷区：纳米花折叠出的崎岖沟槽，拓扑受限、产物富集（位点加密 3 倍，见 makeSites）
export type Crystal = { c: V3; rc: number; hc: number; base: number; tilt: number; spin: number; hue: number }
export type Well = { c: V3; r: number; depth: number } // 吸附井（非特异性吸附）：光滑的碗
export type Fuel = { c: V3; p: V3 } // H2 燃料：p 是漂在地表上方的位置（星球局部坐标）
export const START = new THREE.Vector3(0, 1, 0)
export const START_HEADING = new THREE.Vector3(0, 0, 1)

function randomDir(r: () => number, out: V3) {
  const y = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - y * y)
  return out.set(Math.cos(t) * s, y, Math.sin(t) * s)
}
function tangentAt(c: V3, r: () => number) {
  const a = new THREE.Vector3(-c.z, 0, c.x)
  if (a.lengthSq() < 1e-6) a.set(1, 0, 0)
  a.normalize()
  const b = new THREE.Vector3().crossVectors(c, a)
  const t = r() * Math.PI * 2
  return a.multiplyScalar(Math.cos(t)).addScaledVector(b, Math.sin(t)).normalize()
}

function buildTerrain(seed: number) {
  const r = rng(seed)
  const R = PLANET_R
  const craters: Crater[] = [], ramps: Ramp[] = [], moguls: Mogul[] = [], crystals: Crystal[] = [], wells: Well[] = [], fuels: Fuel[] = []
  const taken: { c: V3; ang: number }[] = []
  const free = (c: V3, ang: number) => c.dot(START) < Math.cos(9 / R) && taken.every((t) => c.angleTo(t.c) > ang + t.ang)
  const place = (ang: number) => {
    for (let k = 0; k < 200; k++) {
      const c = randomDir(r, new THREE.Vector3())
      if (free(c, ang)) {
        taken.push({ c, ang })
        return c
      }
    }
    return null
  }
  // 出生点正前方的一串跳台
  for (const s of [16, 44, 78]) {
    const a = s / R
    const c = new THREE.Vector3(0, Math.cos(a), Math.sin(a))
    const f = new THREE.Vector3(0, -Math.sin(a), Math.cos(a))
    ramps.push({ c, f, s: new THREE.Vector3().crossVectors(c, f), H: 1.7, L: 4.6, W: 1.9 })
    taken.push({ c, ang: 5 / R })
  }
  for (let k = 0; k < 9; k++) {
    const rr = 3.5 + r() * 2
    const c = place(rr * 1.8 / R)
    if (c) craters.push({ c, r: rr / R, depth: 0.9 + r() * 0.4, rim: 0.5 + r() * 0.3 })
  }
  for (let k = 0; k < 24; k++) {
    const c = place(5 / R)
    if (!c) continue
    const f = tangentAt(c, r)
    ramps.push({ c, f, s: new THREE.Vector3().crossVectors(c, f), H: 1.4 + r() * 0.6, L: 4.2 + r() * 0.8, W: 1.6 + r() * 0.5 })
  }
  for (let k = 0; k < 5; k++) {
    const c = place(6 / R)
    if (c) moguls.push({ c, r: 6 / R })
  }
  for (let k = 0; k < 4; k++) {
    const c = place(6 / R)
    if (c) wells.push({ c, r: 4.4 / R, depth: 1.1 })
  }
  for (let k = 0; k < 40; k++) {
    const rc = 0.45 + r() * 0.4
    const c = place(1.2 / R)
    if (c) crystals.push({ c, rc, hc: 2.2 + r() * 2.4, base: 0, tilt: (r() - 0.5) * 0.3, spin: r() * Math.PI, hue: r() })
  }
  for (let k = 0; k < 22; k++) {
    const c = place(1.6 / R)
    if (c) fuels.push({ c, p: c.clone() })
  }
  return { craters, ramps, moguls, crystals, wells, fuels }
}

export const TERRAIN = buildTerrain(20261014)

// 上一次 terrainH 算出的各成分（给地表上色用）
export const TERRAIN_PARTS = { ramp: 0, crater: 0, rim: 0, mogul: 0, ridge: 0, well: 0 }

// 地表高度（输入是单位方向向量）
export function terrainH(x: number, y: number, z: number) {
  const R = PLANET_R
  const P = TERRAIN_PARTS
  P.ramp = P.crater = P.rim = P.mogul = P.well = 0
  // 大尺度丘陵 + 尖一些的山脊
  let h = 2.4 * (noise3(x * 2.6 + 3, y * 2.6, z * 2.6) * 0.45 + noise3(x * 5.2, y * 5.2 + 11, z * 5.2) * 0.4 + noise3(x * 10.4 + 5, y * 10.4, z * 10.4) * 0.15 - 0.5)
  const rn = noise3(x * 5.5 + 21, y * 5.5, z * 5.5 + 7)
  P.ridge = Math.pow(1 - Math.abs(2 * rn - 1), 3)
  h += 0.7 * P.ridge - 0.17
  for (const c of TERRAIN.craters) {
    const d = x * c.c.x + y * c.c.y + z * c.c.z
    if (d < Math.cos(c.r * 1.8)) continue
    const t = Math.sqrt(Math.max(0, 2 * (1 - d))) / c.r
    if (t < 1) {
      h -= c.depth * (1 - t * t)
      P.crater = Math.max(P.crater, 1 - t * t)
    }
    const rim = Math.exp(-(((t - 1) / 0.22) ** 2))
    P.rim = Math.max(P.rim, rim)
    h += c.rim * rim
  }
  for (const m of TERRAIN.ramps) {
    const dx = x - m.c.x, dy = y - m.c.y, dz = z - m.c.z
    if (dx * dx + dy * dy + dz * dz > ((m.L + 2) / R) ** 2) continue
    const lx = (dx * m.f.x + dy * m.f.y + dz * m.f.z) * R
    const ly = (dx * m.s.x + dy * m.s.y + dz * m.s.z) * R
    if (lx < -m.L || lx > 0.7 || Math.abs(ly) > m.W) continue
    const prof = lx <= 0 ? m.H * Math.pow((lx + m.L) / m.L, 1.7) : m.H * (1 - lx / 0.7) ** 2
    const side = THREE.MathUtils.smoothstep(m.W - Math.abs(ly), 0, m.W * 0.45)
    h += prof * side
    P.ramp = Math.max(P.ramp, side * (lx <= 0 ? 1 : 0.4))
  }
  for (const m of TERRAIN.moguls) {
    const d = x * m.c.x + y * m.c.y + z * m.c.z
    if (d < Math.cos(m.r)) continue
    const t = Math.sqrt(Math.max(0, 2 * (1 - d))) / m.r
    const fall = 1 - THREE.MathUtils.smoothstep(t, 0.6, 1)
    h += 0.34 * Math.sin(x * R * 3.4) * Math.sin(y * R * 3.4) * Math.sin(z * R * 3.4 + 1) * fall * 2.2
    P.mogul = Math.max(P.mogul, fall)
  }
  // 吸附井：抹平井里的起伏，换成一个光滑的碗（碗本身也会让球往中心滚）
  for (const m of TERRAIN.wells) {
    const d = x * m.c.x + y * m.c.y + z * m.c.z
    if (d < Math.cos(m.r * 1.2)) continue
    const t = Math.sqrt(Math.max(0, 2 * (1 - d))) / m.r
    const flat = 1 - THREE.MathUtils.smoothstep(t, 0.75, 1.2)
    h = h * (1 - 0.85 * flat) - m.depth * flat * (1 - Math.min(1, t) ** 2)
    P.well = Math.max(P.well, flat)
  }
  return h
}

// 离 u 最近的吸附井（t = 到井中心的距离 / 井半径；不在任何井里时返回 null）
export function wellAt(u: V3) {
  let best: Well | null = null, bt = 1
  for (const m of TERRAIN.wells) {
    const d = u.dot(m.c)
    if (d < Math.cos(m.r)) continue
    const t = Math.sqrt(Math.max(0, 2 * (1 - d))) / m.r
    if (t < bt) {
      bt = t
      best = m
    }
  }
  return best ? { m: best, t: bt } : null
}

const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3()
// 地表法线（有限差分）
export function terrainNormal(u: V3, out: V3) {
  const R = PLANET_R, e = 0.03 / R
  nA.set(-u.z, 0, u.x)
  if (nA.lengthSq() < 1e-6) nA.set(1, 0, 0)
  nA.normalize()
  nB.crossVectors(u, nA)
  const h0 = terrainH(u.x, u.y, u.z)
  nC.copy(u).addScaledVector(nA, e).normalize()
  const h1 = terrainH(nC.x, nC.y, nC.z)
  nC.copy(u).addScaledVector(nB, e).normalize()
  const h2 = terrainH(nC.x, nC.y, nC.z)
  const g1 = (h1 - h0) / (e * R), g2 = (h2 - h0) / (e * R)
  return out.copy(u).addScaledVector(nA, -g1).addScaledVector(nB, -g2).normalize()
}


// ---------------------------------------------------------------- 位点
export type Sites = {
  n: number
  x: Float32Array // 位点（茎的根部）在星球局部坐标里的位置
  y: Float32Array
  z: Float32Array
  tx: Float32Array // 发夹顶端的位置（腿抓的是这里）
  ty: Float32Array
  tz: Float32Array
  nx: Float32Array // 所在处的地表法线
  ny: Float32Array
  nz: Float32Array
  state: Uint8Array // 0 未用；1 正和腿结合；2 已被打开
  timer: Float32Array
  tau: Float32Array // 从结合到被 H2 置换所需的时间
  cells: Map<number, number[]>
}

// 是否在自陷区（折叠区）里
export function inTrapZone(u: V3) {
  return TERRAIN.moguls.some((m) => u.dot(m.c) > Math.cos(m.r * 0.92))
}

export const CELL = 2
const cellKey = (cx: number, cy: number, cz: number) => ((cx + 64) * 128 + (cy + 64)) * 128 + (cz + 64)

export function makeSites(spacing: number, seed = 7): Sites {
  const rand = rng(seed)
  const R = PLANET_R
  const N = Math.round((4 * Math.PI * R * R) / (spacing * spacing))
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], tx: number[] = [], ty: number[] = [], tz: number[] = [], nx: number[] = [], ny: number[] = [], nz: number[] = [], tau: number[] = []
  const v = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), n = new THREE.Vector3()
  const ga = Math.PI * (3 - Math.sqrt(5))
  const push = (v: V3, r1: number) => {
    // 晶体柱底下不放位点
    if (TERRAIN.crystals.some((c) => v.angleTo(c.c) * R < c.rc + 0.15)) return
    const h = terrainH(v.x, v.y, v.z)
    terrainNormal(v, n)
    xs.push(v.x * (R + h)), ys.push(v.y * (R + h)), zs.push(v.z * (R + h))
    tx.push(v.x * (R + h) + n.x * STEM), ty.push(v.y * (R + h) + n.y * STEM), tz.push(v.z * (R + h) + n.z * STEM)
    nx.push(n.x), ny.push(n.y), nz.push(n.z)
    tau.push((0.45 + r1 * 0.6) * K)
  }
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N
    const r = Math.sqrt(1 - y * y)
    v.set(Math.cos(i * ga) * r, y, Math.sin(i * ga) * r)
    t1.set(-v.z, 0, v.x)
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0)
    t1.normalize()
    t2.crossVectors(v, t1)
    const j = (spacing / R) * 0.4
    v.addScaledVector(t1, (rand() - 0.5) * 2 * j).addScaledVector(t2, (rand() - 0.5) * 2 * j).normalize()
    const r1 = rand()
    push(v, r1)
    // 自陷区（折叠区）里每个点旁边再加两个：局部密度约 3 倍（产物富集）
    if (inTrapZone(v)) {
      for (let k = 0; k < 2; k++) {
        const v2 = v.clone().addScaledVector(t1, (rand() - 0.5) * j * 2.2).addScaledVector(t2, (rand() - 0.5) * j * 2.2).normalize()
        push(v2, rand())
      }
    }
  }
  const s: Sites = {
    n: xs.length,
    x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs),
    tx: Float32Array.from(tx), ty: Float32Array.from(ty), tz: Float32Array.from(tz),
    nx: Float32Array.from(nx), ny: Float32Array.from(ny), nz: Float32Array.from(nz),
    state: new Uint8Array(xs.length), timer: new Float32Array(xs.length), tau: Float32Array.from(tau), cells: new Map(),
  }
  for (let i = 0; i < s.n; i++) {
    const k = cellKey(Math.floor(s.tx[i] / CELL), Math.floor(s.ty[i] / CELL), Math.floor(s.tz[i] / CELL))
    let arr = s.cells.get(k)
    if (!arr) s.cells.set(k, (arr = []))
    arr.push(i)
  }
  return s
}

// 找出 (x, y, z) 周围 r 以内的发夹顶端
export function query(s: Sites, x: number, y: number, z: number, r: number, out: number[]) {
  out.length = 0
  const r2 = r * r
  for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
    for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const arr = s.cells.get(cellKey(cx, cy, cz))
        if (!arr) continue
        for (const i of arr) {
          const dx = s.tx[i] - x, dy = s.ty[i] - y, dz = s.tz[i] - z
          if (dx * dx + dy * dy + dz * dz <= r2) out.push(i)
        }
      }
  return out
}

// ---------------------------------------------------------------- walker
export type Regime = 'air' | 'roll' | 'slip' | 'trap' | 'pin' | 'stuck' // trap = 在折叠区被物理卡住（自陷）；pin = 腿太多被钉住
export type WalkerEvents = {
  land: number // 落地 / 砸地的冲击速度（0 = 这一帧没有）
  airTime: number // 刚结束的一次腾空持续了多久（0 = 这一帧没有落地）
  hit: number // 撞晶体柱的冲击速度
  hitAt: V3 // 撞击点（星球局部坐标）
  latch: number // 腾空后重新抓住位点的腿数
  launch: boolean // 这一帧刚离地
  rampLaunch: boolean // 这一帧是从冲刺台冲出去的
  boost: boolean // 这一帧正在冲刺台上加速
  snap: number // 这一帧挣断了几根黏丝
  adsorb: boolean // 这一帧被黏丝粘满
  freed: boolean // 这一帧挣脱
  fuel: number // 这一帧捡到的燃料（编号 + 1；0 = 没有）
  slam: number // 这一帧砸地震开的发夹数（0 = 没有）
  slamH: number // 这次腾空的跃升高度
  slamD: number // 这次腾空的飞行距离
  slamR: number // 冲击圈半径
  crash: boolean // 这一帧撞上晶体柱（算一次撞车）
}
export type WalkerState = {
  p: V3 // 球心位置（星球局部坐标）
  v: V3 // 速度
  f: V3 // 朝向（球面切向，单位向量）
  turnAcc: number // 累计转过的角度
  trap: number // 被卡住 / 钉住的程度 0–0.85
  trapFold: boolean // 这次是在折叠区被卡住（自陷），还是腿太多被钉住
  bound: number[] // 正在结合的位点
  signal: number // 已被打开的位点数
  reach: number
  speed: number // 驱动能达到的速度（相对 V_MAX）
  vel: number // 实际的切向速度（相对 V_MAX）
  grip: boolean // 结合的腿 ≥ 2 才算抓牢
  air: number // 已经腾空多久
  rampT: number // 离开冲刺台坡面多久了
  fromRamp: boolean // 这次腾空是从冲刺台冲出去的
  carry: number // 冲刺台落地后还剩多久的惯性保留（秒）
  stick: number // 被吸附井粘住的程度 0–1
  held: boolean // 被黏丝粘满了（直到挣脱）
  freeT: number // 刚挣脱：还有多久不会再被粘（秒）
  struggle: number // 挣断下一根黏丝的进度 0–1
  fuelT: number // H2 燃料还剩多久（秒）
  fuelCD: Float32Array // 每个燃料多久后重新出现（0 = 在场）
  burnt: boolean // 够得到的发夹都已经被打开过（“烧掉的桥”）
  peak: number // 这次腾空到目前为止的最大跃升高度（离地高度减去悬停高度）
  from: V3 // 这次腾空的起飞点（单位方向）
  crashCD: number // 撞车冷却
  airborne: boolean
  rest: boolean // 完全静止（不再积分，画面不动）
  ev: WalkerEvents
}

export function newWalker(): WalkerState {
  const h = terrainH(START.x, START.y, START.z)
  return {
    p: START.clone().multiplyScalar(PLANET_R + h + HOVER), v: new THREE.Vector3(), f: START_HEADING.clone(),
    turnAcc: 0, trap: 0, bound: [], signal: 0, reach: 0, speed: 0, vel: 0, grip: true, air: 0, rampT: 9, fromRamp: false, carry: 0,
    stick: 0, held: false, freeT: 0, struggle: 0, fuelT: 0, fuelCD: new Float32Array(TERRAIN.fuels.length), burnt: false, trapFold: false,
    peak: 0, from: START.clone(), crashCD: 0, airborne: false, rest: false,
    ev: {
      land: 0, airTime: 0, hit: 0, hitAt: new THREE.Vector3(), latch: 0, launch: false, rampLaunch: false, boost: false,
      snap: 0, adsorb: false, freed: false, fuel: 0, slam: 0, slamH: 0, slamD: 0, slamR: 0, crash: false,
    },
  }
}

const U = new THREE.Vector3(), N = new THREE.Vector3(), T1 = new THREE.Vector3(), SIDE = new THREE.Vector3(), VT = new THREE.Vector3(), D = new THREE.Vector3()
const SLAM_CAND: number[] = []

// input.move：+1 前进 / -1 后退 / 0；input.turn：左转为正（可以是小数）。
// onSite(i, state)：某个位点状态变了（0 松开 / 1 结合 / 2 被打开 / 3 被砸地震开）。
export function stepWalker(w: WalkerState, s: Sites, input: { move: number; turn: number }, dt: number, cand: number[], onSite: (i: number, state: number) => void) {
  const R = PLANET_R
  const ev = w.ev
  ev.land = 0
  ev.airTime = 0
  ev.hit = 0
  ev.latch = 0
  ev.launch = false
  ev.rampLaunch = false
  ev.boost = false
  ev.snap = 0
  ev.adsorb = false
  ev.freed = false
  ev.fuel = 0
  ev.slam = 0
  ev.crash = false
  if (w.crashCD > 0) w.crashCD -= dt
  U.copy(w.p).normalize()

  // 转向；空中转向时速度方向也跟着转一部分（躲开落点的障碍）；被粘住时转不太动
  const a = input.turn * TURN * dt * (w.airborne ? TURN_AIR : 1) * (1 - 0.6 * w.stick)
  if (a) {
    T1.crossVectors(U, w.f)
    w.f.multiplyScalar(Math.cos(a)).addScaledVector(T1, Math.sin(a)).normalize()
    w.turnAcc += a
    if (w.airborne) {
      const b = a * AIR_CONTROL, vr = w.v.dot(U)
      VT.copy(w.v).addScaledVector(U, -vr)
      T1.crossVectors(U, VT)
      w.v.copy(U).multiplyScalar(vr).addScaledVector(VT, Math.cos(b)).addScaledVector(T1, Math.sin(b))
    }
  }

  // ---- H2 燃料：碰到就捡起来，往前推一把，一段时间里加速、置换加快；被捡走的过一阵重新出现
  if (w.fuelT > 0) w.fuelT = Math.max(0, w.fuelT - dt)
  const fuels = TERRAIN.fuels
  for (let k = 0; k < fuels.length; k++) {
    if (w.fuelCD[k] > 0) w.fuelCD[k] = Math.max(0, w.fuelCD[k] - dt)
    else if (w.p.distanceToSquared(fuels[k].p) < FUEL_R * FUEL_R) {
      w.fuelCD[k] = FUEL_RESPAWN
      w.fuelT = FUEL_T
      w.v.addScaledVector(w.f, FUEL_KICK * V_MAX)
      ev.fuel = k + 1
    }
  }

  // ---- 非特异性吸附：在井里贴地（或贴着井面低空掠过）慢慢沾上（越靠中心越快），沾到一定程度、
  //      或者冲进井中心那一圈，黏丝一下子粘满；粘满后按住前进一下一下挣断黏丝（每断一根往前一冲），
  //      挣脱后一小段时间不会再被粘
  const well = wellAt(U)
  const low = !!well && w.p.length() - (R + terrainH(U.x, U.y, U.z)) < HOVER + CATCH_LOW
  if (w.freeT > 0) w.freeT = Math.max(0, w.freeT - dt)
  let lurch = false
  if (w.held) {
    if (input.move > 0 && !w.airborne) {
      w.struggle += dt * STRUGGLE
      if (w.struggle >= 1) {
        w.struggle = 0
        w.stick -= SNAP_DROP
        ev.snap++
        lurch = true
        if (w.stick <= FREE_AT) {
          w.held = false
          w.freeT = FREE_T
          ev.freed = true
        }
      }
    }
  } else {
    w.struggle = 0
    if (well && low && w.freeT <= 0) {
      w.stick += dt * STICK_UP * (0.3 + (1 - well.t))
      if (w.stick >= CATCH_AT || well.t < CATCH_CORE) {
        w.stick = 1
        w.held = true
        ev.adsorb = true
      }
    } else w.stick = Math.max(0, w.stick - dt * STICK_DOWN)
  }

  // ---- 腿与位点
  VT.copy(w.v).addScaledVector(U, -w.v.dot(U))
  const vNow = VT.length()
  const active = input.move !== 0 || vNow > 0.25
  // 置换速度：超过常态最快速度时按车速同比加快（否则跑得越快、腿越来不及打开就被扯断）；
  // 有 H2 燃料时加快；被缠住时变慢；被粘住时停住（颗粒粘在表面上不走，也不出信号）
  const turnRate = Math.max(w.carry > 0 ? CARRY_TURN : 1, vNow / V_MAX) * (w.fuelT > 0 ? FUEL_BOOST : 1) * (1 - TRAP_SLOW * w.trap) * (1 - w.stick)
  const b = w.bound
  const before = b.length
  for (let k = b.length - 1; k >= 0; k--) {
    const i = b[k]
    const dx = s.tx[i] - w.p.x, dy = s.ty[i] - w.p.y, dz = s.tz[i] - w.p.z
    if (dx * dx + dy * dy + dz * dz > LEG_BREAK * LEG_BREAK) {
      s.state[i] = 0
      s.timer[i] = 0
      onSite(i, 0)
      b.splice(k, 1)
      continue
    }
    if (!active) continue
    s.timer[i] += dt * turnRate
    if (s.timer[i] > s.tau[i]) {
      s.state[i] = 2
      onSite(i, 2)
      w.signal++
      b.splice(k, 1)
    }
  }
  query(s, w.p.x, w.p.y, w.p.z, LEG_REACH, cand)
  const fresh = cand.filter((i) => s.state[i] === 0)
  let spent = 0
  for (const i of cand) if (s.state[i] === 2) spent++
  const d2 = (i: number) => (s.tx[i] - w.p.x) ** 2 + (s.ty[i] - w.p.y) ** 2 + (s.tz[i] - w.p.z) ** 2
  fresh.sort((i, j) => d2(i) - d2(j))
  let added = 0
  for (const i of fresh) {
    if (b.length >= MAX_LEGS) break
    s.state[i] = 1
    s.timer[i] = 0
    onSite(i, 1)
    b.push(i)
    added++
  }
  if (before === 0 && added > 0 && w.air > 0.12) ev.latch = added
  const n = b.length
  // 自陷：在折叠区里贴地，不管腿数、不管速度都会被物理卡住；钉住：腿太多就慢慢被钉住；
  // 冲刺台落地后的惯性保留期间（折叠区外）不会被钉住（不累积、很快消退）
  const inZone = !w.airborne && inTrapZone(U)
  if (active && !w.airborne) {
    if (inZone || (n >= TRAP_LEGS && w.carry <= 0)) {
      w.trap = Math.min(0.85, w.trap + dt * TRAP_UP)
      w.trapFold = inZone
    }
    else w.trap = Math.max(0, w.trap - dt * TRAP_DOWN * (w.carry > 0 ? 8 : 1))
  }
  w.grip = n >= 2
  w.burnt = !w.airborne && n < 2 && fresh.length === 0 && spent >= 3
  w.speed = (w.grip ? relSpeed(n) * (1 - TRAP_SPEED * w.trap) : SLIP) * (1 - 0.85 * w.stick) * (w.fuelT > 0 ? FUEL_SPEED : 1)
  // 惯性保留：松开油门、被粘住、进了自陷区、撞柱就结束；被卡住 / 钉住时消耗得更快
  if (w.carry > 0) {
    if (input.move <= 0 || w.held || inZone) w.carry = 0
    else {
      w.carry = Math.max(0, w.carry - dt * (1 + 4 * w.trap))
    }
  }
  w.reach = fresh.length + n

  // ---- 物理（分 4 小步积分）
  if (w.rest && input.move === 0) {
    w.vel = 0
    return
  }
  w.rest = false
  if (lurch) w.v.addScaledVector(w.f, LURCH)
  const steps = 4, h = dt / steps
  for (let k = 0; k < steps; k++) {
    U.copy(w.p).normalize()
    const r = w.p.length()
    const ground = R + terrainH(U.x, U.y, U.z)
    const onRamp = TERRAIN_PARTS.ramp
    const gap = r - ground
    terrainNormal(U, N)
    // 正对着冲刺台的坡面往上冲
    let rampF: V3 | null = null
    if (onRamp > 0.3 && gap < AIR_GAP) {
      for (const m of TERRAIN.ramps) if (U.dot(m.c) > Math.cos((m.L + 2) / R) && w.f.dot(m.f) > 0.3) rampF = m.f
    }
    w.rampT = rampF ? 0 : w.rampT + h
    const grounded = gap < AIR_GAP
    // 重力
    w.v.addScaledVector(U, -GRAVITY * h)
    // 悬挂：腿把球托在地表上方；踩油门或在空中时沿地表法线（坡上会被推着往下溜），停着时沿竖直方向（不溜坡）
    // （从冲刺台飞出去落地那一下、以及之后的惯性保留期间也沿竖直方向：落地、上坡不吃掉前进速度）
    // （周围的发夹都用完了——“烧掉的桥”——时也沿竖直方向：否则打滑的球爬不出陡坡，会困死在自陷区的鼓包里）
    const keep = w.carry > 0 || w.fromRamp || w.burnt
    if (grounded) {
      const ns = input.move !== 0 && !keep ? N : U
      const vn = w.v.dot(ns)
      const F = SUSP_K * (HOVER - gap) - SUSP_C * vn + GRAVITY
      if (F > 0) w.v.addScaledVector(ns, F * h)
    }
    // 结合的腿把球往下拽
    // （刚冲出冲刺台的一小段时间里腿松开，不往下拽）
    if (n > 0 && gap > HOVER && w.rampT > 0.35) w.v.addScaledVector(U, -TETHER_PULL * n * (gap - HOVER) * h)
    if (w.carry > 0 && gap > HOVER && w.rampT > 0.5) w.v.addScaledVector(U, -CARRY_DOWN * h)
    // 吸附井往中心吸（井半径一半处最强；飞得太高就吸不到；刚挣脱时吸力减弱）
    if (well && gap < AIR_GAP + 0.6) {
      const d = U.dot(well.m.c)
      const t = Math.sqrt(Math.max(0, 2 * (1 - d))) / well.m.r
      D.copy(well.m.c).addScaledVector(U, -d)
      const len = D.length()
      const pull = WELL_PULL * Math.sin(Math.PI * t) * (w.freeT > 0 ? 0.3 : 1)
      if (t < 1 && len > 1e-6) w.v.addScaledVector(D, (pull * h) / len)
    }
    // 驱动、滑行、侧向抓地（只在地面上）
    if (grounded) {
      const vr = w.v.dot(U)
      VT.copy(w.v).addScaledVector(U, -vr)
      SIDE.crossVectors(U, w.f)
      let vf = VT.dot(w.f)
      let vs = VT.dot(SIDE)
      // 抓地不够时失去驱动、靠惯性滑（减速有上限），不会被一下“刹停”；
      // 冲刺台落地后超速部分掉得慢；短暂打滑时也只是慢慢减速（靠惯性滑过去）；被缠住时腿额外刹车
      const brake = w.carry > 0 ? CARRY_DECEL : w.grip ? 3 + TRAP_BRAKE * w.trap : 1.5
      if (input.move) vf += THREE.MathUtils.clamp((input.move * V_MAX * w.speed - vf) * 4, -brake, 10) * h
      else vf *= Math.exp(-1.6 * h)
      if (rampF && input.move > 0 && vf < V_MAX * BOOST_CAP) {
        vf = Math.min(V_MAX * BOOST_CAP, vf + BOOST_ACC * h)
        ev.boost = true
      }
      vs *= Math.exp(-(2 + 10 * Math.min(1, n / 5)) * h)
      // 被粘住：黏丝拖着；在自陷区里被卡住：折叠沟槽卡着——都有额外阻力
      const stickDrag = 2 * w.stick + (inZone ? ZONE_DRAG * w.trap : 0)
      if (stickDrag > 0) {
        const drag = Math.exp(-stickDrag * h)
        vf *= drag
        vs *= drag
      }
      w.v.copy(U).multiplyScalar(vr).addScaledVector(w.f, vf).addScaledVector(SIDE, vs)
    }
    // 积分
    w.p.addScaledVector(w.v, h)
    U.copy(w.p).normalize()
    const ground2 = R + terrainH(U.x, U.y, U.z)
    const gap2 = w.p.length() - ground2
    // 球砸到地面：顶出来并反弹
    // （冲刺台落地 / 惯性保留期间只反弹竖直分量，不吃掉前进速度）
    if (gap2 < WALKER_R) {
      if (keep) N.copy(U)
      else terrainNormal(U, N)
      w.p.copy(U).multiplyScalar(ground2 + WALKER_R)
      const vn = w.v.dot(N)
      if (vn < 0) {
        ev.land = Math.max(ev.land, -vn)
        w.v.addScaledVector(N, -(1 + RESTITUTION) * vn)
      }
    }
    // 晶体柱：在切平面里推开并反弹
    for (const c of TERRAIN.crystals) {
      const d = U.dot(c.c)
      if (d < 0.995) continue
      D.copy(U).sub(c.c)
      D.addScaledVector(U, -D.dot(U))
      const dist = D.length() * R
      const minD = c.rc + WALKER_R
      const height = w.p.length() - (R + c.base)
      if (dist < minD && height < c.hc) {
        D.normalize()
        w.p.addScaledVector(D, minD - dist)
        const vn = w.v.dot(D)
        if (vn < 0) {
          ev.hit = Math.max(ev.hit, -vn)
          ev.hitAt.copy(c.c).multiplyScalar(R + c.base + Math.min(height, c.hc * 0.6)).addScaledVector(D, c.rc)
          w.v.addScaledVector(D, -(1 + BOUNCE_CRYSTAL) * vn)
          if (-vn > 2) w.carry = 0 // 撞柱就没有惯性可保留了
          if (-vn > CRASH_V && w.crashCD <= 0) {
            ev.crash = true
            w.crashCD = CRASH_CD
          }
        }
      }
    }
    // 限速（下坡也不至于飞出去）
    const vr = w.v.dot(U)
    VT.copy(w.v).addScaledVector(U, -vr)
    const vt = VT.length()
    const cap = V_MAX * (w.airborne || w.rampT < 0.5 || w.carry > 0 || w.fuelT > 0 ? 1.9 : SPEED_CAP)
    if (vt > cap) w.v.copy(U).multiplyScalar(vr).addScaledVector(VT, cap / vt)
    // 朝向保持在切平面里
    w.f.addScaledVector(U, -w.f.dot(U)).normalize()
    // 腾空计时
    const air = w.p.length() - ground2 > AIR_GAP
    if (air && !w.airborne) {
      ev.launch = true
      w.peak = 0
      w.from.copy(U)
      // 从冲刺台冲出去：额外的向上、向前速度，飞得更高更远
      if (w.rampT < 0.15) {
        ev.rampLaunch = true
        w.fromRamp = true
        w.v.addScaledVector(U, LAUNCH_UP).addScaledVector(w.f, LAUNCH_FWD)
      }
    }
    if (air) w.peak = Math.max(w.peak, w.p.length() - ground2 - HOVER)
    if (!air && w.airborne && w.air > 0.2) ev.airTime = w.air
    // 砸地：腾空够久就把落点周围一圈还没用过的发夹震开（飞得越高、越远，圈越大）
    if (!air && w.airborne && w.air > SLAM_AIR) {
      const dist = w.from.angleTo(U) * R
      const rad = Math.min(SLAM_RMAX, SLAM_R0 + SLAM_H * w.peak + SLAM_D * dist)
      query(s, w.p.x, w.p.y, w.p.z, rad, SLAM_CAND)
      let opened = 0
      for (const i of SLAM_CAND) {
        if (s.state[i] !== 0) continue
        s.state[i] = 2
        onSite(i, 3)
        opened++
      }
      w.signal += opened
      ev.slam = opened
      ev.slamH = w.peak
      ev.slamD = dist
      ev.slamR = rad
    }
    // 从冲刺台飞出去后第一次落地：开始保留惯性（落地后的弹跳不重新计时）
    if (!air && w.airborne && w.fromRamp) {
      w.fromRamp = false
      w.carry = CARRY_MAX
    }
    w.airborne = air
    w.air = air ? w.air + h : 0
  }
  U.copy(w.p).normalize()
  VT.copy(w.v).addScaledVector(U, -w.v.dot(U))
  w.vel = VT.length() / V_MAX
  // 静止判定：松开油门、贴地、速度和悬挂都几乎停了 → 归零，不再积分（画面完全不动）
  const gapNow = w.p.length() - (R + terrainH(U.x, U.y, U.z))
  if (input.move === 0 && !w.airborne && w.v.length() < 0.06 && Math.abs(gapNow - HOVER) < 0.02) {
    w.v.set(0, 0, 0)
    w.p.copy(U).multiplyScalar(R + terrainH(U.x, U.y, U.z) + HOVER)
    w.rest = true
    w.vel = 0
  }
}

export function regimeOf(w: WalkerState): Regime {
  if (w.airborne) return 'air'
  if (w.held) return 'stuck'
  return !w.grip ? 'slip' : w.trap > 0.3 ? (w.trapFold ? 'trap' : 'pin') : 'roll'
}

// ---------------------------------------------------------------- 冲刺台落点的障碍
// 用同一套物理（不带位点）从每个冲刺台全速冲一次，记下落点，在落点轮流放：晶体柱群 / 自陷区 / 吸附井。
// 空中可以转向，躲得开；出生点正前方第一个冲刺台不放，第一跳干净利落。
export type HazardKind = 'crystal' | 'trap' | 'well'
export const HAZARDS: { c: V3; kind: HazardKind; ramp: number }[] = [] // ramp：是哪个冲刺台的落点

function settleTerrain() {
  for (const c of TERRAIN.crystals) c.base = terrainH(c.c.x, c.c.y, c.c.z)
  for (const fu of TERRAIN.fuels) fu.p.copy(fu.c).multiplyScalar(PLANET_R + terrainH(fu.c.x, fu.c.y, fu.c.z) + 1.25)
}

function placeLandingHazards() {
  const R = PLANET_R
  const z = new Float32Array(0)
  const empty: Sites = { n: 0, x: z, y: z, z, tx: z, ty: z, tz: z, nx: z, ny: z, nz: z, state: new Uint8Array(0), timer: z, tau: z, cells: new Map() }
  const cand: number[] = []
  // 先把所有落点都算出来（障碍会改地形，不能边放边模拟）
  const landings: { u: V3; f: V3; k: number }[] = []
  TERRAIN.ramps.forEach((m, k) => {
    if (k === 0) return
    const w = newWalker()
    const th = -(m.L + 4) / R
    const u = m.c.clone().multiplyScalar(Math.cos(th)).addScaledVector(m.f, Math.sin(th)).normalize()
    w.p.copy(u).multiplyScalar(R + terrainH(u.x, u.y, u.z) + HOVER)
    w.f.copy(m.c).multiplyScalar(-Math.sin(th)).addScaledVector(m.f, Math.cos(th)).normalize()
    w.v.copy(w.f).multiplyScalar(V_MAX)
    let launched = false
    for (let f = 0; f < 600; f++) {
      stepWalker(w, empty, { move: 1, turn: 0 }, 1 / 60, cand, () => {})
      if (w.ev.rampLaunch) launched = true
      if (launched && w.ev.airTime > 0.4) {
        const lu = w.p.clone().normalize()
        landings.push({ u: lu, f: w.v.clone().addScaledVector(lu, -w.v.dot(lu)).normalize(), k })
        return
      }
    }
  })
  const kinds: HazardKind[] = ['crystal', 'trap', 'well']
  const r = rng(424242)
  for (const { u, f, k } of landings) {
    const kind = kinds[HAZARDS.length % 3]
    const rr = kind === 'crystal' ? 2.5 : 4.6
    const away = (c: V3, d: number) => u.angleTo(c) > d / R
    const ok = away(START, rr + 8)
      && TERRAIN.ramps.every((m) => away(m.c, 0.6 * (rr + m.L)))
      && HAZARDS.every((hz) => away(hz.c, rr + 2))
      && TERRAIN.wells.every((m) => away(m.c, 0.5 * rr + m.r * R))
      && TERRAIN.moguls.every((m) => away(m.c, 0.5 * rr + m.r * R))
    if (!ok) continue
    HAZARDS.push({ c: u, kind, ramp: k })
    if (kind === 'trap') TERRAIN.moguls.push({ c: u, r: 4.6 / R })
    else if (kind === 'well') TERRAIN.wells.push({ c: u, r: 4.4 / R, depth: 1.1 })
    else {
      // 三根晶体柱摆成楔形，正对来的方向
      const side = new THREE.Vector3().crossVectors(u, f)
      for (const [lx, ly] of [[0, 0], [1.1, -1.8], [1.1, 1.8]]) {
        const c = u.clone().addScaledVector(f, lx / R).addScaledVector(side, ly / R).normalize()
        TERRAIN.crystals.push({ c, rc: 0.6 + r() * 0.25, hc: 3 + r() * 1.6, base: 0, tilt: (r() - 0.5) * 0.3, spin: r() * Math.PI, hue: r() })
      }
    }
  }
}

settleTerrain()
placeLandingHazards()
settleTerrain()

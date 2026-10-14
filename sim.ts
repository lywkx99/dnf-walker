// 不开浏览器，按每秒 60 帧跑三档密度：速度、腾空、自陷、点亮、冲刺台收益、吸附井、静止判定。用法：node sim.ts
import * as THREE from 'three'
import { DENSITY, type Density, HAZARDS, type Sites, type WalkerState, PLANET_R, TERRAIN, V_MAX, makeSites, newWalker, query, regimeOf, stepWalker, terrainH, wellAt } from './src/model.ts'

const DT = 1 / 60
const HOVER = 1
const kinds = HAZARDS.reduce<Record<string, number>>((o, h) => ((o[h.kind] = (o[h.kind] || 0) + 1), o), {})
console.log(`冲刺台 ${TERRAIN.ramps.length} 个，落点障碍 ${HAZARDS.length} 处 ${JSON.stringify(kinds)}；自陷区 ${TERRAIN.moguls.length}，吸附井 ${TERRAIN.wells.length}，晶体柱 ${TERRAIN.crystals.length}，燃料 ${TERRAIN.fuels.length}`)

type Tally = {
  t: number; dist: number; regime: Record<string, number>
  carryT: number; carryDist: number; carryOpen: number // 冲刺台落地后的惯性保留期间（贴地）
  normT: number; normDist: number; normOpen: number // 普通贴地
  airMax: number; jumps: number; rampJumps: number; hits: number; opened: number; fuels: number
  slams: number; slamOpen: number; slamH: number; slamD: number; slamR: number; crashes: number // 砸地次数、震开的发夹数、高度 / 距离 / 半径之和；撞车次数
}
const newTally = (): Tally => ({ t: 0, dist: 0, regime: {}, carryT: 0, carryDist: 0, carryOpen: 0, normT: 0, normDist: 0, normOpen: 0, airMax: 0, jumps: 0, rampJumps: 0, hits: 0, opened: 0, fuels: 0, slams: 0, slamOpen: 0, slamH: 0, slamD: 0, slamR: 0, crashes: 0 })

// 会“找新路”的玩家：每 0.25 秒看看前方几个方向，哪边没打开的发夹最多就往哪边开，绕开吸附井和自陷区
function seeker(w: WalkerState, s: Sites) {
  const cand: number[] = []
  let want = 0
  return (f: number) => {
    if (f % 15 === 0) {
      const u = w.p.clone().normalize()
      let best = -1e9
      for (const a of [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2]) {
        const dir = w.f.clone().applyAxisAngle(u, a)
        let score = -Math.abs(a) * 3
        for (const dist of [3, 6, 9]) {
          const th = dist / PLANET_R
          const q = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(dir, Math.sin(th)).normalize()
          if (wellAt(q) || TERRAIN.moguls.some((m) => q.dot(m.c) > Math.cos(m.r))) score -= 40
          const p = q.clone().multiplyScalar(PLANET_R + terrainH(q.x, q.y, q.z) + 0.45)
          query(s, p.x, p.y, p.z, 2.2, cand)
          for (const i of cand) if (s.state[i] === 0) score++
        }
        if (score > best) {
          best = score
          want = a
        }
      }
    }
    return Math.max(-1, Math.min(1, want * 1.5))
  }
}

// 冲出冲刺台那一刻看前方 45 个单位内最近的落点障碍在哪一侧，空中前 1.2 秒往另一侧打满方向（模拟玩家躲障碍）
function dodgeSide(w: WalkerState) {
  const u = w.p.clone().normalize()
  const side = new THREE.Vector3().crossVectors(u, w.f)
  let best = 1e9, sign = 0
  for (const hz of HAZARDS) {
    const d = hz.c.clone().sub(u)
    const ahead = d.dot(w.f) * PLANET_R, lat = d.dot(side) * PLANET_R
    if (ahead < 5 || ahead > 45 || Math.abs(lat) > 8) continue
    if (ahead < best) {
      best = ahead
      sign = lat > 0 ? -1 : 1 // 障碍在左（side 方向）就往右打
    }
  }
  return sign
}
function drive(w: WalkerState, s: Sites, T: Tally, frames: number, turnAt: (f: number) => number) {
  const cand: number[] = []
  let opened = 0, dodge = 0
  const onSite = (_i: number, st: number) => { if (st === 2 || st === 3) opened++ }
  for (let f = 0; f < frames; f++) {
    const before = w.p.clone()
    const o0 = opened
    const carry = w.carry > 0
    const dodging = w.airborne && w.fromRamp && w.air < 1.2 && dodge !== 0
    stepWalker(w, s, { move: 1, turn: dodging ? dodge : turnAt(f) }, DT, cand, onSite)
    if (w.ev.rampLaunch) dodge = dodgeSide(w)
    const step = before.distanceTo(w.p)
    T.t += DT
    T.dist += step
    if (!w.airborne) {
      if (carry) { T.carryT += DT; T.carryDist += step; T.carryOpen += opened - o0 }
      else { T.normT += DT; T.normDist += step; T.normOpen += opened - o0 }
    }
    if (w.ev.airTime) { T.jumps++; T.airMax = Math.max(T.airMax, w.ev.airTime) }
    if (w.ev.rampLaunch) T.rampJumps++
    if (w.ev.hit > 0.5) T.hits++
    if (w.ev.fuel) T.fuels++
    if (w.ev.crash) T.crashes++
    if (w.ev.slam) {
      T.slams++
      T.slamOpen += w.ev.slam
      T.slamH += w.ev.slamH
      T.slamD += w.ev.slamD
      T.slamR += w.ev.slamR
    }
    const st = regimeOf(w)
    T.regime[st] = (T.regime[st] || 0) + DT
    if (!Number.isFinite(w.p.x)) throw new Error('NaN')
  }
  T.opened += opened
}

const pct = (x: number) => `${Math.round((x / V_MAX) * 100)}%`
function report(d: Density, label: string, T: Tally) {
  const reg = Object.entries(T.regime).map(([k, v]) => `${k} ${Math.round((v / T.t) * 100)}%`).join(' ')
  console.log(`== ${d} ${label}：平均 ${pct(T.dist / T.t)}，每秒点亮 ${(T.opened / T.t).toFixed(1)}，腾空 ${T.jumps} 次（冲刺台 ${T.rampJumps}）最长 ${T.airMax.toFixed(2)}s，撞柱 ${T.hits}，燃料 ${T.fuels}；${reg}`)
  if (T.slams) console.log(`   砸地 ${T.slams} 次，平均每次 +${(T.slamOpen / T.slams).toFixed(0)}（跃升 ${(T.slamH / T.slams).toFixed(1)}、飞行 ${(T.slamD / T.slams).toFixed(0)}、冲击圈半径 ${(T.slamR / T.slams).toFixed(1)}）；撞车 ${T.crashes} 次`)
  if (T.carryT > 0.1) console.log(`   惯性保留（贴地 ${T.carryT.toFixed(1)}s）：平均 ${pct(T.carryDist / T.carryT)}，每秒点亮 ${(T.carryOpen / T.carryT).toFixed(1)}；普通贴地：平均 ${pct(T.normDist / T.normT)}，每秒点亮 ${(T.normOpen / T.normT).toFixed(1)}`)
}

function placeAt(w: WalkerState, u: THREE.Vector3, f: THREE.Vector3) {
  w.p.copy(u).multiplyScalar(PLANET_R + terrainH(u.x, u.y, u.z) + HOVER)
  w.f.copy(f).addScaledVector(u, -f.dot(u)).normalize()
}
function resetSites(s: Sites) {
  s.state.fill(0)
  s.timer.fill(0)
}
// 从 c 沿 f 方向往回退 back 个单位的位置和朝向
function behind(c: THREE.Vector3, f: THREE.Vector3, back: number) {
  const th = -back / PLANET_R
  return {
    u: c.clone().multiplyScalar(Math.cos(th)).addScaledVector(f, Math.sin(th)).normalize(),
    f: c.clone().multiplyScalar(-Math.sin(th)).addScaledVector(f, Math.cos(th)),
  }
}

for (const d of ['LT', 'MT', 'HT'] as Density[]) {
  const s = makeSites(DENSITY[d].spacing)
  // 1. 出生点直线 20 秒（连过冲刺台）
  {
    const T = newTally()
    const w = newWalker()
    drive(w, s, T, 20 * 60, () => 0)
    report(d, '直线 20s', T)
    let settle = -1
    const cand: number[] = []
    for (let f = 0; f < 600; f++) {
      stepWalker(w, s, { move: 0, turn: 0 }, DT, cand, () => {})
      if (w.rest) { settle = f / 60; break }
    }
    console.log(`   松开后 ${settle < 0 ? '10 秒内没停稳！' : settle.toFixed(2) + ' 秒停稳'}`)
  }
  // 2. 缓弯 4 个出发朝向 × 30 秒（比较密度规则）
  {
    const T = newTally()
    for (let k = 0; k < 4; k++) {
      resetSites(s)
      const w = newWalker()
      const u = w.p.clone().normalize()
      placeAt(w, u, w.f.clone().applyAxisAngle(u, (k * Math.PI) / 2))
      drive(w, s, T, 30 * 60, (f) => 0.35 * Math.sin(f / 120 + k))
    }
    report(d, '缓弯 4×30s', T)
  }
  // 3. 冲刺台净收益：同一起点、带着常态速度，冲向冲刺台（空中躲障碍） vs 转开 90° 不冲，各开 20 秒；
  //    落点放了障碍的冲刺台和没放的分开算
  {
    const T = newTally()
    const sum = { clean: [0, 0, 0], hazard: [0, 0, 0] } // [冲, 不冲, 个数]
    TERRAIN.ramps.forEach((m, k) => {
      const { u, f } = behind(m.c, m.f, m.L + 10)
      const run = (dir: THREE.Vector3, tally: Tally) => {
        resetSites(s)
        const w = newWalker()
        placeAt(w, u, dir)
        w.v.copy(w.f).multiplyScalar(V_MAX * 0.85)
        const o0 = tally.opened
        drive(w, s, tally, 20 * 60, () => 0)
        return tally.opened - o0
      }
      const g = HAZARDS.some((h) => h.ramp === k) ? sum.hazard : sum.clean
      g[0] += run(f, T)
      g[1] += run(f.clone().applyAxisAngle(u, Math.PI / 2), newTally())
      g[2]++
    })
    report(d, `冲刺台 ${TERRAIN.ramps.length}×20s`, T)
    const line = (g: number[]) => `冲 ${(g[0] / g[2]).toFixed(0)} / 不冲 ${(g[1] / g[2]).toFixed(0)}（净收益 ${(((g[0] - g[1]) / Math.max(1, g[1])) * 100).toFixed(0)}%）`
    console.log(`   每次 20 秒点亮——落点没障碍的 ${sum.clean[2]} 个：${line(sum.clean)}；落点有障碍的 ${sum.hazard[2]} 个（空中躲）：${line(sum.hazard)}`)
  }
  // 4. 吸附井 / 自陷区：从外面 7 个单位、带着 1.3 倍常态速度冲向中心，按住前进——
  //    吸附井看粘不粘得住、多久挣脱；自陷区看缠不缠得住、在区里待多久、出来时还剩多少速度
  {
    const fast = V_MAX * 1.3
    const times: number[] = []
    let fail = 0, miss = 0
    for (const m of TERRAIN.wells) {
      const f0 = new THREE.Vector3(-m.c.z, 0, m.c.x).normalize()
      const { u, f } = behind(m.c, f0, m.r * PLANET_R + 7)
      resetSites(s)
      const w = newWalker()
      placeAt(w, u, f)
      w.v.copy(w.f).multiplyScalar(fast)
      const cand: number[] = []
      let caught = -1, freed = -1
      for (let fr = 0; fr < 30 * 60; fr++) {
        stepWalker(w, s, { move: 1, turn: 0 }, DT, cand, () => {})
        if (caught < 0 && w.held) caught = fr
        if (caught >= 0 && !w.held && !wellAt(w.p.clone().normalize())) { freed = fr; break }
      }
      if (caught < 0) miss++
      else if (freed < 0) fail++
      else times.push((freed - caught) / 60)
    }
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    console.log(`   吸附井（高速冲进去）：${TERRAIN.wells.length} 口里被粘住 ${times.length + fail} 次、冲过去没粘住 ${miss} 次；挣脱平均 ${avg.toFixed(1)}s、最长 ${Math.max(0, ...times).toFixed(1)}s，30 秒内没挣脱 ${fail} 次`)
    const zoneT: number[] = [], outV: number[] = []
    let tangled = 0, stuckZ = 0
    for (const m of TERRAIN.moguls) {
      const f0 = new THREE.Vector3(-m.c.z, 0, m.c.x).normalize()
      const { u, f } = behind(m.c, f0, m.r * PLANET_R + 7)
      resetSites(s)
      const w = newWalker()
      placeAt(w, u, f)
      w.v.copy(w.f).multiplyScalar(fast)
      const cand: number[] = []
      let inT = 0, entered = false, maxTrap = 0, exitV = -1
      for (let fr = 0; fr < 30 * 60; fr++) {
        stepWalker(w, s, { move: 1, turn: 0 }, DT, cand, () => {})
        const inside = w.p.clone().normalize().dot(m.c) > Math.cos(m.r)
        if (inside) { entered = true; inT += DT }
        maxTrap = Math.max(maxTrap, w.trap)
        if (entered && !inside) { exitV = w.vel; break }
      }
      if (!entered) continue
      if (maxTrap > 0.3) tangled++
      if (exitV < 0) stuckZ++
      else { zoneT.push(inT); outV.push(exitV) }
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
    console.log(`   自陷区（高速冲进去）：${TERRAIN.moguls.length} 片里被缠住 ${tangled} 次；穿过平均用 ${mean(zoneT).toFixed(1)}s（最长 ${Math.max(0, ...zoneT).toFixed(1)}s），出来时速度平均 ${Math.round(mean(outV) * 100)}%；30 秒内没出来 ${stuckZ} 次`)
  }
  // 5. 两分钟一局（会找新路的玩家），从 3 个出发朝向各开一局取平均
  {
    const T = newTally()
    const runs: number[] = []
    for (const ang of [0, 2.1, 4.2]) {
      resetSites(s)
      const w = newWalker()
      const u = w.p.clone().normalize()
      placeAt(w, u, w.f.clone().applyAxisAngle(u, ang))
      const o0 = T.opened, c0 = T.crashes
      drive(w, s, T, 120 * 60, seeker(w, s))
      runs.push(T.opened - o0 - 30 * (T.crashes - c0))
    }
    console.log(`   两分钟一局（得分 = 点亮 − 30×撞车）：${runs.join(' / ')}（平均 ${Math.round(runs.reduce((a, b) => a + b, 0) / runs.length)}），砸地 ${T.slams} 次共 +${T.slamOpen}，撞车 ${T.crashes} 次；${Object.entries(T.regime).map(([k, v]) => `${k} ${Math.round((v / T.t) * 100)}%`).join(' ')}`)
  }
}

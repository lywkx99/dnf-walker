import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, useKeyboardControls } from '@react-three/drei'
import { useControls } from 'leva'
import {
  DENSITY, type Density, MAX_LEGS, LEG_BREAK, PLANET_R, STEM, V_MAX, WALKER_R, type WalkerState,
  TERRAIN, makeSites, newWalker, regimeOf, stepWalker, terrainH,
} from './model'
import { CRASH_COST, GAME_T, SPEED_UNIT, actions, announce, award, game, hud, newStats, saveBest, teach } from './hud'
import { sfx } from './sfx'
import type { Controls } from './App'
import Sky from './Sky'
import { HORIZON, MOON_DIR, view } from './scene'
import { Crystals, PlanetSurface, RampMarks, Spores } from './Planet'
import TrapZones from './TrapZones'
import Wells from './Wells'
import Fuels from './Fuels'
import Effects from './Effects'
import { Fx } from './fx'
import { glowTexture } from './textures'

const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b)
const FRESH = lin(0.85, 0.16, 0.26) // 未用的 H1 发夹：暗珊瑚红（不触发辉光）
const BOUND = lin(2.8, 1.75, 0.3) // 正和腿结合：金色
const FLASH = lin(0.6, 3.6, 1.5) // 刚被 H2 打开：亮绿
const TRAIL = lin(0.05, 0.5, 0.42) // 打开后留下的青绿轨迹
const SPARK = lin(1.8, 1.4, 0.6)
const DUPLEX = lin(0.3, 2.2, 1.6)
const RING = lin(0.2, 1.7, 1.0)
const DUST = lin(0.35, 0.42, 0.95)
const TAUT = lin(3.0, 0.55, 0.18)
const TIP = lin(0.45, 1.4, 2.6)
const LATCH = lin(2.6, 2.2, 3.2)
const IMPACT = lin(2.4, 0.8, 2.6)
const LAND = lin(0.6, 0.9, 2.4)
const BOOST = lin(0.3, 2.6, 3.0)
const GOO = lin(0.9, 2.6, 0.25) // 吸附井的黏液
const FUEL = lin(0.6, 1.6, 3.4) // H2 燃料
const SLAMC = lin(3.2, 2.2, 0.45) // 砸地：金色
const LEG_N = 44
const STRAND_N = 9 // 黏丝最多几根
const STRAND_SEG = 10 // 每根黏丝分几段画
const LEG_LEN = 0.34
const UP = new THREE.Vector3(0, 1, 0)
// 画面坐标：walker 永远在正中上方、面朝 +z；星球在脚下转（球心在 (0, -R, 0)）
const PLANET_POS = new THREE.Vector3(0, -PLANET_R, 0)
const KEY_DIR = new THREE.Vector3(-0.3, 0.9, 0.32).normalize()

export default function World() {
  const [resetKey, setResetKey] = useState(0)
  const [density, setDensity] = useState<Density>('MT')
  const ctl = useControls({
    roll: { label: 'Rolling', value: true },
    quality: { label: 'Quality', value: 'high', options: { High: 'high', Fast: 'smooth' } },
    camDist: { label: 'Cam distance', value: 6.4, min: 3, max: 14, step: 0.1 },
    camHeight: { label: 'Cam height', value: 3.0, min: 0.8, max: 8, step: 0.1 },
  })
  const hq = ctl.quality === 'high'

  // 一局两分钟：开始界面 / 结算界面里选赛道（1/2/3）；结算界面 Enter 再来一局（开始界面的 Enter 由界面的引导页处理）；局中 R 重开、Esc 回开始界面
  useEffect(() => {
    const idle = () => game.phase === 'menu' || game.phase === 'over'
    const pick = (d: Density) => {
      if (idle()) setDensity(d)
    }
    const start = () => {
      game.phase = 'count'
      game.count = 3
      game.t = GAME_T
      game.score = 0
      game.stats = newStats()
      game.learned = []
      game.newBest = false
      game.run++
      setResetKey((k) => k + 1)
    }
    const menu = () => {
      game.phase = 'menu'
      setResetKey((k) => k + 1)
    }
    actions.setDensity = pick
    actions.start = start
    actions.menu = menu
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Digit1') pick('LT')
      if (e.code === 'Digit2') pick('MT')
      if (e.code === 'Digit3') pick('HT')
      // 开始界面里 Enter 用来翻引导页（由界面处理）；这里只管结算界面的“再来一局”
      if ((e.code === 'Enter' || e.code === 'Space') && game.phase === 'over') start()
      if (e.code === 'KeyR' && !idle()) start()
      if (e.code === 'Escape' && game.phase !== 'menu') menu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setDpr = useThree((s) => s.setDpr)
  useEffect(() => setDpr(hq ? Math.min(2, window.devicePixelRatio) : 1), [hq, setDpr])

  // ---------------- H1 位点（星球局部坐标；resetKey 变了换一套随机布局）
  const sites = useMemo(() => makeSites(DENSITY[density].spacing, 7 + resetKey), [density, resetKey])
  const planet = useRef<THREE.Group>(null!)
  const stems = useRef<THREE.InstancedMesh>(null!)
  const loops = useRef<THREE.InstancedMesh>(null!)

  // ---------------- walker
  const legDirs = useMemo(() => {
    const out: THREE.Vector3[] = []
    for (let i = 0; i < LEG_N; i++) {
      const y = 1 - (2 * (i + 0.5)) / LEG_N
      const r = Math.sqrt(1 - y * y)
      const a = i * Math.PI * (3 - Math.sqrt(5))
      out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r))
    }
    return out
  }, [])
  const legGeo = useMemo(() => new THREE.CylinderGeometry(0.02, 0.026, LEG_LEN, 5).translate(0, LEG_LEN / 2, 0), [])
  const tetherGeo = useMemo(() => new THREE.CylinderGeometry(0.022, 0.022, 1, 6).translate(0, 0.5, 0), [])
  const stemGeo = useMemo(() => new THREE.CylinderGeometry(0.026, 0.03, STEM, 5, 1, true), [])
  const loopGeo = useMemo(() => new THREE.TorusGeometry(0.085, 0.03, 4, 10), [])
  const walkerG = useRef<THREE.Group>(null!)
  const ballG = useRef<THREE.Group>(null!)
  const stubs = useRef<THREE.InstancedMesh>(null!)
  const tips = useRef<THREE.InstancedMesh>(null!)
  const tethers = useRef<THREE.InstancedMesh>(null!)
  // 吸附井的黏丝：每根分几段画（中间细、两头粗，越拉越细），两头各有一滴黏液；球面上罩一层黏液
  const strandSegs = useRef<THREE.InstancedMesh>(null!)
  const strandBlobs = useRef<THREE.InstancedMesh>(null!)
  const glaze = useRef<THREE.Mesh>(null!)
  const glazeMat = useRef<THREE.MeshStandardMaterial>(null!)
  const segGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 7).translate(0, 0.5, 0), [])
  const glow = useMemo(glowTexture, [])
  const fx = useMemo(() => new Fx(), [])
  useEffect(() => () => fx.dispose(), [fx])

  // 每帧用到的状态都放在 ref 里，不触发重渲染
  const st = useRef({
    w: newWalker() as WalkerState,
    ballQ: new THREE.Quaternion(),
    planetQ: new THREE.Quaternion(),
    planetM: new THREE.Matrix4(),
    legBusy: new Int32Array(LEG_N), // 0 = 空闲，否则 = 位点编号 + 1
    legScale: new Float32Array(LEG_N).fill(1),
    legOf: new Map<number, number>(),
    origin: new Map<number, THREE.Vector3>(),
    age: new Map<number, number>(),
    recent: [] as { i: number; t: number; c: THREE.Color }[], // 刚打开的发夹：从 c（亮绿 / 砸地的金色）褪成青绿轨迹
    penalty: 0, // 这一局撞车扣掉的分
    turn: 0,
    vel: 0,
    spin: new THREE.Vector3(), // 球的角速度（画面坐标）
    pending: 0,
    snap: false,
    fxAmt: 0,
    dustT: 0,
    camY: 3,
    camVY: 0,
    lookY: 0.5,
    shake: 0,
    punch: 0,
    lastRegime: 'roll',
    regimeT: 0,
    boosting: false,
    // 黏丝：anchor 是地面上的粘点（星球局部坐标），off 是球上的粘点方向（画面坐标），age 用来做“长出来”的动画
    strands: [] as { anchor: THREE.Vector3; off: THREE.Vector3; age: number; phase: number }[],
    strandT: 0,
    // 第一次遇到各种情况累计了多久（够久才弹知识卡）
    gripT: 0,
    slipT: 0,
    burntT: 0,
    trapT: 0,
    pinT: 0,
    init: false,
  })
  const cand = useMemo<number[]>(() => [], [])
  const tmp = useMemo(() => ({
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), n: new THREE.Vector3(), u: new THREE.Vector3(),
    q: new THREE.Quaternion(), m: new THREE.Matrix4(), basis: new THREE.Matrix4(), s: new THREE.Vector3(), col: new THREE.Color(),
    one: new THREE.Vector3(1, 1, 1), key: new THREE.Vector3(), ball: new THREE.Vector3(),
    inv: new THREE.Matrix4(), e: new THREE.Vector3(), g: new THREE.Vector3(), h: new THREE.Vector3(),
  }), [])

  // 换赛道 / 重来：摆放位点、复原 walker
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
    for (let i = 0; i < sites.n; i++) {
      v.set(sites.nx[i], sites.ny[i], sites.nz[i])
      q.setFromUnitVectors(UP, v)
      qy.setFromAxisAngle(UP, (i * 2.399963) % (Math.PI * 2))
      q.multiply(qy)
      m.compose(new THREE.Vector3(sites.x[i], sites.y[i], sites.z[i]).addScaledVector(v, STEM / 2), q, one)
      stems.current.setMatrixAt(i, m)
      m.compose(new THREE.Vector3(sites.tx[i], sites.ty[i], sites.tz[i]).addScaledVector(v, 0.07), q, one)
      loops.current.setMatrixAt(i, m)
      loops.current.setColorAt(i, FRESH)
    }
    stems.current.instanceMatrix.needsUpdate = true
    loops.current.instanceMatrix.needsUpdate = true
    if (loops.current.instanceColor) loops.current.instanceColor.needsUpdate = true
    stems.current.computeBoundingSphere()
    loops.current.computeBoundingSphere()
    const S = st.current
    S.w = newWalker()
    S.legBusy.fill(0)
    S.legOf.clear()
    S.origin.clear()
    S.age.clear()
    S.recent.length = 0
    S.pending = 0
    S.spin.set(0, 0, 0)
    S.strands.length = 0
    S.gripT = S.slipT = S.burntT = S.trapT = S.pinT = 0
    S.penalty = 0
    S.init = false
    view.yaw = 0
    view.fuelCD = S.w.fuelCD
    hud.density = density
    hud.signal = 0
  }, [sites, density])

  // 腿尖、连线的初始颜色（颜色属性要在第一次绘制前建好）
  useLayoutEffect(() => {
    for (let j = 0; j < LEG_N; j++) tips.current.setColorAt(j, TIP)
    for (let k = 0; k < MAX_LEGS; k++) tethers.current.setColorAt(k, BOUND)
    tethers.current.count = 0
    strandSegs.current.count = 0
    strandBlobs.current.count = 0
  }, [])

  const moonLight = useRef<THREE.DirectionalLight>(null!)
  const lightTarget = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    moonLight.current.target = lightTarget
  }, [lightTarget])

  const [, getKeys] = useKeyboardControls<Controls>()

  // 调试用：在浏览器控制台里 __dnf.goTrapZone(k) / goWell(k) / goCrystal(k) 直接跳到第 k 个自陷区 / 吸附井 / 晶体柱跟前，面朝它
  useEffect(() => {
    const goTo = (m: { c: THREE.Vector3; r: number }) => {
      const a = new THREE.Vector3(-m.c.z, 0, m.c.x).normalize()
      const u = m.c.clone().applyAxisAngle(a, -m.r * 1.6).normalize()
      const w = st.current.w
      w.p.copy(u).multiplyScalar(PLANET_R + terrainH(u.x, u.y, u.z) + 1)
      w.f.copy(m.c).addScaledVector(u, -m.c.dot(u)).normalize()
      w.v.set(0, 0, 0)
      w.rest = false
    }
    ;(globalThis as unknown as { __dnf: object }).__dnf = {
      goTrapZone: (k: number) => goTo(TERRAIN.moguls[k % TERRAIN.moguls.length]),
      goWell: (k: number) => goTo(TERRAIN.wells[k % TERRAIN.wells.length]),
      goCrystal: (k: number) => goTo({ c: TERRAIN.crystals[k % TERRAIN.crystals.length].c, r: 4 / PLANET_R }),
    }
  }, [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const S = st.current
    const w = S.w
    const s = sites
    // ---- 一局的流程：倒计时 3 秒 → 两分钟 → 结算；只有比赛时间里能开
    if (game.phase === 'count') {
      game.count -= dt
      if (game.count <= 0) {
        game.count = 0
        game.phase = 'play'
        game.t = GAME_T
      }
    } else if (game.phase === 'play') {
      game.t -= dt
      if (game.t <= 0) {
        game.t = 0
        game.phase = 'over'
        game.score = Math.max(0, w.signal - S.penalty)
        sfx.finish()
        if (game.score > game.best[density]) {
          game.best[density] = game.score
          game.newBest = true
          saveBest()
        }
      }
    }
    const live = game.phase === 'play'
    const keys = getKeys()
    const move = live ? (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0) : 0
    const turnIn = live ? (keys.left ? 1 : 0) - (keys.right ? 1 : 0) : 0
    // 转向有加速和回正
    S.turn += (turnIn - S.turn) * (1 - Math.exp(-7 * dt))
    if (!turnIn && Math.abs(S.turn) < 1e-3) S.turn = 0

    // ---- 坐标换算：星球局部 → 画面（用上一帧的星球朝向；结合事件发生在本帧积分之前）
    const topWorld = (i: number, out: THREE.Vector3) => out.set(s.tx[i], s.ty[i], s.tz[i]).applyMatrix4(S.planetM)
    const legWorld = (j: number, out: THREE.Vector3) => out.copy(legDirs[j]).applyQuaternion(S.ballQ)
    const ball = tmp.ball
    const bestLeg = (dir: THREE.Vector3) => {
      let best = -2, bj = -1
      for (let j = 0; j < LEG_N; j++) {
        if (S.legBusy[j]) continue
        const dd = legWorld(j, tmp.c).dot(dir)
        if (dd > best) {
          best = dd
          bj = j
        }
      }
      return [bj, best] as const
    }
    const assign = (i: number) => {
      const dir = topWorld(i, tmp.a).sub(ball).normalize()
      const [j] = bestLeg(dir)
      if (j < 0) return
      S.legBusy[j] = i + 1
      S.legOf.set(i, j)
      S.origin.set(i, legWorld(j, new THREE.Vector3()).multiplyScalar(WALKER_R).add(ball))
      S.age.set(i, 0)
    }
    const release = (i: number) => {
      const j = S.legOf.get(i)
      if (j !== undefined) S.legBusy[j] = 0
      S.legOf.delete(i)
      S.origin.delete(i)
      S.age.delete(i)
    }

    // ---- 规则 + 物理（model.ts）；特效发在星球局部坐标里，跟着星球走
    let recolor = false
    const paint = (i: number, c: THREE.Color) => {
      loops.current.setColorAt(i, c)
      recolor = true
    }
    if (!S.init) ball.set(0, w.p.length() - PLANET_R, 0)
    stepWalker(w, s, { move, turn: S.turn }, dt, cand, (i, k) => {
      const nv = tmp.n.set(s.nx[i], s.ny[i], s.nz[i])
      if (k === 1) {
        paint(i, BOUND)
        assign(i)
        fx.emit(s.tx[i], s.ty[i], s.tz[i], 3, SPARK, { speed: 0.5, size: 0.03, life: 0.35, normal: nv })
      } else if (k === 2) {
        paint(i, FLASH)
        release(i)
        S.recent.push({ i, t: 0, c: FLASH })
        fx.emit(s.tx[i], s.ty[i], s.tz[i], 12, FLASH, { speed: 1.3, up: 1.5, size: 0.05, life: 0.9, gravity: -1.1, normal: nv })
        fx.emit(s.tx[i], s.ty[i], s.tz[i], 1, DUPLEX, { speed: 0.25, up: 1, size: 0.11, life: 2.6, gravity: -0.35, normal: nv })
        fx.ring(s.x[i] + nv.x * 0.03, s.y[i] + nv.y * 0.03, s.z[i] + nv.z * 0.03, nv, RING, 0.75, 0.7)
        sfx.pickup()
      } else if (k === 3) {
        // 被砸地震开的：闪金光，各冒一颗金色火星（一次可能几十个，特效从简）
        paint(i, SLAMC)
        S.recent.push({ i, t: 0, c: SLAMC })
        fx.emit(s.tx[i], s.ty[i], s.tz[i], 1, SLAMC, { speed: 0.6, up: 2.2, size: 0.07, life: 1.1, gravity: -0.6, normal: nv })
      } else {
        paint(i, FRESH)
        release(i)
        fx.emit(s.tx[i], s.ty[i], s.tz[i], 4, SPARK, { speed: 0.8, size: 0.03, life: 0.4, normal: nv })
      }
    })
    const ev = w.ev
    const regime = regimeOf(w)
    const n0 = w.bound.length

    // ---- 星球的朝向：让 walker 脚下那点转到正下方、朝向转到 +z
    const u = tmp.u.copy(w.p).normalize()
    tmp.a.crossVectors(u, w.f)
    tmp.basis.makeBasis(tmp.a, u, w.f).transpose()
    S.planetQ.setFromRotationMatrix(tmp.basis)
    S.planetM.compose(PLANET_POS, S.planetQ, tmp.one)
    planet.current.quaternion.copy(S.planetQ)
    view.yaw = w.turnAcc
    const ballY = w.p.length() - PLANET_R
    const groundY = terrainH(u.x, u.y, u.z)
    const gap = ballY - groundY

    // ---- 落地、起跳、撞击、重新抓住：特效 + 镜头震动 + 播报
    const footL = tmp.d.copy(u).multiplyScalar(PLANET_R + groundY + 0.05) // 脚下那点（星球局部坐标）
    if (ev.launch) fx.emit(footL.x, footL.y, footL.z, 14, DUST, { speed: 1.4, up: 0.8, size: 0.07, life: 0.7, gravity: 0.6, spread: 0.6, normal: u })
    // 冲刺台：坡面上一路喷青色尾焰；冲出去那一刻爆一圈光、镜头“顿”一下
    if (ev.boost) {
      tmp.b.copy(footL).addScaledVector(w.f, -0.4)
      fx.emit(tmp.b.x, tmp.b.y, tmp.b.z, 3, BOOST, { speed: 1.2, up: 0.5, size: 0.07, life: 0.45, gravity: 0, spread: 0.5, normal: u })
      if (!S.boosting) {
        announce('BOOST', 'air')
        sfx.turbo()
      }
      S.boosting = true
    } else if (!w.airborne) S.boosting = false
    if (ev.rampLaunch) {
      fx.ring(footL.x, footL.y, footL.z, u, BOOST, 2.6, 0.6)
      fx.emit(footL.x, footL.y, footL.z, 30, BOOST, { speed: 3, up: 1.2, size: 0.08, life: 0.8, gravity: 0.4, spread: 0.6, normal: u })
      S.punch = 1.4
      sfx.jump()
    }
    // 冲刺台落地后的惯性保留：贴地掠过时身后拖一道青色尾迹
    if (w.carry > 0 && !w.airborne) {
      tmp.b.copy(footL).addScaledVector(w.f, -0.6)
      fx.emit(tmp.b.x, tmp.b.y, tmp.b.z, 2, BOOST, { speed: 0.4, up: 0.3, size: 0.06, life: 0.6, gravity: 0, spread: 0.3, normal: u })
    }
    if (ev.airTime > 0 || ev.land > 1.2) {
      const k = Math.min(1, Math.max(ev.land / 5, ev.airTime))
      fx.ring(footL.x, footL.y, footL.z, u, LAND, 1.2 + 2.2 * k, 0.8)
      fx.emit(footL.x, footL.y, footL.z, Math.round(10 + 24 * k), DUST, { speed: 1.5 + 2 * k, up: 0.7, size: 0.08, life: 0.8, gravity: 0.8, spread: 0.7, normal: u })
      S.shake = Math.max(S.shake, 0.08 + 0.25 * k)
      if (ev.airTime > 0.45) announce(`BIG AIR  ${ev.airTime.toFixed(1)}s`, 'air')
      if (!ev.slam) sfx.land(k)
    }
    // 砸地：两道金色冲击环扩到冲击圈那么大，一大团金光，镜头重重一震；得分单独大字强调
    if (ev.slam) {
      fx.ring(footL.x, footL.y, footL.z, u, SLAMC, ev.slamR / 1.15, 0.7)
      fx.ring(footL.x, footL.y, footL.z, u, SLAMC, ev.slamR / 1.7, 0.5)
      fx.emit(footL.x, footL.y, footL.z, 46, SLAMC, { speed: 3.5, up: 1.4, size: 0.09, life: 0.9, gravity: 1, spread: 0.8, normal: u })
      S.shake = Math.max(S.shake, 0.45)
      S.punch = 1.8
      sfx.slam(ev.slam)
      if (live) {
        award('slam', ev.slam, ev.slamH, ev.slamD)
        game.stats.slams++
        game.stats.bestSlam = Math.max(game.stats.bestSlam, ev.slam)
      }
    }
    if (ev.hit > 0.6) {
      const k = Math.min(1, ev.hit / 6)
      fx.emit(ev.hitAt.x, ev.hitAt.y, ev.hitAt.z, Math.round(12 + 26 * k), IMPACT, { speed: 2 + 3 * k, up: 0.5, size: 0.06, life: 0.6, gravity: 1, spread: 0.3, normal: u })
      S.shake = Math.max(S.shake, 0.12 + 0.3 * k)
      // 撞车（比赛中）：扣分，单独大字强调；轻轻擦到只播 IMPACT
      if (ev.crash && live) {
        S.penalty += CRASH_COST
        game.stats.crashes++
        award('crash', CRASH_COST)
        sfx.crash()
      } else if (!ev.crash) announce('IMPACT', 'trap')
    }
    if (ev.latch) {
      fx.ring(footL.x, footL.y, footL.z, u, LATCH, 2.2, 0.55)
      S.punch = 1
      announce(`LATCH ×${ev.latch}`, 'latch')
      sfx.latch()
    }
    // 吸附井：粘满那一下溅一圈黏液、镜头一沉；每挣断一根溅一点；挣脱时爆一圈
    if (ev.adsorb) {
      fx.ring(footL.x, footL.y, footL.z, u, GOO, 2.4, 0.7)
      fx.emit(footL.x, footL.y, footL.z, 26, GOO, { speed: 1.6, up: 0.9, size: 0.08, life: 0.8, gravity: 1.2, spread: 0.6, normal: u })
      S.shake = Math.max(S.shake, 0.22)
      announce('ADSORBED', 'stuck')
      sfx.bog()
    }
    if (ev.snap) sfx.snap()
    if (ev.freed) {
      fx.ring(footL.x, footL.y, footL.z, u, GOO, 3.2, 0.6)
      S.punch = 1.2
      announce('BREAK FREE', 'roll')
      sfx.breakFree()
    }
    // H2 燃料：捡起的地方爆一团蓝光，镜头往前一冲
    if (ev.fuel) {
      const fp = TERRAIN.fuels[ev.fuel - 1].p
      fx.emit(fp.x, fp.y, fp.z, 34, FUEL, { speed: 2.4, up: 0.8, size: 0.07, life: 0.9, gravity: 0, spread: 0.3, normal: u })
      fx.ring(footL.x, footL.y, footL.z, u, FUEL, 2.6, 0.6)
      S.punch = 1.4
      announce('H2 BOOST', 'fuel')
      sfx.nitro()
    }
    // 加速期间：球周围绕着细碎的蓝光，贴地时身后拖一道蓝色尾迹
    if (w.fuelT > 0) {
      if (Math.random() < 0.6) {
        tmp.b.copy(w.p).add(tmp.c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.3))
        fx.emit(tmp.b.x, tmp.b.y, tmp.b.z, 1, FUEL, { speed: 0.3, up: 0.6, size: 0.04, life: 0.5, gravity: -0.4, normal: u })
      }
      if (!w.airborne) {
        tmp.b.copy(footL).addScaledVector(w.f, -0.6)
        fx.emit(tmp.b.x, tmp.b.y, tmp.b.z, 2, FUEL, { speed: 0.4, up: 0.3, size: 0.06, life: 0.6, gravity: 0, spread: 0.3, normal: u })
      }
    }
    // 状态变化播报（腾空不单独播，落地时播 BIG AIR；被粘住另外播）
    S.regimeT += dt
    if (regime !== S.lastRegime && regime !== 'air' && S.lastRegime !== 'air' && regime !== 'stuck' && S.lastRegime !== 'stuck' && move && S.regimeT > 0.8) {
      announce(regime === 'roll' ? 'GRIP' : regime === 'slip' ? 'SLIP' : regime === 'trap' ? 'TRAPPED' : 'PINNED', regime === 'pin' ? 'trap' : regime)
      if (regime === 'trap' || regime === 'pin') sfx.tangle()
      S.regimeT = 0
    }
    if (regime !== 'air') S.lastRegime = regime

    // ---- 一局里的统计和 walking 小知识（第一次遇到某种情况、并持续一小会儿才弹）
    if (live) {
      const st2 = game.stats
      st2.topSpeed = Math.max(st2.topSpeed, w.vel * V_MAX * SPEED_UNIT)
      if (ev.airTime) st2.airMax = Math.max(st2.airMax, ev.airTime)
      if (ev.rampLaunch) st2.ramps++
      if (ev.fuel) st2.fuel++
      if (regime === 'trap') st2.trapT += dt
      if (regime === 'stuck') st2.stuckT += dt
      game.score = Math.max(0, w.signal - S.penalty)
      if (w.signal > 0) teach('signal')
      S.gripT = regime === 'roll' && n0 >= 5 && n0 <= 8 ? S.gripT + dt : 0
      S.slipT = regime === 'slip' && !w.burnt ? S.slipT + dt : 0
      S.burntT = w.burnt && move ? S.burntT + dt : 0
      S.trapT = regime === 'trap' ? S.trapT + dt : 0
      S.pinT = regime === 'pin' ? S.pinT + dt : 0
      if (S.gripT > 1.2) teach('grip')
      if (S.slipT > 1.0) teach('slip')
      if (S.burntT > 0.5) teach('burnt')
      if (S.trapT > 0.8) teach('trap')
      if (S.pinT > 0.8) teach('pin')
      if (ev.adsorb) teach('stuck')
      if (ev.fuel) teach('fuel')
    }

    // ---- 球的滚动：贴地时按速度滚（打滑只转三成，被卡住 / 钉住时一卡一顿）；腾空时保持原来的转速慢慢衰减
    const vView = tmp.c.copy(w.v).applyQuaternion(S.planetQ)
    vView.y = 0
    if (ctl.roll) {
      if (!w.airborne) {
        const sp = vView.length()
        const axis = tmp.a.set(vView.z, 0, -vView.x)
        if (sp > 1e-4) axis.divideScalar(sp)
        S.spin.copy(axis).multiplyScalar((sp / WALKER_R) * (regime === 'slip' ? 0.3 : 1))
      } else S.spin.multiplyScalar(Math.exp(-0.4 * dt))
      let ang = S.spin.length() * dt
      if (regime === 'trap' || regime === 'pin') {
        S.pending += ang
        ang = 0
        if (S.pending > 0.3) S.snap = true
        if (S.snap) {
          ang = S.pending * (1 - Math.exp(-26 * dt))
          S.pending -= ang
          if (S.pending < 0.015) S.snap = false
        }
      } else if (S.pending) {
        ang += S.pending
        S.pending = 0
      }
      if (ang > 1e-6) S.ballQ.premultiply(tmp.q.setFromAxisAngle(tmp.a.copy(S.spin).normalize(), ang))
    }

    // ---- 位置上的“手感”：只在踩油门时出现，松手后平滑消失
    S.fxAmt += ((move ? 1 : 0) - S.fxAmt) * (1 - Math.exp(-6 * dt))
    if (S.fxAmt < 1e-3) S.fxAmt = 0
    ball.set(0, ballY, 0)
    if (S.fxAmt && !w.airborne) {
      if (regime === 'trap' || regime === 'pin') {
        ball.z += (Math.sin(t * 31) * 0.016 - 0.05) * w.trap * S.fxAmt
        ball.y -= 0.04 * w.trap * S.fxAmt
      } else if (regime === 'slip') ball.x += Math.sin(t * 6.5) * 0.07 * S.fxAmt
    }
    if (regime === 'slip' && move) {
      S.dustT += dt
      if (S.dustT > 0.06) {
        S.dustT = 0
        tmp.b.copy(footL).addScaledVector(w.f, -0.35)
        fx.emit(tmp.b.x, tmp.b.y, tmp.b.z, 2, DUST, { speed: 0.6, up: 0.6, size: 0.06, life: 0.6, gravity: 0.5, spread: 0.4, normal: u })
      }
    }
    walkerG.current.position.copy(ball)
    ballG.current.quaternion.copy(S.ballQ)

    // ---- 结合的腿：从球面上那条腿的根部连到 H1 发夹；球转过去太多就换一条相邻的腿接手
    const b = w.bound
    const n = b.length
    for (let k = 0; k < n; k++) {
      const i = b[k]
      let j = S.legOf.get(i)
      if (j === undefined) {
        assign(i)
        j = S.legOf.get(i)
        if (j === undefined) continue
      }
      const tp = topWorld(i, tmp.b)
      const dir = tmp.c.copy(tp).sub(ball).normalize()
      const cur = legWorld(j, tmp.a).dot(dir)
      if (cur < 0.5) {
        S.legBusy[j] = 0
        const [jj, best] = bestLeg(dir)
        if (jj >= 0 && best > cur + 0.15) j = jj
        S.legBusy[j] = i + 1
        S.legOf.set(i, j)
      }
      const anchor = legWorld(j, tmp.a).multiplyScalar(WALKER_R * 0.97).add(ball)
      let org = S.origin.get(i)
      if (!org) S.origin.set(i, (org = anchor.clone()))
      org.lerp(anchor, 1 - Math.exp(-22 * dt))
      const age = (S.age.get(i) ?? 0) + dt
      S.age.set(i, age)
      const vec = tmp.c.copy(tp).sub(org)
      const len = vec.length()
      const grow = Math.min(1, age / 0.1)
      tmp.q.setFromUnitVectors(UP, vec.divideScalar(len || 1))
      tmp.m.compose(org, tmp.q, tmp.s.set(1 + 0.6 * (1 - grow), len * grow, 1 + 0.6 * (1 - grow)))
      tethers.current.setMatrixAt(k, tmp.m)
      const tension = THREE.MathUtils.clamp((len - 1.0) / (LEG_BREAK - 1.0), 0, 1)
      tethers.current.setColorAt(k, tmp.col.copy(grow < 1 ? LATCH : BOUND).lerp(TAUT, tension))
    }
    tethers.current.count = n
    tethers.current.instanceMatrix.needsUpdate = true
    if (tethers.current.instanceColor) tethers.current.instanceColor.needsUpdate = true

    // ---- 吸附井的黏丝：粘满时一根接一根长出来；挣扎时被拉长、变细、抖动；每挣断一根少一根，挣脱时全断
    const SS = S.strands
    const want = w.held ? Math.min(STRAND_N, Math.max(2, Math.round((w.stick - 0.16) / 0.12) + 2)) : 0
    tmp.inv.copy(S.planetM).invert()
    const ends = (k: number) => {
      const sd = SS[k]
      tmp.e.copy(sd.anchor).applyMatrix4(S.planetM)
      tmp.g.copy(sd.off).multiplyScalar(WALKER_R * 0.95).add(ball)
      return tmp.e.distanceTo(tmp.g)
    }
    const snapStrand = (k: number) => {
      ends(k)
      // 断点在黏丝中间，溅出几滴黏液（特效在星球局部坐标里）
      tmp.h.copy(tmp.e).lerp(tmp.g, 0.5).applyMatrix4(tmp.inv)
      fx.emit(tmp.h.x, tmp.h.y, tmp.h.z, 10, GOO, { speed: 1.4, up: 0.6, size: 0.05, life: 0.6, gravity: 1.4, spread: 0.2, normal: u })
      SS.splice(k, 1)
    }
    const longest = () => {
      let best = -1, bk = 0
      for (let k = 0; k < SS.length; k++) {
        const len = ends(k)
        if (len > best) {
          best = len
          bk = k
        }
      }
      return bk
    }
    for (let k = 0; k < ev.snap && SS.length; k++) snapStrand(longest())
    while (SS.length > want) snapStrand(longest())
    for (let k = SS.length - 1; k >= 0; k--) if (ends(k) > 3.8) snapStrand(k)
    S.strandT -= dt
    if (SS.length < want && S.strandT <= 0) {
      S.strandT = 0.05
      const ang = Math.random() * Math.PI * 2, dist = (1.0 + Math.random() * 1.0) / PLANET_R
      tmp.a.crossVectors(u, w.f)
      const dir = tmp.e.copy(u).addScaledVector(w.f, Math.cos(ang) * dist).addScaledVector(tmp.a, Math.sin(ang) * dist).normalize()
      const anchor = dir.clone().multiplyScalar(PLANET_R + terrainH(dir.x, dir.y, dir.z) + 0.03)
      const side = tmp.g.copy(anchor).applyMatrix4(S.planetM).sub(ball)
      side.y = 0
      const off = side.normalize().multiplyScalar(0.9).add(tmp.h.set(0, -0.3, 0)).normalize().clone()
      SS.push({ anchor, off, age: 0, phase: Math.random() * Math.PI * 2 })
    }
    let si = 0, bi = 0
    for (const sd of SS) {
      sd.age += dt
      const A = tmp.e.copy(sd.anchor).applyMatrix4(S.planetM)
      const B = tmp.g.copy(sd.off).multiplyScalar(WALKER_R * 0.95).add(ball)
      const stretch = Math.max(0, A.distanceTo(B) / 1.8 - 1)
      const grow = Math.min(1, sd.age / 0.18)
      // 二次贝塞尔：控制点在中点往下垂（越拉越直），再加一点抖动
      const Cp = tmp.h.copy(A).add(B).multiplyScalar(0.5)
      Cp.y -= Math.max(0, 0.6 - 0.35 * stretch)
      Cp.x += Math.sin(t * 9 + sd.phase) * 0.04
      Cp.z += Math.cos(t * 7 + sd.phase) * 0.04
      const p0 = tmp.a.copy(A)
      for (let k = 1; k <= STRAND_SEG; k++) {
        const s1 = (k / STRAND_SEG) * grow
        const k0 = (1 - s1) * (1 - s1), k1 = 2 * (1 - s1) * s1, k2 = s1 * s1
        const p1 = tmp.b.set(k0 * A.x + k1 * Cp.x + k2 * B.x, k0 * A.y + k1 * Cp.y + k2 * B.y, k0 * A.z + k1 * Cp.z + k2 * B.z)
        const mid = ((k - 0.5) / STRAND_SEG) * grow
        const rad = (0.1 * (0.4 + 0.6 * Math.pow(Math.abs(2 * mid - 1), 1.6))) / (1 + 0.9 * stretch)
        const seg = tmp.c.copy(p1).sub(p0)
        const len = seg.length()
        tmp.q.setFromUnitVectors(UP, seg.divideScalar(len || 1))
        tmp.m.compose(p0, tmp.q, tmp.s.set(rad, len, rad))
        strandSegs.current.setMatrixAt(si++, tmp.m)
        p0.copy(p1)
      }
      tmp.q.identity()
      tmp.m.compose(A, tmp.q, tmp.s.set(0.12, 0.05, 0.12))
      strandBlobs.current.setMatrixAt(bi++, tmp.m)
      if (grow >= 1) {
        tmp.m.compose(B, tmp.q, tmp.s.set(0.07, 0.07, 0.07))
        strandBlobs.current.setMatrixAt(bi++, tmp.m)
      }
    }
    strandSegs.current.count = si
    strandBlobs.current.count = bi
    strandSegs.current.instanceMatrix.needsUpdate = true
    strandBlobs.current.instanceMatrix.needsUpdate = true
    // 球面上的一层黏液：粘住时浮现，挣脱后褪掉
    const glazeTo = w.held ? 0.3 + 0.25 * w.stick : 0
    glazeMat.current.opacity += (glazeTo - glazeMat.current.opacity) * (1 - Math.exp(-8 * dt))
    glaze.current.visible = glazeMat.current.opacity > 0.01

    // ---- 空闲的腿：结合时缩回；松开后伸出；腾空快落地时，朝下的腿提前伸长去“够”地面
    const reachOut = w.airborne ? THREE.MathUtils.clamp((3.2 - gap) / 1.6, 0, 1) : 0
    let legDirty = !S.init || reachOut > 0 || w.airborne
    for (let j = 0; j < LEG_N; j++) {
      const down = Math.max(0, -legWorld(j, tmp.a).y)
      const target = S.legBusy[j] ? 0 : 1 + reachOut * down * 1.4
      let sc = S.legScale[j]
      if (sc === target) continue
      sc += (target - sc) * (1 - Math.exp(-14 * dt))
      if (Math.abs(target - sc) < 1e-3) sc = target
      S.legScale[j] = sc
      legDirty = true
    }
    if (legDirty) {
      for (let j = 0; j < LEG_N; j++) {
        const sc = Math.max(1e-4, S.legScale[j])
        tmp.q.setFromUnitVectors(UP, legDirs[j])
        tmp.m.compose(tmp.a.copy(legDirs[j]).multiplyScalar(WALKER_R), tmp.q, tmp.s.set(1, sc, 1))
        stubs.current.setMatrixAt(j, tmp.m)
        const ts = Math.min(1, sc)
        tmp.m.compose(tmp.a.copy(legDirs[j]).multiplyScalar(WALKER_R + LEG_LEN * sc), tmp.q, tmp.s.set(ts, ts, ts))
        tips.current.setMatrixAt(j, tmp.m)
      }
      stubs.current.instanceMatrix.needsUpdate = true
      tips.current.instanceMatrix.needsUpdate = true
    }

    // ---- 刚打开的位点：亮绿慢慢褪成青绿轨迹
    for (let k = S.recent.length - 1; k >= 0; k--) {
      const r = S.recent[k]
      r.t += dt
      const f = THREE.MathUtils.smoothstep(r.t, 0, 2.5)
      paint(r.i, tmp.col.copy(r.c).lerp(TRAIL, f))
      if (f >= 1) S.recent.splice(k, 1)
    }
    if (recolor && loops.current.instanceColor) loops.current.instanceColor.needsUpdate = true
    fx.update(dt)

    // ---- 第三人称镜头：高度用弹簧跟随（起跳时球先冲出去、镜头再追上）；越快拉得越远、视角越宽；
    //      转弯时向外甩一点并侧倾；落地 / 撞击时短暂震动；重新抓住地面时视角“顿”一下
    S.vel += (w.vel - S.vel) * (1 - Math.exp(-5 * dt))
    if (!move && S.vel < 1e-3) S.vel = 0
    const vf = Math.min(1.2, S.vel)
    const targetY = ballY + ctl.camHeight
    if (!S.init) {
      S.camY = targetY
      S.camVY = 0
      S.lookY = ballY - 0.9
    }
    S.camVY += (40 * (targetY - S.camY) - 9 * S.camVY) * dt
    S.camY += S.camVY * dt
    if (Math.abs(targetY - S.camY) < 1e-4 && Math.abs(S.camVY) < 1e-4) {
      S.camY = targetY
      S.camVY = 0
    }
    S.lookY += (ballY - 0.9 - S.lookY) * (1 - Math.exp(-8 * dt))
    S.shake *= Math.exp(-7 * dt)
    if (S.shake < 2e-3) S.shake = 0
    S.punch *= Math.exp(-6 * dt)
    if (S.punch < 2e-3) S.punch = 0
    const sx = S.shake ? (Math.sin(t * 61) + Math.sin(t * 37)) * 0.5 * S.shake : 0
    const sy = S.shake ? (Math.sin(t * 53) + Math.sin(t * 29)) * 0.5 * S.shake : 0
    const cam = state.camera as THREE.PerspectiveCamera
    cam.position.set(-S.turn * 0.55 + sx, S.camY + 0.15 * vf + sy, -(ctl.camDist + 0.7 * vf))
    cam.up.set(0, 1, 0)
    cam.lookAt(S.turn * 0.4, S.lookY + 1, 4)
    cam.rotateZ(-S.turn * 0.05)
    const fov = 50 + 12 * vf - 4 * S.punch
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }

    // ---- 投影用的主光：从前上方照下来，跟着天空转
    tmp.key.copy(KEY_DIR).applyAxisAngle(UP, -view.yaw)
    moonLight.current.position.copy(ball).addScaledVector(tmp.key, 40)
    lightTarget.position.copy(ball)
    lightTarget.updateMatrixWorld()

    // ---- 给界面的数
    hud.legs = n
    hud.vel = w.vel
    hud.signal = Math.max(0, w.signal - S.penalty)
    hud.moving = move !== 0
    hud.regime = regime
    hud.stick = w.held ? w.stick : 0
    hud.fuelT = w.fuelT
    hud.carry = w.carry
    view.fuelCD = w.fuelCD
    // 引擎声：比赛中跟着车速、油门和状态走（静止时没有声音），其余时候淡出
    sfx.drive({
      on: game.phase === 'play' || game.phase === 'count', vel: w.vel, throttle: move, air: w.airborne,
      slip: regime === 'slip', stuck: regime === 'stuck', boost: S.boosting || w.carry > 0 || w.fuelT > 0, dt,
    })
    S.init = true
  })

  return (
    <>
      <fog attach="fog" args={[HORIZON, 18, 70]} />
      <Sky />
      <Environment resolution={256} frames={1} environmentIntensity={0.6}>
        <Lightformer form="circle" intensity={8} color="#e3ebff" position={MOON_DIR.clone().multiplyScalar(12).toArray()} scale={3} />
        <Lightformer form="rect" intensity={1.4} color="#6b3dff" position={[0, 0.5, -12]} scale={[40, 4, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#1fd6c0" position={[12, 1, 2]} scale={[30, 4, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#2a3a86" position={[0, 12, 0]} scale={[30, 30, 1]} />
        {[0, 1, 2, 3].map((k) => (
          <Lightformer key={k} form="rect" intensity={1.3} color={k % 2 ? '#ffd38a' : '#c7a4ff'}
            position={[Math.sin((k * Math.PI) / 2 + 0.8) * 10, 2, Math.cos((k * Math.PI) / 2 + 0.8) * 10]} scale={[10, 5, 1]} />
        ))}
        <Lightformer form="rect" intensity={0.9} color="#5a4aa0" position={[0, -8, 0]} scale={[30, 30, 1]} />
      </Environment>
      <hemisphereLight args={['#4a5aa8', '#0d0a1e', 0.6]} />
      <directionalLight ref={moonLight} color="#b9c6ff" intensity={2.6} castShadow={hq} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.04}>
        <orthographicCamera attach="shadow-camera" args={[-10, 10, 10, -10, 1, 90]} />
      </directionalLight>
      <primitive object={lightTarget} />

      {/* DNF 星球：地表、跳台箭头、晶体柱、孢子、H1 位点、周转特效都在这个组里，跟着星球一起转 */}
      <group ref={planet} position={PLANET_POS}>
        <PlanetSurface />
        <RampMarks />
        <TrapZones />
        <Wells />
        <Fuels />
        <Crystals />
        <Spores />
        <instancedMesh key={`stems-${density}-${resetKey}`} ref={stems} args={[stemGeo, undefined, sites.n]}>
          <meshStandardMaterial color="#8f9bd0" roughness={0.45} metalness={0.1} emissive="#141a3d" side={THREE.DoubleSide} />
        </instancedMesh>
        <instancedMesh key={`loops-${density}-${resetKey}`} ref={loops} args={[loopGeo, undefined, sites.n]}>
          <meshBasicMaterial />
        </instancedMesh>
        <primitive object={fx.parts} />
        <primitive object={fx.rings} />
      </group>

      {/* walker：金纳米颗粒 + 一圈 DNA 腿 + 自带的暖光 */}
      <group ref={walkerG}>
        <group ref={ballG}>
          <mesh castShadow>
            <sphereGeometry args={[WALKER_R, 64, 48]} />
            <meshPhysicalMaterial color="#ffc85a" metalness={1} roughness={0.2} clearcoat={1} clearcoatRoughness={0.08} envMapIntensity={3.2} emissive="#3d2400" emissiveIntensity={0.5} />
          </mesh>
          <instancedMesh ref={stubs} args={[legGeo, undefined, LEG_N]} castShadow frustumCulled={false}>
            <meshStandardMaterial color="#5fa8ff" roughness={0.35} emissive="#16357a" />
          </instancedMesh>
          <instancedMesh ref={tips} args={[undefined, undefined, LEG_N]} frustumCulled={false}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshBasicMaterial />
          </instancedMesh>
        </group>
        <mesh ref={glaze} visible={false}>
          <sphereGeometry args={[WALKER_R * 1.07, 40, 30]} />
          <meshStandardMaterial ref={glazeMat} color="#9dff2e" emissive="#3d8f00" emissiveIntensity={0.9} roughness={0.08} transparent opacity={0} depthWrite={false} />
        </mesh>
        <pointLight color="#ffbf5e" intensity={14} distance={9} decay={2} />
        <sprite scale={[3.4, 3.4, 1]}>
          <spriteMaterial map={glow} color={[0.55, 0.36, 0.08]} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
        </sprite>
      </group>
      <instancedMesh ref={tethers} args={[tetherGeo, undefined, MAX_LEGS]} frustumCulled={false}>
        <meshBasicMaterial />
      </instancedMesh>
      <instancedMesh ref={strandSegs} args={[segGeo, undefined, STRAND_N * STRAND_SEG]} frustumCulled={false}>
        <meshStandardMaterial color="#a6ff3a" emissive="#4fb800" emissiveIntensity={1.1} roughness={0.18} transparent opacity={0.92} />
      </instancedMesh>
      <instancedMesh ref={strandBlobs} args={[undefined, undefined, STRAND_N * 2]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color="#a6ff3a" emissive="#4fb800" emissiveIntensity={1.1} roughness={0.18} transparent opacity={0.92} />
      </instancedMesh>

      <Effects hq={hq} />
    </>
  )
}

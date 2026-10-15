import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { KeyboardControls, type KeyboardControlsEntry } from '@react-three/drei'
import { Leva } from 'leva'
import World from './World'
import { type Density, MAX_LEGS, TRAP_LEGS, V_MAX } from './model'
import { CRASH_COST, GAME_T, LESSONS, type LessonKey, type Phase, SPEED_UNIT, actions, game, hud, isTouch, rankOf, touch } from './hud'
import { sfx } from './sfx'

export type Controls = 'forward' | 'backward' | 'left' | 'right'
const KEYS: KeyboardControlsEntry<Controls>[] = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'left', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'right', keys: ['ArrowRight', 'KeyD'] },
]

// 界面需要跟着变的那几个量（阶段、第几局、赛道）：每 0.1 秒看一眼，变了才重渲染
function useGame() {
  const snap = () => `${game.phase}|${game.run}|${hud.density}`
  const [, setKey] = useState(snap)
  useEffect(() => {
    const id = setInterval(() => setKey(snap()), 100)
    return () => clearInterval(id)
  }, [])
  return { phase: game.phase as Phase, run: game.run, density: hud.density as Density }
}

// ================================================================ LOGO
function Logo() {
  const petals = Array.from({ length: 8 }, (_, k) => k * 22.5)
  return (
    <svg className="logo" viewBox="0 0 430 122">
      <defs>
        <linearGradient id="lg-petal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7cf3ff" />
          <stop offset="1" stopColor="#8b5cff" />
        </linearGradient>
        <linearGradient id="lg-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd977" />
          <stop offset="0.5" stopColor="#ff8a5c" />
          <stop offset="1" stopColor="#8b5cff" />
        </linearGradient>
        <radialGradient id="lg-core" cx="0.35" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#fff6c8" />
          <stop offset="0.45" stopColor="#ffc84a" />
          <stop offset="1" stopColor="#a8600a" />
        </radialGradient>
        <linearGradient id="lg-track" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b9c4ff" />
        </linearGradient>
        <linearGradient id="lg-dnf" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#ff7a4f" />
        </linearGradient>
        <linearGradient id="lg-streak" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7cf3ff" stopOpacity="0" />
          <stop offset="1" stopColor="#7cf3ff" stopOpacity="0.9" />
        </linearGradient>
        <filter id="lg-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* 徽标：纳米花 + 金色 walker + 轨道环 */}
      <g transform="translate(52 52)" filter="url(#lg-glow)">
        <circle r="46" fill="rgba(10,12,40,0.55)" stroke="url(#lg-ring)" strokeWidth="3" strokeDasharray="52 10 18 10" />
        {petals.map((a) => (
          <ellipse key={a} rx="8.5" ry="25" cy="-15" fill="url(#lg-petal)" opacity={0.55} transform={`rotate(${a * 2})`} />
        ))}
        {petals.map((a) => (
          <ellipse key={`i${a}`} rx="5" ry="15" cy="-9" fill="#c7b3ff" opacity={0.35} transform={`rotate(${a * 2 + 22.5})`} />
        ))}
        <circle r="11" fill="url(#lg-core)" />
        <circle cx="32" cy="-32" r="5" fill="#ffd977" />
      </g>
      {/* 字标 */}
      <g transform="translate(112 66) skewX(-12)" filter="url(#lg-glow)">
        <text className="lg-text" x="0" y="0">
          <tspan fill="url(#lg-track)">TRACK</tspan>
          <tspan className="lg-sep" dx="4" fill="#ffd977">/</tspan>
          <tspan dx="4" fill="url(#lg-dnf)">DNF</tspan>
        </text>
      </g>
      <g transform="translate(118 78)">
        <rect x="0" y="0" width="300" height="3" fill="url(#lg-streak)" />
        <text className="lg-sub" x="2" y="22" textLength="296" lengthAdjust="spacing" transform="skewX(-12)">WALKING ON TUNABLE DNA NANOFLOWER TRACKS</text>
        <rect x="120" y="30" width="180" height="1.5" fill="url(#lg-streak)" opacity="0.5" />
      </g>
    </svg>
  )
}

// ================================================================ 小图标（同一套线条风格）
function HairpinIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M12 23 V12" />
      <path d="M8.5 12 V8 a3.5 3.5 0 0 1 7 0 V12" />
      <path d="M6 23 H18" />
    </svg>
  )
}
function WalkerIcon() {
  const spokes = Array.from({ length: 10 }, (_, k) => (k * 36 * Math.PI) / 180)
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5" />
      {spokes.map((a, k) => (
        <line key={k} x1={12 + Math.cos(a) * 6.5} y1={12 + Math.sin(a) * 6.5} x2={12 + Math.cos(a) * 10} y2={12 + Math.sin(a) * 10} />
      ))}
    </svg>
  )
}
function HelixIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M7 2 C7 8 17 8 17 12 C17 16 7 16 7 22" />
      <path d="M17 2 C17 8 7 8 7 12 C7 16 17 16 17 22" />
      <path d="M9 5 H15 M9 19 H15" />
    </svg>
  )
}
function RampIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M2 20 H14 L20 9" />
      <path d="M6 15 l3 -3 l3 3 M10 11 l3 -3 l3 3" />
    </svg>
  )
}
function CrystalIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M12 2 L18 10 L12 22 L6 10 Z" />
      <path d="M6 10 H18 M12 2 V22" />
    </svg>
  )
}
// 自陷：折叠的纳米花片层，一颗球卡在折缝里
function FoldIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M1.5 6 L7 19 L12 8 L17 19 L22.5 6" />
      <path d="M4.5 4 L7 10 M19.5 4 L17 10" />
      <circle cx="7" cy="14.3" r="2.5" />
    </svg>
  )
}
function GooIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <circle cx="12" cy="9" r="4.5" />
      <path d="M3 19 C6 16 18 16 21 19 C18 21 6 21 3 19 Z" />
      <path d="M9 13 L8 17 M12 13.5 V17 M15 13 L16 17" />
    </svg>
  )
}
// 打滑：球离开地面，身后两道滑痕
function SlipIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <circle cx="14" cy="10" r="5" />
      <path d="M2 20 H22 M3 12.5 H7 M2 16 H8" />
    </svg>
  )
}
// 被钉住：一颗球被一排腿钉在地上
function PinIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4.5" />
      <path d="M2.5 21 H21.5 M5 21 L9 12 M9 21 L10.5 12.8 M12 21 V12.5 M15 21 L13.5 12.8 M19 21 L15 12" />
    </svg>
  )
}
// 烧掉的桥：火苗
function FlameIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M12 22 C7.5 22 5 19 5 15.2 C5 11 8.5 9 9 4.5 C11.5 6.5 12.5 9 12 11 C13.5 10 14.5 8.5 14.8 6.5 C17.5 9 19 12 19 15.2 C19 19 16.5 22 12 22 Z" />
      <path d="M12 22 C10.2 22 9.2 20.6 9.2 19 C9.2 17 11 16 12 14 C13 16 14.8 17 14.8 19 C14.8 20.6 13.8 22 12 22 Z" />
    </svg>
  )
}
function BoltIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M13.5 2 L5 13.5 H11 L10 22 L19 10 H13 Z" />
    </svg>
  )
}
function WarnIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M12 2.5 L22.5 20.5 H1.5 Z" />
      <path d="M12 9 V14.5 M12 17.6 V17.8" />
    </svg>
  )
}
// 六边形底座（徽章、图标框共用，和仪表上的腿数徽章同一个形状）
function HexShape() {
  return (
    <svg className="hexo" viewBox="0 0 100 112">
      <polygon points="50,3 96,29 96,83 50,109 4,83 4,29" />
    </svg>
  )
}
function DotsIcon({ n }: { n: number }) {
  const step = 28 / n
  return (
    <svg className="dots" viewBox="0 0 28 28">
      {Array.from({ length: n * n }, (_, k) => (
        <circle key={k} cx={step / 2 + (k % n) * step} cy={step / 2 + Math.floor(k / n) * step} r={Math.min(2.6, step * 0.32)} />
      ))}
    </svg>
  )
}
function Arrow({ rot }: { rot: number }) {
  return (
    <svg className="arr" viewBox="0 0 12 12" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M6 2 L10.5 9 H1.5 Z" />
    </svg>
  )
}

// ================================================================ 仪表
const C = 160, R_ARC = 120, SWEEP = 270, START = 135, MAX_SPD = 480
const CIRC = 2 * Math.PI * R_ARC
const polar = (deg: number, r: number) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)]
const arcPath = (a0: number, a1: number, r: number) => {
  const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r)
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
}
const TICKS = Array.from({ length: 31 }, (_, k) => {
  const deg = START + (SWEEP * k) / 30
  const major = k % 5 === 0
  const [x1, y1] = polar(deg, R_ARC - 12)
  const [x2, y2] = polar(deg, R_ARC - 12 - (major ? 14 : 7))
  const [lx, ly] = polar(deg, R_ARC - 40)
  return { k, x1, y1, x2, y2, lx, ly, major, red: k >= 25 }
})
// 抓地灯：表盘顶部一圈 14 段
const LED_A0 = 207, LED_A1 = 333
const LEDS = Array.from({ length: MAX_LEGS }, (_, k) => {
  const step = (LED_A1 - LED_A0) / MAX_LEGS
  const a0 = LED_A0 + k * step + 1.2, a1 = LED_A0 + (k + 1) * step - 1.2
  return { k, d: arcPath(a0, a1, 145), zone: k < 1 ? 'z-slip' : k >= TRAP_LEGS - 1 ? 'z-trap' : 'z-roll' }
})
const MODE = { roll: 'GRIP', slip: 'SLIP', trap: 'TRAPPED', pin: 'PINNED', air: 'AIRBORNE', stuck: 'STUCK' }
const PIPS = 7 // 挣脱提示里的黏丝格

function Cluster() {
  const arc = useRef<SVGCircleElement>(null!)
  const needle = useRef<SVGGElement>(null!)
  const num = useRef<HTMLDivElement>(null!)
  const odo = useRef<HTMLDivElement>(null!)
  const legsNum = useRef<HTMLDivElement>(null!)
  const mode = useRef<HTMLDivElement>(null!)
  const leds = useRef<SVGGElement>(null!)
  const box = useRef<HTMLDivElement>(null!)
  const lines = useRef<HTMLDivElement>(null!)
  const pops = useRef<HTMLDivElement>(null!)
  const fuel = useRef<HTMLDivElement>(null!)
  const fuelBar = useRef<HTMLDivElement>(null!)
  const stuck = useRef<HTMLDivElement>(null!)
  const pips = useRef<HTMLDivElement>(null!)
  const [call, setCall] = useState<{ text: string; tone: string; id: number } | null>(null)
  const [bonus, setBonus] = useState<(typeof hud)['bonus'] | null>(null)

  useEffect(() => {
    let raf = 0, last = performance.now(), shown = 0, odoShown = -1, lastSignal = hud.signal, lastLegs = -1, lastFlash = hud.flash.id, lastMode = '', lastPips = -1, lastBonus = hud.bonus.id
    const ledEls = Array.from(leds.current.children) as SVGPathElement[]
    const pipEls = Array.from(pips.current.children) as HTMLSpanElement[]
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      // 显示的是实际速度：常态全速约 290，冲刺台和惯性保留时进红区
      const target = Math.min(MAX_SPD, hud.vel * V_MAX * SPEED_UNIT)
      shown += (target - shown) * (1 - Math.exp(-(target > shown ? 7 : 4) * dt))
      if (Math.abs(target - shown) < 0.05) shown = target
      const f = Math.min(1, shown / MAX_SPD)
      arc.current.setAttribute('stroke-dasharray', `${(CIRC * SWEEP * f) / 360} ${CIRC}`)
      needle.current.setAttribute('transform', `rotate(${START + SWEEP * f} ${C} ${C})`)
      num.current.textContent = String(Math.round(shown))
      const sl = Math.max(0, (f - 0.3) / 0.7)
      lines.current.style.opacity = String(sl * 0.85)
      lines.current.style.transform = `rotate(${(now * 0.37) % 360}deg) scale(${1.6 - sl * 0.1})`
      if (hud.legs !== lastLegs) {
        lastLegs = hud.legs
        ledEls.forEach((el, k) => el.classList.toggle('on', k < hud.legs))
        legsNum.current.textContent = String(hud.legs).padStart(2, '0')
      }
      // 重开一局时得分归零：直接跳，不往回滚
      if (hud.signal < lastSignal - CRASH_COST) odoShown = -1
      // 特殊得分（砸地 / 撞车）：里程旁弹一个大号的金色 / 红色数字，屏幕中间再大字强调；这一帧的普通 +n 不弹
      if (hud.bonus.id !== lastBonus) {
        lastBonus = hud.bonus.id
        const b = hud.bonus
        const p = document.createElement('span')
        p.className = b.kind
        p.textContent = b.kind === 'slam' ? `+${b.amount}` : `−${b.amount}`
        pops.current.appendChild(p)
        setTimeout(() => p.remove(), 1400)
        setBonus({ ...b })
        lastSignal = hud.signal
      }
      if (hud.signal > lastSignal && hud.moving) {
        const p = document.createElement('span')
        p.textContent = `+${hud.signal - lastSignal}`
        pops.current.appendChild(p)
        setTimeout(() => p.remove(), 700)
      }
      lastSignal = hud.signal
      if (odoShown !== hud.signal) {
        const d = hud.signal - odoShown
        odoShown = odoShown < 0 ? hud.signal : odoShown + Math.sign(d) * Math.min(Math.abs(d), Math.max(1, Math.ceil(Math.abs(d) * 0.3)))
        odo.current.textContent = String(odoShown).padStart(5, '0')
      }
      if (hud.regime !== lastMode) {
        lastMode = hud.regime
        box.current.dataset.regime = hud.regime
        mode.current.textContent = MODE[hud.regime]
      }
      // H2 燃料：剩余时间条
      fuel.current.classList.toggle('on', hud.fuelT > 0)
      fuelBar.current.style.transform = `scaleX(${Math.min(1, hud.fuelT / 8)})`
      // 被粘住：挣脱提示 + 还剩几根黏丝
      const n = hud.stick > 0 ? Math.max(0, Math.min(PIPS, Math.round((hud.stick - 0.16) / 0.12))) : 0
      stuck.current.classList.toggle('on', hud.stick > 0)
      if (n !== lastPips) {
        lastPips = n
        pipEls.forEach((el, k) => el.classList.toggle('on', k < n))
      }
      if (hud.flash.id !== lastFlash) {
        lastFlash = hud.flash.id
        setCall({ text: hud.flash.text, tone: hud.flash.tone, id: hud.flash.id })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      <div className="speedlines" ref={lines} />
      {call && (
        <div key={call.id} className={`callout ${call.tone}`} onAnimationEnd={() => setCall(null)}>
          {call.text}
        </div>
      )}
      {bonus && (
        <div key={bonus.id} className={`bonus ${bonus.kind}`} onAnimationEnd={(e) => { if (e.target === e.currentTarget) setBonus(null) }}>
          <div className="bonus-label">{bonus.kind === 'slam' ? 'SLAM' : 'CRASH'}</div>
          <div className="bonus-num">{bonus.kind === 'slam' ? `+${bonus.amount}` : `−${bonus.amount}`}</div>
          {bonus.kind === 'slam' && (
            <div className="bonus-meta">
              <span><Arrow rot={0} />{bonus.height.toFixed(1)}</span>
              <span><Arrow rot={90} />{Math.round(bonus.dist)}</span>
            </div>
          )}
        </div>
      )}
      <div className="breakfree" ref={stuck}>
        <div className="breakfree-label">HOLD {isTouch ? <b>GAS</b> : <kbd><Arrow rot={0} /></kbd>} TO BREAK FREE</div>
        <div className="pips" ref={pips}>
          {Array.from({ length: PIPS }, (_, k) => <span key={k} />)}
        </div>
      </div>
      <div className="cluster" ref={box} data-regime="roll">
        <div className="fuel-chip" ref={fuel}>
          <HelixIcon />
          <span className="fuel-text">H2 BOOST</span>
          <div className="fuel-track"><div className="fuel-bar" ref={fuelBar} /></div>
        </div>
        <div className="gauge">
          <svg viewBox="0 0 320 320">
            <defs>
              <radialGradient id="g-face" cx="50%" cy="42%" r="62%">
                <stop offset="0%" stopColor="#1c2458" />
                <stop offset="100%" stopColor="#04061a" />
              </radialGradient>
              <linearGradient id="g-bezel" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#c9d2ff" stopOpacity="0.55" />
                <stop offset="0.5" stopColor="#5f6bb8" stopOpacity="0.25" />
                <stop offset="1" stopColor="#c9d2ff" stopOpacity="0.5" />
              </linearGradient>
              <linearGradient id="g-sweep" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#36c6ff" />
                <stop offset="55%" stopColor="#5dff9e" />
                <stop offset="85%" stopColor="#ffe066" />
                <stop offset="100%" stopColor="#ff5a4e" />
              </linearGradient>
              <filter id="g-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <circle cx={C} cy={C} r={156} fill="url(#g-face)" opacity={0.93} />
            <circle cx={C} cy={C} r={156} fill="none" stroke="url(#g-bezel)" strokeWidth={3} />
            <circle className="ring" cx={C} cy={C} r={133} fill="none" strokeWidth={1.5} />
            <g ref={leds} filter="url(#g-glow)">
              {LEDS.map((l) => (
                <path key={l.k} d={l.d} className={`led ${l.zone}`} />
              ))}
            </g>
            <circle cx={C} cy={C} r={R_ARC} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={14}
              strokeDasharray={`${(CIRC * SWEEP) / 360} ${CIRC}`} transform={`rotate(${START} ${C} ${C})`} />
            <circle cx={C} cy={C} r={R_ARC} fill="none" stroke="rgba(255,80,70,0.32)" strokeWidth={14}
              strokeDasharray={`0 ${(CIRC * SWEEP * (25 / 30)) / 360} ${(CIRC * SWEEP * (5 / 30)) / 360} ${CIRC}`} transform={`rotate(${START} ${C} ${C})`} />
            <circle ref={arc} cx={C} cy={C} r={R_ARC} fill="none" stroke="url(#g-sweep)" strokeWidth={14} strokeLinecap="round"
              strokeDasharray={`0 ${CIRC}`} transform={`rotate(${START} ${C} ${C})`} filter="url(#g-glow)" />
            {TICKS.map((t) => (
              <g key={t.k}>
                <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.red ? '#ff6b5a' : '#c9d2ff'} strokeWidth={t.major ? 3 : 1.5} strokeOpacity={t.major ? 1 : 0.55} />
                {t.major && <text x={t.lx} y={t.ly} className="tick" textAnchor="middle" dominantBaseline="central" fill={t.red ? '#ff8a7c' : '#c9d2ff'}>{(t.k / 30) * MAX_SPD}</text>}
              </g>
            ))}
            <g ref={needle} transform={`rotate(${START} ${C} ${C})`} filter="url(#g-glow)">
              <polygon className="needle" points={`${C - 12},${C - 3.5} ${C + R_ARC - 6},${C} ${C - 12},${C + 3.5}`} />
            </g>
            <circle cx={C} cy={C} r={12} fill="#070a24" stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
          </svg>
          <div className="readout">
            <div className="speed" ref={num}>0</div>
            <div className="caption">SPEED</div>
          </div>
          <div className="mode" ref={mode}>GRIP</div>
          <div className="odo-wrap">
            <HairpinIcon />
            <div className="odo" ref={odo}>00000</div>
            <div className="pops" ref={pops} />
          </div>
        </div>
        <div className="legs">
          <svg className="hex" viewBox="0 0 100 112">
            <polygon points="50,3 96,29 96,83 50,109 4,83 4,29" />
          </svg>
          <WalkerIcon />
          <div className="legs-num" ref={legsNum}>00</div>
          <div className="caption">LEGS</div>
        </div>
      </div>
    </>
  )
}

// ================================================================ 计时（上方正中）+ 开局倒计时
const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t * 10) % 10)
  return { main: `${m}:${String(s).padStart(2, '0')}`, tenth: `.${d}` }
}
function Timer({ phase }: { phase: Phase }) {
  const main = useRef<HTMLSpanElement>(null!)
  const tenth = useRef<HTMLSpanElement>(null!)
  const bar = useRef<HTMLDivElement>(null!)
  const box = useRef<HTMLDivElement>(null!)
  const cd = useRef<HTMLDivElement>(null!)
  useEffect(() => {
    let raf = 0, lastCount = -1, lastSec = -1
    const loop = () => {
      const f = fmt(Math.max(0, game.t))
      main.current.textContent = f.main
      tenth.current.textContent = f.tenth
      bar.current.style.transform = `scaleX(${game.t / GAME_T})`
      const hurry = game.phase === 'play' && game.t <= 10
      box.current.classList.toggle('hurry', hurry)
      // 最后 10 秒每过一秒滴答一下
      const sec = Math.ceil(game.t)
      if (hurry && sec !== lastSec && game.t > 0) sfx.tick()
      lastSec = sec
      // 倒计时：3、2、1，然后 GO（音符盒：数字低音，GO 高八度）
      const c = game.phase === 'count' ? Math.ceil(game.count) : game.phase === 'play' && game.t > GAME_T - 0.8 ? 0 : -1
      if (c !== lastCount) {
        lastCount = c
        cd.current.textContent = c > 0 ? String(c) : c === 0 ? 'GO!' : ''
        cd.current.className = `countdown ${c > 0 ? 'num' : c === 0 ? 'go' : ''}`
        if (c >= 0) sfx.startBeep(c === 0)
        // 重新触发动画
        void cd.current.offsetWidth
        cd.current.classList.add('pulse')
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <>
      <div className={`timer ${phase === 'menu' ? 'off' : ''}`} ref={box}>
        <div className="timer-label">TIME</div>
        <div className="timer-num"><span ref={main}>2:00</span><span className="tenth" ref={tenth}>.0</span></div>
        <div className="timer-track"><div className="timer-bar" ref={bar} /></div>
      </div>
      <div className="countdown" ref={cd} />
    </>
  )
}

// ================================================================ walking 小知识卡（游戏里“解锁图鉴”式的卡片，一张一张来）
const LESSON_ICON: Record<LessonKey, React.ReactNode> = {
  signal: <HairpinIcon />,
  grip: <WalkerIcon />,
  slip: <SlipIcon />,
  trap: <FoldIcon />,
  pin: <PinIcon />,
  burnt: <FlameIcon />,
  stuck: <GooIcon />,
  fuel: <HelixIcon />,
}
const LESSON_TOTAL = Object.keys(LESSONS).length
const LESSON_MS = 6500
// 知识卡正文里用 *...* 标出的关键词，显示成强调色
function rich(text: string) {
  return text.split('*').map((s, k) => (k % 2 ? <b key={k}>{s}</b> : s))
}
const pad2 = (n: number) => String(n).padStart(2, '0')

function LessonToast() {
  const [card, setCard] = useState<{ key: LessonKey; id: number } | null>(null)
  useEffect(() => {
    let seen = game.lesson.id
    const queue: LessonKey[] = []
    let showing = false
    let timer = 0
    const next = () => {
      const key = queue.shift()
      if (!key) {
        showing = false
        setCard(null)
        return
      }
      showing = true
      setCard({ key, id: Math.random() })
      timer = window.setTimeout(next, LESSON_MS)
    }
    const id = setInterval(() => {
      if (game.lesson.id !== seen && game.lesson.key) {
        seen = game.lesson.id
        queue.push(game.lesson.key)
        if (!showing) next()
      }
      if (game.phase !== 'play' && showing) {
        queue.length = 0
        clearTimeout(timer)
        showing = false
        setCard(null)
      }
    }, 120)
    return () => {
      clearInterval(id)
      clearTimeout(timer)
    }
  }, [])
  if (!card) return null
  const L = LESSONS[card.key]
  const n = game.learned.indexOf(card.key) + 1
  return (
    <div key={card.id} className={`lesson ${L.tone}`}>
      <div className="ls-frame">
        <div className="ls-body">
          <div className="ls-badge"><HexShape />{LESSON_ICON[card.key]}</div>
          <div className="ls-top">
            <span className="ls-kicker"><i />NEW WALKING NOTE</span>
            <span className="ls-count">{pad2(n)}<em>/{pad2(LESSON_TOTAL)}</em></span>
          </div>
          <div className="ls-title">{L.title}</div>
          <div className="ls-rule" />
          <div className="ls-text">{rich(L.text)}</div>
          <div className="ls-timer" />
        </div>
      </div>
    </div>
  )
}

// ================================================================ 开始界面：三步引导（玩法 → 地形 → 选轨道）
const trackName = (d: Density) => `${d}-DNF`
// grip / pin 是 5 格的示意条，表达三档轨道的性格（抓不抓得住、会不会被腿钉住），不是测量值
const TRACKS: { d: Density; dots: number; sub: string; tag: string; grip: number; pin: number }[] = [
  { d: 'LT', dots: 3, sub: 'LOW DENSITY', tag: 'SPARSE · SLIPPERY', grip: 1, pin: 0 },
  { d: 'MT', dots: 4, sub: 'MID DENSITY', tag: 'BALANCED · FAST', grip: 4, pin: 1 },
  { d: 'HT', dots: 6, sub: 'HIGH DENSITY', tag: 'DENSE · CLINGY', grip: 5, pin: 4 },
]
const STEPS = ['THE RUSH', 'THE ROAD AHEAD', 'THE TRACK']
// 看过一次引导以后，再回到开始界面时直接到选轨道那一步
let introSeen = false

function SlamIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <path d="M12 2 V11 M8.5 7.5 L12 11 L15.5 7.5" />
      <path d="M4 17 a8 3.2 0 0 0 16 0 M1.5 19.5 a10.5 4 0 0 0 21 0" />
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <circle cx="12" cy="13" r="8.5" />
      <path d="M12 8.5 V13 L15 15 M9.5 2.5 H14.5" />
    </svg>
  )
}

// 烧掉的桥：身后打开过的发夹（青绿、没用了），身前没用过的发夹（珊瑚红、+1），walker 在中间往前冲
function BurntBridge() {
  const pin = (x: number, fresh: boolean, k: number) => (
    <g key={`${fresh}${k}`} className={fresh ? 'pin fresh' : 'pin spent'} transform={`translate(${x} 0)`}>
      <path d="M0 100 V74" />
      <path d="M-7 74 V66 a7 7 0 0 1 14 0 V74" />
    </g>
  )
  return (
    <svg className="burnt-svg" viewBox="0 0 640 132">
      <defs>
        <linearGradient id="bb-ground" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1fd6c0" stopOpacity="0.15" />
          <stop offset="0.48" stopColor="#1fd6c0" stopOpacity="0.55" />
          <stop offset="0.52" stopColor="#ff6b7a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff6b7a" stopOpacity="0.15" />
        </linearGradient>
        <radialGradient id="bb-ball" cx="0.35" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#fff6c8" />
          <stop offset="0.45" stopColor="#ffc84a" />
          <stop offset="1" stopColor="#a8600a" />
        </radialGradient>
      </defs>
      <rect x="10" y="100" width="620" height="3" fill="url(#bb-ground)" />
      {[40, 78, 116, 154, 192, 230].map((x, k) => pin(x, false, k))}
      {[388, 426, 464, 502, 540, 578, 616].map((x, k) => pin(x, true, k))}
      {/* 速度线 */}
      <g className="streaks">
        <path d="M228 66 H268 M214 80 H264 M236 94 H270" />
      </g>
      {/* walker：金球 + 一圈腿 */}
      <g transform="translate(310 74)">
        {Array.from({ length: 14 }, (_, k) => {
          const a = (k / 14) * Math.PI * 2
          return <line key={k} className="leg" x1={Math.cos(a) * 22} y1={Math.sin(a) * 22} x2={Math.cos(a) * 31} y2={Math.sin(a) * 31} />
        })}
        <circle r="21" fill="url(#bb-ball)" />
      </g>
      <text className="bb-label spent" x="135" y="124" textAnchor="middle">SPENT · NO GRIP · NO POINTS</text>
      <text className="bb-label fresh" x="502" y="124" textAnchor="middle">FRESH · +1 EACH</text>
      <g className="bb-arrow">
        <path d="M350 26 H440 M428 18 L440 26 L428 34" />
        <text x="345" y="31" textAnchor="end">RUSH</text>
      </g>
    </svg>
  )
}

const POWER = [
  { k: 'ramp', icon: <RampIcon />, name: 'RAMP', chip: 'LAUNCH', line: 'Hit it head-on — speed boost and big air.' },
  { k: 'slam', icon: <SlamIcon />, name: 'SLAM', chip: '+ BONUS', line: 'Higher, longer jumps blast open more hairpins on landing.' },
  { k: 'fuel', icon: <HelixIcon />, name: 'H2 FUEL', chip: 'SPEED UP', line: 'Grab the blue helix for a burst of speed.' },
]
const DANGER = [
  { k: 'trap', icon: <FoldIcon />, name: 'SELF-TRAP ZONE', chip: 'TRAP', line: 'Rugged folds of the nanoflower. You get stuck at any speed.' },
  { k: 'stuck', icon: <GooIcon />, name: 'ADSORPTION WELL', chip: 'STICK', line: `Glowing green pit that glues you down — hold ${isTouch ? 'GAS' : '▲'} to break free.` },
  { k: 'crystal', icon: <CrystalIcon />, name: 'CRYSTAL', chip: '−30', line: 'Crash into one and lose 30 hairpins.' },
]

// 一个模块：带标题栏的框（增益 / 危险）
function FxModule({ kind, items }: { kind: 'power' | 'danger'; items: typeof POWER }) {
  const power = kind === 'power'
  return (
    <section className={`fx-mod ${kind}`}>
      <div className="fx-mod-frame">
        <div className="fx-mod-in">
          <header className="mod-head">
            <span className="mod-badge"><HexShape />{power ? <BoltIcon /> : <WarnIcon />}</span>
            <span className="mod-name">{power ? 'POWER' : 'DANGER'}</span>
            <span className="mod-cue">{power ? 'GRAB THESE' : 'STEER CLEAR'}</span>
          </header>
          <div className="mod-list">{items.map((f) => <FxCard key={f.k} f={f} />)}</div>
        </div>
      </div>
    </section>
  )
}

function FxCard({ f }: { f: (typeof POWER)[number] }) {
  return (
    <div className={`fx-card ${f.k}`}>
      <div className="fx-glyph"><HexShape />{f.icon}</div>
      <div className="fx-body">
        <div className="fx-head">
          <span className="fx-name">{f.name}</span>
          <span className="fx-chip">{f.chip}</span>
        </div>
        <div className="fx-line">{f.line}</div>
      </div>
    </div>
  )
}

function Pips({ n, tone }: { n: number; tone: string }) {
  return (
    <span className={`pips5 ${tone}`}>
      {Array.from({ length: 5 }, (_, k) => <i key={k} className={k < n ? 'on' : ''} />)}
    </span>
  )
}

// 结算界面里用的紧凑版选轨道
function TrackPicker({ density }: { density: Density }) {
  return (
    <div className="tracks">
      {TRACKS.map((t, i) => (
        <button key={t.d} className={`track ${density === t.d ? 'active' : ''}`} onClick={() => { sfx.click(); actions.setDensity(t.d) }}>
          <span className="key">{i + 1}</span>
          <DotsIcon n={t.dots} />
          <span className="track-code">{trackName(t.d)}</span>
          <span className="track-tag">{t.tag}</span>
          <span className="track-best">BEST <b>{game.best[t.d]}</b></span>
        </button>
      ))}
    </div>
  )
}

function Menu({ density }: { density: Density }) {
  const [step, setStep] = useState(introSeen ? 2 : 0)
  const go = (s: number) => {
    sfx.click()
    setStep(Math.max(0, Math.min(2, s)))
  }
  const start = () => {
    sfx.click()
    introSeen = true
    actions.start()
  }
  // 键盘：Enter / 空格 / → 下一步（最后一步开局），← / Backspace 上一步
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowRight') {
        e.preventDefault()
        if (step < 2) go(step + 1)
        else start()
      }
      if (e.code === 'ArrowLeft' || e.code === 'Backspace') go(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="overlay menu">
      <div className="wizard">
        <div className="steps">
          {STEPS.map((s, i) => (
            <button key={s} className={`step ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => go(i)}>
              <span className="step-n">0{i + 1}</span>
              <span className="step-t">{s}</span>
              <i />
            </button>
          ))}
        </div>

        <div className="pane" key={step}>
          {step === 0 && (
            <>
              <div className="title">HAIRPIN <span>RUSH</span></div>
              <div className="subtitle">OPEN AS MANY HAIRPINS AS YOU CAN IN <b>2:00</b></div>
              <div className="burnt">
                <BurntBridge />
                <div className="burnt-text">
                  <div className="burnt-title">BURNT BRIDGE · <span>THE CORE OF THE RUSH</span></div>
                  <div className="burnt-line">Every hairpin opens only once. The track behind you is spent — keep rushing onto fresh ground.</div>
                </div>
              </div>
              <div className="goal-chips">
                <span><HairpinIcon />+1 PER OPENED HAIRPIN</span>
                <span><ClockIcon />2:00 ON THE CLOCK</span>
                {isTouch ? (
                  <span><kbd><Arrow rot={-90} /></kbd><kbd><Arrow rot={90} /></kbd>STEER · <b className="chip-gas">GAS</b> / <b className="chip-brake">BRAKE</b></span>
                ) : (
                  <span><kbd><Arrow rot={0} /></kbd><kbd><Arrow rot={180} /></kbd>DRIVE<kbd><Arrow rot={-90} /></kbd><kbd><Arrow rot={90} /></kbd>STEER</span>
                )}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="pane-title">WHAT YOU'LL <span>FACE</span></div>
              <div className="subtitle">NO SIGNS OUT THERE — LEARN THE SHAPES</div>
              <div className="fx-mods">
                <FxModule kind="power" items={POWER} />
                <FxModule kind="danger" items={DANGER} />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="pane-title">CHOOSE YOUR <span>TRACK</span></div>
              <div className="subtitle">TUNABLE DNA NANOFLOWER TRACKS — HAIRPIN SPACING CHANGES HOW THE WALKER RUNS</div>
              <div className="tcards">
                {TRACKS.map((t, i) => (
                  <button key={t.d} className={`tcard ${density === t.d ? 'active' : ''}`} onClick={() => { sfx.click(); actions.setDensity(t.d) }}>
                    <span className="key">{i + 1}</span>
                    <DotsIcon n={t.dots} />
                    <span className="tcard-title">{t.d}<em>-DNF</em></span>
                    <span className="tcard-sub">{t.sub}</span>
                    <span className="tcard-tag">{t.tag}</span>
                    <span className="tcard-meter"><b>GRIP</b><Pips n={t.grip} tone="grip" /></span>
                    <span className="tcard-meter"><b>PIN</b><Pips n={t.pin} tone="pin" /></span>
                    <span className="tcard-best">BEST <b>{game.best[t.d]}</b></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="wiz-foot">
          {step > 0 ? (
            <button className="ghost-btn" onClick={() => go(step - 1)}><Arrow rot={-90} />BACK</button>
          ) : (
            <button className="ghost-btn" onClick={() => go(2)}>SKIP</button>
          )}
          {step < 2 ? (
            <button className="go-btn" onClick={() => go(step + 1)}>NEXT <kbd>ENTER</kbd></button>
          ) : (
            <button className="go-btn" onClick={start}>START {trackName(density)} <kbd>ENTER</kbd></button>
          )}
        </div>
      </div>
    </div>
  )
}

// ================================================================ 结算界面
function CountUp({ to }: { to: number }) {
  const el = useRef<HTMLDivElement>(null!)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const loop = (now: number) => {
      const k = Math.min(1, (now - t0) / 1400)
      el.current.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <div className="score" ref={el}>0</div>
}

function Results({ density }: { density: Density }) {
  const s = game.stats
  const rank = rankOf(game.score, density)
  // 破纪录：等得分滚完再放升级音效
  useEffect(() => {
    if (!game.newBest) return
    const id = setTimeout(() => sfx.fanfare(), 1300)
    return () => clearTimeout(id)
  }, [])
  const stats = [
    { label: 'TOP SPEED', value: Math.round(s.topSpeed).toString() },
    { label: 'LONGEST AIR', value: `${s.airMax.toFixed(1)}s` },
    { label: 'BEST SLAM', value: `+${s.bestSlam}`, tone: 'gold' },
    { label: `CRASHES · −${CRASH_COST}`, value: String(s.crashes), tone: 'red' },
    { label: 'RAMPS', value: String(s.ramps) },
    { label: 'H2 FUEL', value: String(s.fuel) },
    { label: 'TRAPPED', value: `${s.trapT.toFixed(1)}s` },
    { label: 'STUCK', value: `${s.stuckT.toFixed(1)}s` },
  ]
  return (
    <div className="overlay results">
      <div className="result-card">
        <div className="result-head">
          <div>
            <div className="timeup">TIME UP · {trackName(density)}</div>
            <CountUp to={game.score} />
            <div className="score-cap"><HairpinIcon /> HAIRPINS OPENED</div>
          </div>
          <div className={`rank r-${rank}`}>
            <svg viewBox="0 0 100 112"><polygon points="50,3 96,29 96,83 50,109 4,83 4,29" /></svg>
            <span>{rank}</span>
          </div>
        </div>
        <div className="best-row">
          {game.newBest ? <span className="new-best">NEW BEST</span> : <span>BEST <b>{game.best[density]}</b></span>}
        </div>
        <div className="stat-grid">
          {stats.map((x) => (
            <div key={x.label} className={`stat ${x.tone ?? ''}`}>
              <div className="stat-value">{x.value}</div>
              <div className="stat-label">{x.label}</div>
            </div>
          ))}
        </div>
        {game.learned.length > 0 && (
          <div className="notes">
            <div className="notes-head">WALKING NOTES <b>{pad2(game.learned.length)}</b><em>/{pad2(LESSON_TOTAL)}</em></div>
            {game.learned.map((k) => (
              <div key={k} className={`note ${LESSONS[k].tone}`}>
                <div className="note-in">
                  <div className="note-badge"><HexShape />{LESSON_ICON[k]}</div>
                  <div className="note-title">{LESSONS[k].title}</div>
                  <div className="note-text">{rich(LESSONS[k].text)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <TrackPicker density={density} />
        <div className="result-btns">
          <button className="go-btn" onClick={() => { sfx.click(); actions.start() }}>RETRY <kbd>ENTER</kbd></button>
          <button className="ghost-btn" onClick={() => { sfx.click(); actions.menu() }}>MENU <kbd>ESC</kbd></button>
        </div>
      </div>
    </div>
  )
}

// ================================================================ 触屏操作（手机 / 平板）
// 左下角左右转向，右下角刹车 + 油门；按住生效，多指可以同时按（例如一边转向一边踩油门）
type TouchKey = keyof typeof touch
function HoldButton({ k, className, children }: { k: TouchKey; className: string; children: React.ReactNode }) {
  const [down, setDown] = useState(false)
  const set = (v: boolean) => {
    touch[k] = v
    setDown(v)
  }
  useEffect(() => () => {
    touch[k] = false
  }, [k])
  return (
    <button
      className={`${className} ${down ? 'down' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault()
        set(true)
        sfx.unlock()
        // 手指滑出按钮也算按着，直到抬起
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // 指针已经不在（极少见）：不捕获也能用
        }
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

function TouchControls({ phase }: { phase: Phase }) {
  if (!isTouch || (phase !== 'play' && phase !== 'count')) return null
  return (
    <div className="touchpad">
      <div className="tp-steer">
        <HoldButton k="left" className="tp-btn"><Arrow rot={-90} /></HoldButton>
        <HoldButton k="right" className="tp-btn"><Arrow rot={90} /></HoldButton>
      </div>
      <div className="tp-pedals">
        <HoldButton k="backward" className="tp-pedal brake"><span>BRAKE</span></HoldButton>
        <HoldButton k="forward" className="tp-pedal gas"><span>GAS</span></HoldButton>
      </div>
    </div>
  )
}

// ================================================================ 全屏
// 电脑和安卓直接全屏（手机上顺便锁成横屏）；iPhone 的 Safari 不允许网页自己全屏，提示“添加到主屏幕”
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void }
const fsElement = () => document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null

function useFullscreen() {
  const [on, setOn] = useState(!!fsElement())
  const [hint, setHint] = useState(0)
  useEffect(() => {
    const sync = () => setOn(!!fsElement())
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])
  const toggle = () => {
    const el = document.documentElement as FsEl
    if (fsElement()) {
      if (document.exitFullscreen) void document.exitFullscreen()
      else (document as FsDoc).webkitExitFullscreen?.()
      return
    }
    if (el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => undefined)
    } else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
    else setHint((h) => h + 1)
  }
  return { on, toggle, hint }
}

function FsIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24">
      {on ? (
        <path d="M9 3 V9 H3 M15 3 V9 H21 M9 21 V15 H3 M15 21 V15 H21" />
      ) : (
        <path d="M3 9 V3 H9 M21 9 V3 H15 M3 15 V21 H9 M21 15 V21 H15" />
      )}
    </svg>
  )
}

// ================================================================ 左下按键提示 + 右上角的按钮（全屏 / 声音 / 设置；手机上比赛中多一个回菜单）
function Keys({ phase, onSettings, muted, onMute, fs }: { phase: Phase; onSettings: () => void; muted: boolean; onMute: () => void; fs: ReturnType<typeof useFullscreen> }) {
  const playing = phase === 'play' || phase === 'count'
  return (
    <>
      <div className="keys">
        {playing ? (
          <>
            <span><kbd><Arrow rot={0} /></kbd><kbd><Arrow rot={180} /></kbd>DRIVE</span>
            <span><kbd><Arrow rot={-90} /></kbd><kbd><Arrow rot={90} /></kbd>STEER</span>
            <span><kbd>R</kbd>RESTART</span>
            <span><kbd>ESC</kbd>MENU</span>
            <span><kbd>M</kbd>SOUND</span>
            <span><kbd>F</kbd>FULL SCREEN</span>
          </>
        ) : phase === 'menu' ? (
          <>
            <span><kbd>ENTER</kbd>NEXT</span>
            <span><kbd><Arrow rot={-90} /></kbd>BACK</span>
            <span><kbd>1-3</kbd>TRACK</span>
            <span><kbd>M</kbd>SOUND</span>
            <span><kbd>F</kbd>FULL SCREEN</span>
          </>
        ) : (
          <>
            <span><kbd>ENTER</kbd>RETRY</span>
            <span><kbd>1-3</kbd>TRACK</span>
            <span><kbd>ESC</kbd>MENU</span>
            <span><kbd>M</kbd>SOUND</span>
          </>
        )}
      </div>
      <div className={`utils ${playing ? 'playing' : 'idle'}`}>
        {isTouch && playing && (
          <button className="ubtn" onClick={() => { sfx.click(); actions.menu() }} aria-label="menu">
            <svg viewBox="0 0 24 24"><path d="M4 6 H20 M4 12 H20 M4 18 H20" /></svg>
          </button>
        )}
        <button className={`ubtn fs ${fs.on ? 'on' : ''}`} onClick={() => { sfx.click(); fs.toggle() }} aria-label="full screen">
          <FsIcon on={fs.on} />
        </button>
        <button className={`ubtn snd ${muted ? 'off' : ''}`} onClick={onMute} aria-label="sound">
          <svg viewBox="0 0 24 24">
            <path className="spk" d="M4 9 H8 L13 5 V19 L8 15 H4 Z" />
            {muted ? <path className="x" d="M16 9 L21 14 M21 9 L16 14" /> : <path className="wave" d="M16 8.5 a5 5 0 0 1 0 7 M18.5 6 a8.5 8.5 0 0 1 0 12" />}
          </svg>
        </button>
        <button className="ubtn cog" onClick={onSettings} aria-label="settings">
          <svg viewBox="0 0 24 24">
            <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9 4.6v-2.2l-2.4-.6a7 7 0 0 0-.8-1.9l1.3-2.1-1.6-1.6-2.1 1.3a7 7 0 0 0-1.9-.8L13.1 2.8h-2.2l-.6 2.4a7 7 0 0 0-1.9.8L6.3 4.7 4.7 6.3 6 8.4a7 7 0 0 0-.8 1.9l-2.4.6v2.2l2.4.6c.2.7.4 1.3.8 1.9l-1.3 2.1 1.6 1.6 2.1-1.3c.6.4 1.2.6 1.9.8l.6 2.4h2.2l.6-2.4c.7-.2 1.3-.4 1.9-.8l2.1 1.3 1.6-1.6-1.3-2.1c.4-.6.6-1.2.8-1.9Z" />
          </svg>
        </button>
      </div>
      {fs.hint > 0 && (
        <div key={fs.hint} className="fs-hint">
          IPHONE: TAP <b>SHARE</b> → <b>ADD TO HOME SCREEN</b>, THEN OPEN IT FROM THE HOME SCREEN FOR FULL SCREEN
        </div>
      )}
    </>
  )
}

// 手机竖着拿时：提示横过来
function RotateHint() {
  return (
    <div className="rotate">
      <svg viewBox="0 0 64 64">
        <rect className="phone" x="22" y="8" width="20" height="36" rx="3" />
        <path className="turn" d="M48 40 a18 18 0 0 1 -14 16 M30 52 L34 56 L30 60" />
      </svg>
      <div>ROTATE TO <b>LANDSCAPE</b></div>
      <small>Screen won't turn? Switch off portrait orientation lock in Control Center.</small>
    </div>
  )
}

export default function App() {
  const [settings, setSettings] = useState(false)
  const [muted, setMuted] = useState(sfx.muted)
  const { phase, run, density } = useGame()
  const fs = useFullscreen()
  // 声音：第一次按键 / 点击时启用（浏览器的要求）；M 键开关声音，F 键开关全屏
  useEffect(() => {
    const unlock = () => sfx.unlock()
    const onKey = (e: KeyboardEvent) => {
      sfx.unlock()
      if (e.repeat) return
      if (e.code === 'KeyM') {
        sfx.setMuted(!sfx.muted)
        setMuted(sfx.muted)
      }
      if (e.code === 'KeyF') fs.toggle()
    }
    // 手机上手指按下不算“用户操作”，抬起才算，所以 pointerup / touchend 也要接
    const gestures = ['pointerdown', 'pointerup', 'touchend'] as const
    gestures.forEach((g) => window.addEventListener(g, unlock))
    window.addEventListener('keydown', onKey)
    return () => {
      gestures.forEach((g) => window.removeEventListener(g, unlock))
      window.removeEventListener('keydown', onKey)
    }
  })
  const toggleMute = () => {
    sfx.unlock()
    sfx.setMuted(!sfx.muted)
    setMuted(sfx.muted)
    sfx.click()
  }
  return (
    <KeyboardControls map={KEYS}>
      <Canvas shadows dpr={isTouch ? 1 : [1, 2]} gl={{ antialias: false, powerPreference: 'high-performance' }} camera={{ position: [0, 3, -6.4], fov: 50, near: 0.1, far: 1200 }}>
        <World />
      </Canvas>
      <Logo />
      <Cluster />
      <Timer phase={phase} />
      <LessonToast />
      <TouchControls phase={phase} />
      {phase === 'menu' && <Menu density={density} />}
      {phase === 'over' && <Results key={run} density={density} />}
      <Keys phase={phase} onSettings={() => setSettings((v) => !v)} muted={muted} onMute={toggleMute} fs={fs} />
      {isTouch && <RotateHint />}
      <Leva hidden={!settings} titleBar={{ title: 'SETTINGS', filter: false }}
        theme={{
          colors: { elevation1: 'rgba(14,18,44,0.9)', elevation2: 'rgba(20,26,60,0.82)', elevation3: 'rgba(40,50,100,0.9)', accent1: '#7c8cff', accent2: '#9aa8ff', accent3: '#c0c9ff', highlight1: '#8b96c9', highlight2: '#c9d2f5', highlight3: '#ffffff' },
          fonts: { mono: "'Bahnschrift', 'Saira Variable', sans-serif", sans: "'Bahnschrift', 'Saira Variable', sans-serif" },
          fontSizes: { root: '14px' },
          sizes: { rootWidth: '300px' },
        }} />
    </KeyboardControls>
  )
}

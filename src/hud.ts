// 3D 场景每帧写这里，界面自己按帧读（不在每帧里改 React 状态）
import type { Density, Regime } from './model'
export type { Regime }

export const hud = {
  density: 'MT' as Density,
  legs: 0, // 正在结合的腿数
  vel: 0, // 实际速度（相对最快速度）
  signal: 0, // 得分：已被打开的发夹数减去撞车扣分（仪表上的“里程”）
  moving: false,
  regime: 'roll' as Regime,
  stick: 0, // 被吸附井粘住的程度（界面上的黏丝格）
  fuelT: 0, // H2 燃料还剩多久
  carry: 0, // 冲刺台落地后的惯性保留还剩多久
  // 一次性的事件播报（场景写入，界面读到后显示）：id 变了就是新事件
  flash: { id: 0, text: '', tone: 'roll' as string },
  // 特殊得分（砸地加分 / 撞车扣分）：界面上单独用大号数字强调
  bonus: { id: 0, kind: 'slam' as 'slam' | 'crash', amount: 0, height: 0, dist: 0 },
}

// 触屏设备（手机 / 平板）：用屏幕上的按钮开车，默认流畅画质。网址后面加 ?touch 可以在电脑上强制用手机版面（调试用）
export const isTouch = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || new URLSearchParams(location.search).has('touch'))
// 屏幕按钮的按下状态（和键盘方向键一起作用）
export const touch = { forward: false, backward: false, left: false, right: false }

export function announce(text: string, tone: string) {
  hud.flash = { id: hud.flash.id + 1, text, tone }
}

export function award(kind: 'slam' | 'crash', amount: number, height = 0, dist = 0) {
  hud.bonus = { id: hud.bonus.id + 1, kind, amount, height, dist }
}

// 撞一次晶体柱扣多少分
export const CRASH_COST = 30

// 仪表上显示的速度 = 实际速度（单位/秒）× SPEED_UNIT：常态全速约 290，冲刺台和惯性保留时进红区
export const SPEED_UNIT = 24

// ---------------------------------------------------------------- 两分钟挑战
export const GAME_T = 120
export type Phase = 'menu' | 'count' | 'play' | 'over'

// 玩的过程中第一次遇到某种情况时弹出的 walking 小知识（每局每条最多一次）。正文里 *...* 是强调的关键词
export const LESSONS = {
  signal: { title: 'SIGNAL', tone: 'roll', text: 'A leg binds and opens hairpin *H1*; fuel strand *H2* then displaces the leg. Each opened H1 is *one unit of signal*.' },
  grip: { title: 'MULTIVALENT GRIP', tone: 'roll', text: 'Several legs bound at once *hold the particle on the track* while single legs are exchanged. A *medium number* rolls fastest.' },
  slip: { title: 'TOO FEW LEGS', tone: 'slip', text: 'When hairpins sit far apart, *too few legs* reach the track — the walker *slips and stalls*.' },
  trap: { title: 'SELF-TRAP', tone: 'trap', text: 'The nanoflower surface is folded. In tight, *product-crowded folds* the particle gets *physically stuck* — one candidate reason turnover fades.' },
  pin: { title: 'PINNED', tone: 'trap', text: '*Too many legs* bound at once pin the walker in place — a dense track can hold it *too tightly to roll*.' },
  burnt: { title: 'BURNT BRIDGE', tone: 'slip', text: 'An opened hairpin *cannot be used again*. Old track gives no grip — keep heading for *fresh hairpins*.' },
  stuck: { title: 'NON-SPECIFIC ADSORPTION', tone: 'stuck', text: 'The particle *sticks to the surface* instead of walking. *No hairpins open* until it breaks free.' },
  fuel: { title: 'H2 FUEL', tone: 'fuel', text: 'More fuel strands *displace bound legs faster* — the walker moves faster and hairpins open quicker.' },
} as const
export type LessonKey = keyof typeof LESSONS

export type Stats = {
  topSpeed: number; airMax: number; ramps: number; trapT: number; stuckT: number; fuel: number
  slams: number; bestSlam: number; crashes: number
}
export const newStats = (): Stats => ({ topSpeed: 0, airMax: 0, ramps: 0, trapT: 0, stuckT: 0, fuel: 0, slams: 0, bestSlam: 0, crashes: 0 })

// 每条赛道的参考成绩（离线模拟里“会找新路”的玩家两分钟的得分 = 点亮 − 撞车扣分，见 sim.ts）：评级按它的倍数算
export const PAR: Record<Density, number> = { LT: 530, MT: 1570, HT: 1390 }
export function rankOf(score: number, d: Density) {
  const k = score / PAR[d]
  return k >= 1.3 ? 'S' : k >= 1 ? 'A' : k >= 0.7 ? 'B' : k >= 0.4 ? 'C' : 'D'
}

function loadBest(): Record<Density, number> {
  try {
    const raw = localStorage.getItem('dnf-walker-best')
    if (raw) return { LT: 0, MT: 0, HT: 0, ...JSON.parse(raw) }
  } catch {
    // 浏览器不让用本地存储时，最佳成绩只在这次打开期间有效
  }
  return { LT: 0, MT: 0, HT: 0 }
}
export function saveBest() {
  try {
    localStorage.setItem('dnf-walker-best', JSON.stringify(game.best))
  } catch {
    // 同上
  }
}

export const game = {
  phase: 'menu' as Phase,
  t: GAME_T, // 剩余时间（秒）
  count: 0, // 开局倒计时（秒）
  score: 0,
  stats: newStats(),
  learned: [] as LessonKey[], // 本局学到的（按出现顺序）
  lesson: { id: 0, key: null as LessonKey | null }, // 最新一张知识卡（id 变了就弹出来）
  best: loadBest(),
  newBest: false,
  run: 0, // 第几局（界面用来重置动画）
}

export function teach(key: LessonKey) {
  if (game.learned.includes(key)) return
  game.learned.push(key)
  game.lesson = { id: game.lesson.id + 1, key }
}

// 界面上的按钮要调用 3D 场景里的操作，由场景挂载时注册
export const actions = {
  setDensity: ((d: Density) => void d) as (d: Density) => void,
  start: (() => undefined) as () => void, // 开一局（倒计时 → 开始）
  menu: (() => undefined) as () => void, // 回到开始界面
}

// 方便在浏览器控制台里查看当前数值（调试用）
;(globalThis as unknown as { __hud: typeof hud; __game: typeof game }).__hud = hud
;(globalThis as unknown as { __game: typeof game }).__game = game

// 音效组：全部用 Web Audio 现场合成，不加载音频文件。风格是赛车游戏：
// 一直在响的引擎（转速跟车速走、分档、升档泄压）+ 风噪 + 打滑时的轮胎尖叫 + 加速时的涡轮哨音，
// 再加涡轮增压、氮气喷射、悬挂砸底、撞车、街机式加分、起跑提示音、终点喇叭、胜利号角这些一次性的声音。
// 浏览器要求用户先有一次操作才能出声，所以第一次按键 / 点击时调用 unlock()。

const MUTE_KEY = 'dnf-walker-muted'
const VOLUME = 0.6
// 档位：按速度（相对常态最快速度）分 5 档
const GEARS = [0, 0.3, 0.6, 0.95, 1.3, 2.2]

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

// 每帧喂给引擎的状态
export type DriveState = {
  on: boolean // 比赛进行中（其余时候引擎声淡出）
  vel: number // 速度（相对常态最快速度）
  throttle: number // 油门：1 前进 / -1 倒车 / 0 松开
  air: boolean
  slip: boolean
  stuck: boolean
  boost: boolean // 冲刺台加速 / 惯性保留 / H2 加速
  dt: number
}

type Engine = {
  osc: OscillatorNode[] // 锯齿波 ×2（略微失谐）+ 半频方波
  lp: BiquadFilterNode
  gain: GainNode
  windF: BiquadFilterNode
  windG: GainNode
  skidF: BiquadFilterNode
  skidG: GainNode
  whine: OscillatorNode
  whineG: GainNode
}

class Sfx {
  muted = loadMuted()
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private eng: Engine | null = null
  private last: Record<string, number> = {}
  private streak = 0
  private rpm = 0.1
  private gear = 0
  private lastDrive = 0 // 上一次 drive() 的时间（performance.now）

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      this.ctx = ctx
      this.out = ctx.createGain()
      this.out.gain.value = this.muted ? 0 : VOLUME
      // 压缩：引擎、风噪和一次性的声音叠在一起时不爆音
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16
      comp.ratio.value = 5
      this.out.connect(comp).connect(ctx.destination)
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      // 页面切到后台时暂停（否则引擎声会一直挂着）
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) void ctx.suspend()
        else void ctx.resume()
      })
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.out) this.out.gain.value = m ? 0 : VOLUME
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    } catch {
      // 存不了就只在这次打开期间有效
    }
  }

  private running() {
    return !!this.ctx && this.ctx.state === 'running'
  }

  // 同一种声音两次之间至少隔 gap 秒（避免一帧里叠几十个）
  private ok(name: string, gap = 0) {
    if (!this.running() || this.muted) return false
    const now = this.ctx!.currentTime
    if (now - (this.last[name] ?? -1) < gap) return false
    this.last[name] = now
    return true
  }

  // 一个音：频率从 f0 滑到 f1，快起、指数衰减；lp 给了就过一道低通（让锯齿 / 方波不那么刺）
  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, at = 0, lp = 0) {
    const c = this.ctx!, t = c.currentTime + at
    const o = c.createOscillator(), g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    let node: AudioNode = o
    if (lp) {
      const f = c.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = lp
      node = o.connect(f)
    }
    node.connect(g).connect(this.out!)
    o.start(t)
    o.stop(t + dur + 0.03)
  }

  // 一段滤波噪声：滤波频率从 f0 扫到 f1
  private noise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1, at = 0) {
    const c = this.ctx!, t = c.currentTime + at
    const src = c.createBufferSource()
    src.buffer = this.noiseBuf
    const f = c.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(f0, t)
    f.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.out!)
    src.start(t, Math.random())
    src.stop(t + dur + 0.03)
  }

  // ---- 持续的声音：引擎、风噪、轮胎尖叫、涡轮哨音
  private buildEngine() {
    const c = this.ctx!
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 2
    const shaper = c.createWaveShaper()
    const curve = new Float32Array(256)
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1
      curve[i] = Math.tanh(1.4 * x)
    }
    shaper.curve = curve
    const gain = c.createGain()
    gain.gain.value = 0
    const mix = c.createGain()
    mix.gain.value = 0.35
    const osc: OscillatorNode[] = []
    for (const [type, detune] of [['sawtooth', 0], ['sawtooth', 9], ['square', 0]] as const) {
      const o = c.createOscillator()
      o.type = type
      o.detune.value = detune
      o.connect(mix)
      o.start()
      osc.push(o)
    }
    mix.connect(shaper).connect(lp).connect(gain).connect(this.out!)
    const loop = (type: BiquadFilterType, f: number, q: number) => {
      const src = c.createBufferSource()
      src.buffer = this.noiseBuf
      src.loop = true
      const filt = c.createBiquadFilter()
      filt.type = type
      filt.frequency.value = f
      filt.Q.value = q
      const g = c.createGain()
      g.gain.value = 0
      src.connect(filt).connect(g).connect(this.out!)
      src.start()
      return { filt, g }
    }
    const wind = loop('bandpass', 600, 0.6)
    const skid = loop('bandpass', 2600, 7)
    const whine = c.createOscillator()
    whine.type = 'sine'
    const whineG = c.createGain()
    whineG.gain.value = 0
    whine.connect(whineG).connect(this.out!)
    whine.start()
    this.eng = { osc, lp, gain, windF: wind.filt, windG: wind.g, skidF: skid.filt, skidG: skid.g, whine, whineG }
    // 兜底：画面停了（页面被隐藏、标签页切走、窗口最小化……）drive() 就不再被调用，
    // 这时把持续的声音全部淡出，免得引擎声按最后的状态一直响
    setInterval(() => {
      const e = this.eng
      if (!e || !this.ctx || performance.now() - this.lastDrive < 300) return
      const t = this.ctx.currentTime
      for (const g of [e.gain, e.windG, e.skidG, e.whineG]) g.gain.setTargetAtTime(0, t, 0.05)
    }, 200)
  }

  // 每帧调用：按车速算档位和转速，更新引擎、风噪、轮胎尖叫、涡轮哨音
  drive(s: DriveState) {
    if (!this.running()) return
    this.lastDrive = performance.now()
    if (!this.eng) this.buildEngine()
    const e = this.eng!
    const v = Math.max(0, s.vel)
    let g = this.gear
    while (g < GEARS.length - 2 && v > GEARS[g + 1]) g++
    while (g > 0 && v < GEARS[g] - 0.06) g--
    if (g > this.gear && s.on && s.throttle > 0) this.blowoff()
    this.gear = g
    const lo = GEARS[g], hi = GEARS[g + 1]
    // 每档里转速从 0.3 升到 1；空中踩油门空转拉高；被粘住踩油门转速拉满（但走不动）；松油门回落
    let target = 0.3 + 0.7 * Math.min(1, (v - lo) / (hi - lo))
    if (s.air && s.throttle > 0) target = Math.min(1, target + 0.35)
    if (s.stuck && s.throttle > 0) target = 0.95
    if (s.throttle === 0) target = Math.min(target, 0.2 + v * 0.35)
    this.rpm += (target - this.rpm) * (1 - Math.exp(-(target > this.rpm ? 9 : 4) * s.dt))
    const t = this.ctx!.currentTime
    const f = 46 + 160 * this.rpm
    e.osc[0].frequency.setTargetAtTime(f, t, 0.025)
    e.osc[1].frequency.setTargetAtTime(f, t, 0.025)
    e.osc[2].frequency.setTargetAtTime(f * 0.5, t, 0.025)
    // 静止时完全没声音（没有怠速）：踩着油门才有引擎声；松开油门滑行时越慢越轻，停稳就没了
    const presence = s.throttle !== 0 ? 1 : Math.min(1, Math.max(0, (v - 0.02) / 0.15))
    // 踩油门时声音更亮、更响；被粘住时发闷（低通压低）
    const bright = (s.throttle > 0 ? 1 : 0.55) * (s.stuck ? 0.35 : 1)
    e.lp.frequency.setTargetAtTime(250 + 1500 * this.rpm * bright, t, 0.04)
    e.gain.gain.setTargetAtTime(s.on ? presence * (0.018 + (s.throttle !== 0 ? 0.04 : 0.02) * this.rpm) : 0, t, 0.08)
    // 风噪：越快越响、越亮；空中更明显
    e.windF.frequency.setTargetAtTime(350 + 1400 * Math.min(1.6, v), t, 0.1)
    e.windG.gain.setTargetAtTime(s.on ? Math.min(0.18, 0.05 * v * v) * (s.air ? 1.5 : 1) : 0, t, 0.12)
    // 轮胎尖叫：打滑还踩着油门
    e.skidF.frequency.setTargetAtTime(2300 + 500 * Math.sin(t * 23), t, 0.02)
    e.skidG.gain.setTargetAtTime(s.on && s.slip && s.throttle > 0 && v > 0.08 ? 0.06 : 0, t, 0.04)
    // 涡轮哨音：加速状态
    e.whine.frequency.setTargetAtTime(1700 + 1600 * this.rpm, t, 0.05)
    e.whineG.gain.setTargetAtTime(s.on && s.boost && v > 0.05 ? 0.015 : 0, t, 0.1)
  }

  // 升档泄压：“噗”
  private blowoff() {
    if (!this.ok('blowoff', 0.25)) return
    this.noise(0.22, 0.12, 'highpass', 3000, 1200, 0.8)
  }

  // ---- 一次性的声音（场景里）
  // 打开一个发夹：短促的电子提示音；连续打开时一点点升调
  pickup() {
    if (!this.running()) return
    const since = this.ctx!.currentTime - (this.last.pickup ?? -9)
    if (!this.ok('pickup', 0.06)) return
    this.streak = since > 0.6 ? 0 : Math.min(14, this.streak + 1)
    const f = 1250 * 1.035 ** this.streak
    this.tone(f, f * 1.25, 0.05, 'square', 0.035, 0, 4000)
  }
  // 冲刺台加速：涡轮增压（哨音往上拉 + 一阵气流）
  turbo() {
    if (!this.ok('turbo', 0.4)) return
    this.tone(700, 2900, 0.55, 'sine', 0.06)
    this.noise(0.5, 0.18, 'bandpass', 600, 3800, 1.4)
  }
  // 捡到 H2：氮气喷射（“嗤——”+ 一下闷推 + 哨音）
  nitro() {
    if (!this.ok('nitro', 0.3)) return
    this.noise(0.6, 0.3, 'highpass', 5000, 1800, 0.7)
    this.tone(130, 55, 0.25, 'sine', 0.45)
    this.tone(1400, 3200, 0.45, 'sine', 0.05, 0.05)
  }
  // 冲出冲刺台：悬挂一松“咚”
  jump() {
    if (!this.ok('jump', 0.15)) return
    this.tone(170, 90, 0.12, 'sine', 0.3)
  }
  // 落地：悬挂砸底，越重越低越响；重的再加一声金属碰撞
  land(k: number) {
    if (!this.ok('land', 0.1)) return
    this.tone(120, 38, 0.2 + 0.15 * k, 'sine', 0.35 + 0.35 * k)
    this.noise(0.18 + 0.12 * k, 0.15 + 0.25 * k, 'lowpass', 1200, 150)
    if (k > 0.5) this.tone(310, 260, 0.12, 'square', 0.04 * k, 0.01, 1800)
  }
  // 砸地：重击 + 街机式加分音效（锯齿和弦往上冲，震开得越多越长）
  slam(n: number) {
    if (!this.ok('slam', 0.2)) return
    this.tone(85, 26, 0.85, 'sine', 0.8)
    this.noise(0.6, 0.5, 'lowpass', 2200, 90)
    const notes = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5]
    const m = Math.min(notes.length, 3 + Math.floor(n / 20))
    for (let i = 0; i < m; i++) {
      const last = i === m - 1
      this.tone(notes[i], notes[i], last ? 0.45 : 0.12, 'sawtooth', 0.09, 0.1 + i * 0.06, 2600)
      if (last) this.tone(notes[i] * 1.5, notes[i] * 1.5, 0.45, 'sawtooth', 0.05, 0.1 + i * 0.06, 2600)
    }
  }
  // 撞晶体柱：撞车（低频碎裂 + 金属的不和谐泛音 + 一点玻璃声）
  crash() {
    if (!this.ok('crash', 0.2)) return
    this.noise(0.55, 0.6, 'lowpass', 2600, 160)
    this.noise(0.25, 0.25, 'bandpass', 5200, 3000, 2, 0.02)
    for (const [f, at] of [[523, 0], [787, 0.01], [1173, 0.02], [1590, 0.035]]) this.tone(f, f * 0.97, 0.35, 'square', 0.03, at, 3500)
    this.tone(95, 40, 0.3, 'sine', 0.5)
  }
  // 被粘满：一记沉闷的“咕咚”（像车陷进泥里）；之后引擎在 drive() 里发闷
  bog() {
    if (!this.ok('bog', 0.3)) return
    this.tone(140, 55, 0.35, 'sine', 0.5)
    this.noise(0.35, 0.3, 'lowpass', 600, 150, 3)
  }
  // 挣断一根黏丝：“咔”
  snap() {
    if (!this.ok('snap', 0.04)) return
    this.noise(0.05, 0.18, 'bandpass', 1600, 900, 3)
    this.tone(600, 300, 0.04, 'square', 0.05, 0, 2500)
  }
  // 挣脱：轮胎一声尖叫 + 一下闷推
  breakFree() {
    if (!this.ok('breakFree', 0.3)) return
    this.noise(0.45, 0.25, 'bandpass', 2900, 2200, 7)
    this.tone(120, 60, 0.2, 'sine', 0.35)
  }
  // 腿重新抓住：轻“咔”
  latch() {
    if (!this.ok('latch', 0.1)) return
    this.noise(0.04, 0.1, 'bandpass', 2200, 1600, 4)
  }
  // 被缠住：低沉的磨擦声
  tangle() {
    if (!this.ok('tangle', 0.5)) return
    this.noise(0.35, 0.25, 'lowpass', 500, 180, 2)
    this.tone(75, 50, 0.3, 'sawtooth', 0.06, 0, 400)
  }

  // ---- 界面上的声音
  // 起跑提示音：3、2、1 三声短的低音，GO 一声长的高音
  startBeep(go: boolean) {
    if (!this.ok(go ? 'beepGo' : 'beep', 0.2)) return
    this.tone(go ? 880 : 440, go ? 880 : 440, go ? 0.7 : 0.18, 'square', 0.12, 0, 3000)
  }
  // 最后 10 秒的警示音
  tick() {
    if (!this.ok('tick', 0.3)) return
    this.tone(1050, 1050, 0.07, 'square', 0.06, 0, 3000)
  }
  // 时间到：终点喇叭，两声
  finish() {
    if (!this.ok('finish', 1)) return
    for (const at of [0, 0.32]) {
      this.tone(349.2, 349.2, 0.28, 'sawtooth', 0.12, at, 1800)
      this.tone(440, 440, 0.28, 'sawtooth', 0.1, at, 1800)
    }
  }
  // 破纪录：胜利号角（铜管味的锯齿和弦）
  fanfare() {
    if (!this.ok('fanfare', 1)) return
    const seq: [number, number, number][] = [[523.25, 0, 0.14], [659.25, 0.15, 0.14], [783.99, 0.3, 0.14], [1046.5, 0.45, 0.7]]
    for (const [f, at, dur] of seq) {
      this.tone(f, f, dur, 'sawtooth', 0.1, at, 2400)
      this.tone(f / 2, f / 2, dur, 'sawtooth', 0.06, at, 1200)
    }
    this.tone(783.99, 783.99, 0.7, 'sawtooth', 0.06, 0.45, 2400)
  }
  // 菜单按钮：选择提示音
  click() {
    if (!this.ok('click', 0.05)) return
    this.tone(1400, 1900, 0.05, 'sine', 0.08)
  }
}

export const sfx = new Sfx()

// 调试用：浏览器控制台里看 __sfx（例如 __sfx.ctx.state）
;(globalThis as unknown as { __sfx: Sfx }).__sfx = sfx

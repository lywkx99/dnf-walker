// 全部贴图都在浏览器里用画布现画，不加载任何图片文件
import * as THREE from 'three'

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
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

function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// 柔和的圆形光晕（月晕、星球大气）
export function glowTexture() {
  const [c, g] = canvas(256, 256)
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(0.18, 'rgba(255,255,255,0.55)')
  r.addColorStop(0.45, 'rgba(255,255,255,0.14)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 256, 256)
  return tex(c)
}

// 月面：浅灰底 + 暗色“月海” + 带亮边的环形山
export function moonTexture() {
  const [c, g] = canvas(1024, 512)
  const rand = rng(11)
  g.fillStyle = '#d9dce6'
  g.fillRect(0, 0, 1024, 512)
  for (let i = 0; i < 14; i++) {
    const x = rand() * 1024, y = 80 + rand() * 350, r = 40 + rand() * 120
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, 'rgba(120,128,150,0.55)')
    gr.addColorStop(1, 'rgba(120,128,150,0)')
    g.fillStyle = gr
    g.beginPath()
    g.ellipse(x, y, r * 1.4, r, rand() * 3, 0, Math.PI * 2)
    g.fill()
  }
  for (let i = 0; i < 260; i++) {
    const x = rand() * 1024, y = rand() * 512, r = 2 + Math.pow(rand(), 3) * 26
    g.fillStyle = 'rgba(110,116,138,0.45)'
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = Math.max(1, r * 0.18)
    g.beginPath()
    g.arc(x - r * 0.12, y - r * 0.12, r, Math.PI * 0.9, Math.PI * 1.9)
    g.stroke()
  }
  return tex(c)
}

// 外星气态巨行星：紫、青、橙的扰动条带
export function bandsTexture() {
  const [c, g] = canvas(1024, 512)
  const rand = rng(23)
  const pal = ['#3b2a6e', '#5d3f9e', '#2f6f8f', '#7fb8c9', '#b06a8e', '#e0a070', '#4a2f7a', '#2a4f7a']
  let y = 0
  while (y < 512) {
    const h = 6 + rand() * 40
    g.fillStyle = pal[Math.floor(rand() * pal.length)]
    g.globalAlpha = 0.85
    g.fillRect(0, y, 1024, h + 2)
    y += h
  }
  g.globalAlpha = 1
  // 横向扰动
  const img = g.getImageData(0, 0, 1024, 512)
  const out = g.createImageData(1024, 512)
  for (let yy = 0; yy < 512; yy++) {
    const shift = Math.round(Math.sin(yy * 0.08) * 14 + Math.sin(yy * 0.023 + 1) * 22)
    for (let x = 0; x < 1024; x++) {
      const sy = Math.min(511, Math.max(0, yy + Math.round(Math.sin((x + shift) * 0.012 + yy * 0.05) * 5)))
      const si = (sy * 1024 + ((x + shift + 1024) % 1024)) * 4
      const di = (yy * 1024 + x) * 4
      out.data[di] = img.data[si]
      out.data[di + 1] = img.data[si + 1]
      out.data[di + 2] = img.data[si + 2]
      out.data[di + 3] = 255
    }
  }
  g.putImageData(out, 0, 0)
  // 一个大风暴眼
  const gr = g.createRadialGradient(640, 300, 0, 640, 300, 46)
  gr.addColorStop(0, 'rgba(255,200,150,0.9)')
  gr.addColorStop(1, 'rgba(255,200,150,0)')
  g.fillStyle = gr
  g.beginPath()
  g.ellipse(640, 300, 70, 32, 0, 0, Math.PI * 2)
  g.fill()
  return tex(c)
}

// 行星环：沿半径方向的明暗条纹（带透明度）
export function ringTexture() {
  const [c, g] = canvas(1024, 8)
  const rand = rng(5)
  for (let x = 0; x < 1024; x++) {
    const t = x / 1024
    const a = (0.25 + 0.75 * rand()) * Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(t * 60))
    g.fillStyle = `rgba(${200 + rand() * 55},${190 + rand() * 50},${230},${Math.max(0, a).toFixed(3)})`
    g.fillRect(x, 0, 1, 8)
  }
  return tex(c)
}

// DNF 表面细节：密集缠绕的 DNA 纤维（灰度，用作颜色调制和凹凸）
export function fiberTexture() {
  const [c, g] = canvas(1024, 1024)
  const rand = rng(31)
  g.fillStyle = '#808080'
  g.fillRect(0, 0, 1024, 1024)
  for (let i = 0; i < 2600; i++) {
    const x = rand() * 1024, y = rand() * 1024
    const a = rand() * Math.PI * 2, l = 30 + rand() * 120
    const light = rand() > 0.5
    g.strokeStyle = light ? `rgba(255,255,255,${0.08 + rand() * 0.16})` : `rgba(0,0,0,${0.08 + rand() * 0.18})`
    g.lineWidth = 1 + rand() * 2.5
    g.beginPath()
    g.moveTo(x, y)
    g.bezierCurveTo(x + Math.cos(a) * l * 0.4 + (rand() - 0.5) * 40, y + Math.sin(a) * l * 0.4 + (rand() - 0.5) * 40,
      x + Math.cos(a) * l * 0.8 + (rand() - 0.5) * 40, y + Math.sin(a) * l * 0.8 + (rand() - 0.5) * 40,
      x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.stroke()
  }
  const t = tex(c, false)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

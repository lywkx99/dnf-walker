import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PLANET_R, TERRAIN, terrainH } from './model'
import { glowTexture } from './textures'
import { ZoneRing } from './TrapZones'

// 吸附井（非特异性吸附）的样子：
// 井面是一层贴着碗形地形的凝胶，上面有往中心流的同心波纹和旋进去的螺旋流线，井沿一圈亮边；
// 中心立着一个往下旋的光漏斗；一群光点从井沿高处盘旋着被吸进中心；井边一圈酸绿色虚线。

const NR = 30 // 井面网格：半径方向的圈数（t 从 0 到 T_MAX）
const NS = 96 // 一圈的分段
const T_MAX = 1.2 // 网格铺到井半径的 1.2 倍（外圈透明，用来接住光点的高度）
const MOTES = 42 // 每口井的光点数

type Basis = { c: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; r: number }
const basisOf = (c: THREE.Vector3, r: number): Basis => {
  const a = new THREE.Vector3(-c.z, 0, c.x)
  if (a.lengthSq() < 1e-6) a.set(1, 0, 0)
  a.normalize()
  return { c, a, b: new THREE.Vector3().crossVectors(c, a), r }
}
// 井局部坐标（t = 到中心的距离 / 半径，th = 方位角）→ 单位方向
const dirAt = (B: Basis, t: number, th: number, out: THREE.Vector3) => {
  const al = t * B.r
  return out.copy(B.c).multiplyScalar(Math.cos(al))
    .addScaledVector(B.a, Math.sin(al) * Math.cos(th)).addScaledVector(B.b, Math.sin(al) * Math.sin(th)).normalize()
}

const GEL_VERT = /* glsl */ `
  attribute float aT;
  attribute float aTh;
  attribute float aSeed;
  varying float vT;
  varying float vTh;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    vT = aT; vTh = aTh; vSeed = aSeed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const GEL_FRAG = /* glsl */ `
  uniform float uTime;
  varying float vT;
  varying float vTh;
  varying float vSeed;
  #include <fog_pars_fragment>
  void main() {
    float t = vT;
    float tm = uTime + vSeed * 10.0;
    float body = 1.0 - smoothstep(0.9, 1.02, t);
    // 往中心流的同心波纹：越靠中心越密、越快
    float ring = smoothstep(0.55, 1.0, sin((t * 9.0 + 1.6 / (t + 0.18) + tm * 1.4) * 3.14159));
    // 旋进去的螺旋流线（对数螺线，随时间转）
    float sp = smoothstep(0.8, 1.0, sin(vTh * 5.0 + log(t + 0.04) * 6.0 + tm * 2.2));
    float rim = exp(-pow((t - 0.97) / 0.028, 2.0));
    float core = exp(-t * t * 55.0);
    vec3 deep = vec3(0.025, 0.07, 0.015);
    vec3 goo = vec3(0.42, 1.25, 0.09);
    vec3 col = deep + goo * (ring * 0.45 * (0.35 + t) + sp * 0.55 * smoothstep(0.06, 0.4, t));
    col += vec3(1.1, 2.5, 0.4) * rim + vec3(1.5, 2.8, 0.6) * core;
    float a = clamp(body * 0.8 + rim, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
`
const FUNNEL_VERT = /* glsl */ `
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const FUNNEL_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    // 螺旋条纹一圈圈往下旋（v = 0 在底部）
    float s = sin((vUv.x * 4.0 + vUv.y * 2.2 + uTime * 0.9) * 6.2831853);
    float stripe = smoothstep(0.35, 1.0, s);
    float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.12, vUv.y);
    vec3 col = vec3(0.55, 1.6, 0.18) * stripe * fade * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`

export default function Wells() {
  const R = PLANET_R
  const wells = TERRAIN.wells
  const glow = useMemo(glowTexture, [])
  const bases = useMemo(() => wells.map((m) => basisOf(m.c, m.r)), [wells])

  // 井面网格（所有井合成一个），顺手记下每个网格点的高度，给光点用
  const { gelGeo, heights } = useMemo(() => {
    const pos: number[] = [], at: number[] = [], ath: number[] = [], seed: number[] = [], idx: number[] = []
    const heights: Float32Array[] = []
    const d = new THREE.Vector3()
    bases.forEach((B, w) => {
      const base = pos.length / 3
      const hg = new Float32Array((NR + 1) * (NS + 1))
      for (let i = 0; i <= NR; i++) {
        const t = (i / NR) * T_MAX
        for (let j = 0; j <= NS; j++) {
          const th = (j / NS) * Math.PI * 2
          dirAt(B, t, th, d)
          const h = terrainH(d.x, d.y, d.z)
          hg[i * (NS + 1) + j] = h
          pos.push(d.x * (R + h + 0.05), d.y * (R + h + 0.05), d.z * (R + h + 0.05))
          at.push(t)
          ath.push(th)
          seed.push(w * 0.37)
        }
      }
      heights.push(hg)
      for (let i = 0; i < NR; i++)
        for (let j = 0; j < NS; j++) {
          const k = base + i * (NS + 1) + j
          idx.push(k, k + NS + 1, k + 1, k + 1, k + NS + 1, k + NS + 2)
        }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1))
    g.setAttribute('aTh', new THREE.Float32BufferAttribute(ath, 1))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
    g.setIndex(idx)
    return { gelGeo: g, heights }
  }, [bases, R])
  const heightAt = (w: number, t: number, th: number) => {
    const i = Math.min(NR, Math.round((t / T_MAX) * NR))
    const j = Math.round(((((th / (Math.PI * 2)) % 1) + 1) % 1) * NS)
    return heights[w][i * (NS + 1) + j]
  }

  const gelMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: GEL_VERT, fragmentShader: GEL_FRAG, fog: true,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), [])
  const funnelMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: FUNNEL_VERT, fragmentShader: FUNNEL_FRAG, fog: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), [])
  const funnelGeo = useMemo(() => new THREE.CylinderGeometry(1.05, 0.08, 1.3, 48, 6, true).translate(0, 0.65, 0), [])

  // 漏斗和中心光团：立在井底，朝着当地的“上”
  const cores = useMemo(() => bases.map((B, w) => {
    const h = heightAt(w, 0, 0)
    return {
      pos: B.c.clone().multiplyScalar(R + h),
      q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.c),
    }
  }), [bases, R])

  // 光点：每颗有自己的起始相位、方位角和速度
  const motes = useMemo(() => {
    const n = wells.length * MOTES
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage))
    const seeds = Array.from({ length: n }, (_, k) => ({ p0: (k * 0.618) % 1, th0: (k * 2.39996) % (Math.PI * 2), sp: 0.13 + ((k * 7) % 10) * 0.012 }))
    return { g, seeds }
  }, [wells.length])
  const coreRefs = useRef<THREE.Sprite[]>([])
  const d = useMemo(() => new THREE.Vector3(), [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    gelMat.uniforms.uTime.value = t
    funnelMat.uniforms.uTime.value = t
    const P = motes.g.attributes.position as THREE.BufferAttribute
    const C = motes.g.attributes.color as THREE.BufferAttribute
    for (let w = 0; w < bases.length; w++) {
      const B = bases[w]
      for (let k = 0; k < MOTES; k++) {
        const i = w * MOTES + k
        const s = motes.seeds[i]
        const p = (s.p0 + t * s.sp) % 1
        // 从井沿外高处出发，盘旋着越转越快、越落越低，最后没入中心
        const tr = 1.15 * Math.pow(1 - p, 0.85)
        const th = s.th0 + 5.5 * Math.pow(p, 1.6)
        const lift = 0.12 + 1.7 * Math.pow(1 - p, 1.4)
        dirAt(B, tr, th, d)
        const rr = R + heightAt(w, tr, th) + lift
        P.setXYZ(i, d.x * rr, d.y * rr, d.z * rr)
        const f = THREE.MathUtils.smoothstep(p, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(p, 0.86, 1))
        C.setXYZ(i, 0.55 * f, 1.6 * f, 0.2 * f)
      }
      const sp = coreRefs.current[w]
      if (sp) {
        const k = 1.6 + 0.35 * Math.sin(t * 3.1 + w)
        sp.scale.set(k, k, 1)
      }
    }
    P.needsUpdate = true
    C.needsUpdate = true
  })

  return (
    <>
      <mesh geometry={gelGeo} material={gelMat} renderOrder={1} />
      {cores.map((c, w) => (
        <group key={w} position={c.pos} quaternion={c.q}>
          <mesh geometry={funnelGeo} material={funnelMat} />
          <sprite ref={(s) => { if (s) coreRefs.current[w] = s }} position={[0, 0.35, 0]}>
            <spriteMaterial map={glow} color={[0.7, 2.2, 0.25]} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
          </sprite>
        </group>
      ))}
      <points geometry={motes.g} frustumCulled={false}>
        <pointsMaterial map={glow} size={0.34} sizeAttenuation vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <ZoneRing zones={wells} color={[1.2, 2.8, 0.35]} at={1.12} />
    </>
  )
}

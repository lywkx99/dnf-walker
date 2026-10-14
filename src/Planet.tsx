import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PLANET_R, TERRAIN, TERRAIN_PARTS, terrainH, terrainNormal } from './model'
import { fiberTexture, glowTexture } from './textures'

// 崎岖的星球表面：按高度、坡度和地形成分上色——谷底深靛、高处淡紫、山脊发亮、陨坑底偏紫、坑沿发青、跳台面带一层青色、搓板路偏亮、吸附井底深绿
export function PlanetSurface() {
  const fiber = useMemo(() => {
    const t = fiberTexture()
    t.repeat.set(40, 20)
    return t
  }, [])
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(PLANET_R, 720, 360)
    const p = g.attributes.position
    const col = new Float32Array(p.count * 3)
    const deep = new THREE.Color('#141a46'), light = new THREE.Color('#8494dc'), ridge = new THREE.Color('#b7c3ff')
    const craterC = new THREE.Color('#3a1f74'), rimC = new THREE.Color('#5fd6e0'), rampC = new THREE.Color('#2fe0d0'), mogulC = new THREE.Color('#a68cff'), wellC = new THREE.Color('#14300c')
    const c = new THREE.Color(), u = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      u.set(p.getX(i), p.getY(i), p.getZ(i)).normalize()
      const h = terrainH(u.x, u.y, u.z)
      const P = TERRAIN_PARTS
      p.setXYZ(i, u.x * (PLANET_R + h), u.y * (PLANET_R + h), u.z * (PLANET_R + h))
      c.copy(deep).lerp(light, THREE.MathUtils.smoothstep(h, -1.4, 1.3))
      c.lerp(ridge, P.ridge * 0.35)
      c.lerp(craterC, P.crater * 0.7)
      c.lerp(rimC, P.rim * 0.35)
      c.lerp(mogulC, P.mogul * 0.25)
      c.lerp(rampC, P.ramp * 0.55)
      c.lerp(wellC, P.well * 0.85)
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.computeVertexNormals()
    return g
  }, [])
  return (
    <mesh geometry={geo} receiveShadow>
      <meshPhysicalMaterial vertexColors map={fiber} bumpMap={fiber} bumpScale={1.4} roughness={0.7}
        sheen={0.9} sheenColor="#93a8ff" sheenRoughness={0.4} clearcoat={0.18} clearcoatRoughness={0.55} />
    </mesh>
  )
}

// 跳台上的发光箭头：三道“^”指向起飞方向
export function RampMarks() {
  const geo = useMemo(() => {
    const R = PLANET_R
    const pos: number[] = []
    const dir = new THREE.Vector3()
    const at = (m: (typeof TERRAIN.ramps)[number], lx: number, ly: number) => {
      dir.copy(m.c).addScaledVector(m.f, lx / R).addScaledVector(m.s, ly / R).normalize()
      const h = terrainH(dir.x, dir.y, dir.z)
      return [dir.x * (R + h + 0.06), dir.y * (R + h + 0.06), dir.z * (R + h + 0.06)]
    }
    for (const m of TERRAIN.ramps) {
      for (const x0 of [-3.6, -2.4, -1.2]) {
        const w = 0.2, arm = Math.min(0.9, m.W * 0.5)
        for (const sgn of [-1, 1]) {
          // 一条臂：从 (x0 - 0.55, ±arm) 到 (x0, 0) 的窄条
          const a = at(m, x0 - 0.55, sgn * arm), b = at(m, x0, 0)
          const a2 = at(m, x0 - 0.55 - w, sgn * arm), b2 = at(m, x0 - w, 0)
          pos.push(...a, ...b, ...b2, ...a, ...b2, ...a2)
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [])
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial color={[0.3, 2.4, 2.2]} side={THREE.DoubleSide} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  )
}

// 晶体柱：外壳（半透明感的冷色晶体）+ 内芯（发光）
export function Crystals() {
  const shell = useRef<THREE.InstancedMesh>(null!)
  const core = useRef<THREE.InstancedMesh>(null!)
  const list = TERRAIN.crystals
  const geo = useMemo(() => new THREE.OctahedronGeometry(1, 0), [])
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), n = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color()
    list.forEach((c, i) => {
      terrainNormal(c.c, n)
      n.lerp(c.c, 0.6).normalize()
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
      q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.spin)
      q.multiply(q2).multiply(q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), c.tilt))
      pos.copy(c.c).multiplyScalar(PLANET_R + c.base).addScaledVector(n, c.hc * 0.45 - 0.2)
      m.compose(pos, q, new THREE.Vector3(c.rc * 1.15, c.hc * 0.55, c.rc * 1.15))
      shell.current.setMatrixAt(i, m)
      m.compose(pos, q, new THREE.Vector3(c.rc * 0.45, c.hc * 0.42, c.rc * 0.45))
      core.current.setMatrixAt(i, m)
      col.setHSL(0.5 + c.hue * 0.35, 0.9, 0.6)
      shell.current.setColorAt(i, col)
      col.setHSL(0.5 + c.hue * 0.35, 1, 0.5).multiplyScalar(3)
      core.current.setColorAt(i, col)
    })
    for (const mesh of [shell.current, core.current]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [list])
  return (
    <>
      <instancedMesh ref={shell} args={[geo, undefined, list.length]} castShadow>
        <meshPhysicalMaterial roughness={0.08} metalness={0.1} clearcoat={1} transparent opacity={0.72} emissive="#1b1040" flatShading />
      </instancedMesh>
      <instancedMesh ref={core} args={[geo, undefined, list.length]}>
        <meshBasicMaterial />
      </instancedMesh>
    </>
  )
}

// 贴着星球表面漂浮的荧光孢子：两层，随星球一起转，所以前进时能看到它们从身边掠过
export function Spores() {
  const glow = useMemo(glowTexture, [])
  const layers = useMemo(() => {
    const make = (n: number, h0: number, h1: number, seed: number) => {
      const pos = new Float32Array(n * 3)
      let a = seed
      const r = () => ((a = (a * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < n; i++) {
        const y = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - y * y)
        const rad = PLANET_R + h0 + r() * (h1 - h0)
        pos.set([Math.cos(t) * s * rad, y * rad, Math.sin(t) * s * rad], i * 3)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      return g
    }
    return [make(2600, 1.5, 8, 11), make(900, 3, 13, 29)]
  }, [])
  const g1 = useRef<THREE.Points>(null!)
  const g2 = useRef<THREE.Points>(null!)
  useFrame((_, dt) => {
    g1.current.rotation.y += dt * 0.012
    g2.current.rotation.x -= dt * 0.008
  })
  return (
    <>
      <points ref={g1} geometry={layers[0]}>
        <pointsMaterial map={glow} size={0.32} sizeAttenuation color={[0.35, 1.6, 1.3]} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points ref={g2} geometry={layers[1]}>
        <pointsMaterial map={glow} size={0.6} sizeAttenuation color={[0.9, 0.5, 1.8]} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  )
}

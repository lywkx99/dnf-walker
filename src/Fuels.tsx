import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TERRAIN } from './model'
import { glowTexture } from './textures'
import { view } from './scene'

// H2 燃料：一小段旋转的 DNA 双螺旋（电光蓝），外面一圈脉动的光环，上下浮动。
// 被捡走后缩没，过一阵重新长出来（场景把每个燃料的冷却时间写在 view.fuelCD）。

function helixGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const H = 0.9, r = 0.2, turns = 1.3
  for (const phase of [0, Math.PI]) {
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 40; k++) {
      const y = -H / 2 + (H * k) / 40
      const a = (y / H) * turns * Math.PI * 2 + phase
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r))
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.034, 6, false))
  }
  // 碱基对：两条链之间的横档
  for (let k = 1; k < 8; k++) {
    const y = -H / 2 + (H * k) / 8
    const a = (y / H) * turns * Math.PI * 2
    const rung = new THREE.CylinderGeometry(0.016, 0.016, r * 2, 5)
    rung.rotateZ(Math.PI / 2)
    rung.rotateY(-a)
    rung.translate(0, y, 0)
    parts.push(rung)
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))
}

export default function Fuels() {
  const list = TERRAIN.fuels
  const helix = useMemo(helixGeometry, [])
  const glow = useMemo(glowTexture, [])
  const ringGeo = useMemo(() => new THREE.TorusGeometry(0.42, 0.018, 6, 40).rotateX(Math.PI / 2), [])
  const placed = useMemo(() => list.map((f) => ({
    pos: f.p.clone(),
    q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), f.c),
  })), [list])
  const spin = useRef<THREE.Group[]>([])
  const rings = useRef<THREE.Mesh[]>([])
  const scale = useMemo(() => new Float32Array(list.length).fill(1), [list.length])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const cd = view.fuelCD
    list.forEach((_, k) => {
      const g = spin.current[k]
      if (!g) return
      const target = cd && cd[k] > 0 ? 0 : 1
      scale[k] += (target - scale[k]) * (1 - Math.exp(-(target ? 4 : 14) * dt))
      const s = scale[k] < 0.01 ? 0 : scale[k]
      g.visible = s > 0
      g.scale.setScalar(s)
      g.position.y = 0.12 * Math.sin(t * 2 + k)
      g.rotation.y = t * 1.8 + k
      const ring = rings.current[k]
      if (ring) {
        const p = 1 + 0.18 * Math.sin(t * 4 + k * 1.7)
        ring.scale.set(p, 1, p)
        ring.rotation.y = -t * 0.9
      }
    })
  })

  return (
    <>
      {placed.map((f, k) => (
        <group key={k} position={f.pos} quaternion={f.q}>
          <group ref={(g) => { if (g) spin.current[k] = g }}>
            <mesh geometry={helix}>
              <meshBasicMaterial color={[0.5, 1.5, 3.4]} />
            </mesh>
            <mesh geometry={ringGeo} ref={(m) => { if (m) rings.current[k] = m }}>
              <meshBasicMaterial color={[1.2, 2.2, 3.6]} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <sprite scale={[1.9, 1.9, 1]}>
              <spriteMaterial map={glow} color={[0.25, 0.7, 1.6]} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
            </sprite>
          </group>
        </group>
      ))}
    </>
  )
}

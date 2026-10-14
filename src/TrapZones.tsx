import { useMemo } from 'react'
import * as THREE from 'three'
import { PLANET_R, TERRAIN, terrainH } from './model'

// 区域边界：地面一圈虚线光圈（自陷区红色，吸附井酸绿色）。不立标识牌——障碍不提前告诉你，要自己认地形。

type Zone = { c: THREE.Vector3; r: number }

export function ZoneRing({ zones, color, at = 1 }: { zones: Zone[]; color: [number, number, number]; at?: number }) {
  const R = PLANET_R
  const geo = useMemo(() => {
    const pts: number[] = []
    for (const m of zones) {
      const a = new THREE.Vector3(-m.c.z, 0, m.c.x)
      if (a.lengthSq() < 1e-6) a.set(1, 0, 0)
      a.normalize()
      const b = new THREE.Vector3().crossVectors(m.c, a)
      const N = 96
      const rr = m.r * at
      for (let i = 0; i < N; i++) {
        if (i % 4 === 3) continue // 虚线的空档
        for (const k of [i, i + 1]) {
          const t = (k / N) * Math.PI * 2
          const d = m.c.clone().multiplyScalar(Math.cos(rr)).addScaledVector(a, Math.sin(rr) * Math.cos(t)).addScaledVector(b, Math.sin(rr) * Math.sin(t)).normalize()
          const h = terrainH(d.x, d.y, d.z) + 0.1
          pts.push(d.x * (R + h), d.y * (R + h), d.z * (R + h))
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [zones, R, at])
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={color} transparent opacity={0.85} />
    </lineSegments>
  )
}

// 自陷区（折叠区：纳米花折叠出的崎岖沟槽，拓扑受限、产物富集，位点加密 3 倍）
export default function TrapZones() {
  return <ZoneRing zones={TERRAIN.moguls} color={[2.6, 0.5, 0.35]} />
}

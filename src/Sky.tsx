import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { bandsTexture, glowTexture, moonTexture, ringTexture } from './textures'
import { HORIZON, MOON_DIR, view } from './scene'


const PLANET_DIR = new THREE.Vector3(-0.56, 0.15, 0.81).normalize()
const MOON2_DIR = new THREE.Vector3(0.26, 0.22, 0.94).normalize()


const NOISE = /* glsl */ `
float hash3(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i+vec3(0,0,0)), hash3(i+vec3(1,0,0)), f.x), mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x), mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i = 0; i < 5; i++){ s += a*noise3(p); p *= 2.03; a *= 0.5; } return s; }
`

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uMoon: { value: MOON_DIR }, uHorizon: { value: HORIZON } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uMoon; uniform vec3 uHorizon; varying vec3 vDir;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 zenith = vec3(0.004, 0.007, 0.03);
        vec3 mid = vec3(0.018, 0.026, 0.085);
        vec3 col = mix(uHorizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.22, 0.85, h));
        col = mix(col, uHorizon * 0.6, smoothstep(0.0, -0.25, h));
        // 星云：紫红与青绿两层
        float n1 = fbm(d * 2.6 + vec3(0.0, uTime * 0.004, 0.0));
        float n2 = fbm(d * 4.4 + vec3(7.1, 2.3, uTime * 0.003));
        float band = exp(-pow((d.y - 0.3 + 0.3 * d.x) * 2.2, 2.0));
        col += vec3(0.2, 0.045, 0.28) * pow(n1, 2.6) * band * 2.6;
        col += vec3(0.02, 0.15, 0.16) * pow(n2, 3.2) * band * 2.4;
        // 月晕
        float m = max(dot(d, uMoon), 0.0);
        col += vec3(0.35, 0.42, 0.7) * pow(m, 220.0) * 0.8 + vec3(0.12, 0.15, 0.32) * pow(m, 14.0) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

function auroraMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      ${NOISE}
      void main(){
        float x = vUv.x, y = vUv.y, t = uTime;
        // 帘幕底边：大尺度的起伏和褶皱，慢慢飘动
        float fold = fbm(vec3(x * 3.0, t * 0.03, 1.7));
        float base = 0.18 + 0.32 * fold;
        float above = y - base;
        // 底边最亮，向上指数渐隐；底边以下快速消失
        float body = exp(-max(above, 0.0) * 3.2) * smoothstep(-0.015, 0.02, above);
        // 大块明暗：有的地方亮、有的地方断开
        float patchy = smoothstep(0.38, 0.75, fbm(vec3(x * 4.0 + t * 0.02, 3.1, t * 0.015)));
        // 细光柱：对比度很低，只是隐约的纹理
        float rays = 0.82 + 0.18 * fbm(vec3(x * 60.0 + fold * 8.0, y * 1.5, t * 0.05));
        float a = body * patchy * rays;
        a *= smoothstep(0.0, 0.15, x) * smoothstep(1.0, 0.85, x);
        vec3 col = mix(vec3(0.1, 1.0, 0.55), vec3(0.75, 0.25, 1.0), smoothstep(0.0, 0.35, above));
        gl_FragColor = vec4(col, a * 0.55);
      }`,
  })
}

// 漂浮在天上的“纳米花”：多瓣、起伏的球（外星天体，示意）
function sporeGeometry(seed: number) {
  const g = new THREE.IcosahedronGeometry(1, 5)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    const petals = Math.abs(Math.sin(v.x * 7 + seed) * Math.sin(v.y * 6 - seed) * Math.sin(v.z * 8 + seed * 0.5))
    v.multiplyScalar(1 + 0.42 * Math.pow(petals, 0.6))
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

export default function Sky() {
  const group = useRef<THREE.Group>(null!)
  const sky = useMemo(skyMaterial, [])
  const aurora = useMemo(auroraMaterial, [])
  const tex = useMemo(() => ({ glow: glowTexture(), moon: moonTexture(), bands: bandsTexture(), ring: ringTexture() }), [])
  const ringGeo = useMemo(() => {
    const inner = 52, outer = 92
    const g = new THREE.RingGeometry(inner, outer, 160, 1)
    const p = g.attributes.position, uv = g.attributes.uv
    for (let i = 0; i < p.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - inner) / (outer - inner), 0.5)
    return g
  }, [])
  const spores = useMemo(() => [
    { pos: new THREE.Vector3(-120, 60, 140), s: 9, geo: sporeGeometry(1) },
    { pos: new THREE.Vector3(150, 85, 60), s: 13, geo: sporeGeometry(2.3) },
    { pos: new THREE.Vector3(60, 45, -170), s: 7, geo: sporeGeometry(3.7) },
    { pos: new THREE.Vector3(-170, 95, -60), s: 11, geo: sporeGeometry(5.1) },
  ], [])
  const sporeRefs = useRef<THREE.Mesh[]>([])
  const meteor = useRef<THREE.Mesh>(null!)
  const meteorState = useMemo(() => ({ t: -3, from: new THREE.Vector3(), dir: new THREE.Vector3() }), [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    group.current.position.copy(state.camera.position)
    group.current.rotation.y = -view.yaw
    sky.uniforms.uTime.value = t
    aurora.uniforms.uTime.value = t
    sporeRefs.current.forEach((m, i) => {
      if (!m) return
      m.rotation.y += delta * (0.03 + i * 0.01)
      m.position.y = spores[i].pos.y + Math.sin(t * 0.2 + i) * 2
    })
    // 流星：每隔几秒划过一次
    const ms = meteorState
    ms.t += delta
    if (ms.t > 1.1) {
      ms.t = -4 - Math.random() * 6
      const a = Math.random() * Math.PI * 2
      ms.from.set(Math.sin(a) * 180, 120 + Math.random() * 60, Math.cos(a) * 180)
      ms.dir.set(-Math.sin(a + 0.6), -0.35, -Math.cos(a + 0.6)).normalize()
    }
    const m = meteor.current
    m.visible = ms.t > 0
    if (m.visible) {
      m.position.copy(ms.from).addScaledVector(ms.dir, ms.t * 160)
      m.lookAt(m.position.clone().add(ms.dir))
      const mat = m.material as THREE.MeshBasicMaterial
      mat.opacity = Math.sin(Math.PI * Math.min(1, ms.t / 1.1))
    }
  })

  const planetPos = PLANET_DIR.clone().multiplyScalar(240)
  const moonPos = MOON_DIR.clone().multiplyScalar(225)
  const moon2Pos = MOON2_DIR.clone().multiplyScalar(232)

  return (
    <group ref={group}>
      <mesh material={sky} renderOrder={-10}>
        <sphereGeometry args={[480, 64, 32]} />
      </mesh>
      <Stars radius={262} depth={70} count={7000} factor={5} saturation={0.6} fade speed={0.5} />

      {/* 极光帘幕（两段，在月亮两侧） */}
      <mesh material={aurora} position={[0, 40, 0]}>
        <cylinderGeometry args={[255, 255, 110, 160, 1, true, -1.9, 1.7]} />
      </mesh>
      <mesh material={aurora} position={[0, 46, 0]}>
        <cylinderGeometry args={[250, 250, 110, 160, 1, true, 0.35, 1.5]} />
      </mesh>

      {/* 月亮 + 月晕 */}
      <mesh position={moonPos} rotation={[0.3, 2.2, 0]}>
        <sphereGeometry args={[13, 64, 32]} />
        <meshBasicMaterial map={tex.moon} color={[1.7, 1.75, 1.95]} fog={false} />
      </mesh>
      <sprite position={moonPos.clone().multiplyScalar(1.02)} scale={[110, 110, 1]}>
        <spriteMaterial map={tex.glow} color={[0.45, 0.55, 0.95]} blending={THREE.AdditiveBlending} depthWrite={false} transparent fog={false} />
      </sprite>

      {/* 带环的气态巨行星 */}
      <group position={planetPos} rotation={[0.35, -0.6, 0.42]}>
        <mesh rotation={[0.2, 0, 0]}>
          <sphereGeometry args={[38, 96, 48]} />
          <meshStandardMaterial map={tex.bands} roughness={1} emissive="#1a0f33" emissiveIntensity={0.6} fog={false} />
        </mesh>
        <mesh geometry={ringGeo} rotation={[Math.PI / 2 - 0.25, 0, 0]}>
          <meshBasicMaterial map={tex.ring} color={[0.75, 0.68, 0.95]} transparent side={THREE.DoubleSide} depthWrite={false} fog={false} />
        </mesh>
      </group>
      <sprite position={planetPos.clone().multiplyScalar(1.05)} scale={[170, 170, 1]}>
        <spriteMaterial map={tex.glow} color={[0.12, 0.22, 0.32]} blending={THREE.AdditiveBlending} depthWrite={false} transparent fog={false} />
      </sprite>

      {/* 第二颗小卫星（青绿） */}
      <mesh position={moon2Pos}>
        <sphereGeometry args={[4.2, 32, 16]} />
        <meshBasicMaterial color={[0.35, 1.6, 1.3]} fog={false} />
      </mesh>
      <sprite position={moon2Pos.clone().multiplyScalar(1.01)} scale={[40, 40, 1]}>
        <spriteMaterial map={tex.glow} color={[0.1, 0.7, 0.6]} blending={THREE.AdditiveBlending} depthWrite={false} transparent fog={false} />
      </sprite>

      {/* 漂浮的纳米花 */}
      {spores.map((s, i) => (
        <mesh key={i} ref={(m) => { if (m) sporeRefs.current[i] = m }} geometry={s.geo} position={s.pos} scale={s.s}>
          <meshStandardMaterial color="#5b63a8" roughness={0.55} metalness={0.15} emissive="#1d1446" emissiveIntensity={0.8} fog={false} />
        </mesh>
      ))}

      {/* 流星 */}
      <mesh ref={meteor} visible={false}>
        <boxGeometry args={[0.35, 0.35, 26]} />
        <meshBasicMaterial color={[2.2, 2.4, 3.0]} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
    </group>
  )
}

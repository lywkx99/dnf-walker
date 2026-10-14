// 粒子与冲击环：用固定大小的对象池，每帧只改矩阵和颜色，不新建对象
import * as THREE from 'three'

// normal：这颗粒子的“上”方向（星球表面的法线），升起和下落都沿着它
type EmitOpts = { speed?: number; up?: number; size?: number; life?: number; gravity?: number; spread?: number; normal?: THREE.Vector3 }

export class Fx {
  readonly parts: THREE.InstancedMesh
  readonly rings: THREE.InstancedMesh
  private N = 700
  private RN = 60
  private p = new Float32Array(this.N * 3)
  private v = new Float32Array(this.N * 3)
  private c = new Float32Array(this.N * 3)
  private life = new Float32Array(this.N)
  private max = new Float32Array(this.N)
  private size = new Float32Array(this.N)
  private grav = new Float32Array(this.N)
  private nrm = new Float32Array(this.N * 3)
  private side = new THREE.Vector3()
  private side2 = new THREE.Vector3()
  private next = 0
  private rp = new Float32Array(this.RN * 3)
  private rq: THREE.Quaternion[] = []
  private rc = new Float32Array(this.RN * 3)
  private rlife = new Float32Array(this.RN)
  private rmax = new Float32Array(this.RN)
  private rsize = new Float32Array(this.RN)
  private rnext = 0
  private m = new THREE.Matrix4()
  private col = new THREE.Color()
  private s = new THREE.Vector3()
  private t = new THREE.Vector3()
  private zero = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor() {
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const
    this.parts = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial(add), this.N)
    const rg = new THREE.RingGeometry(0.82, 1, 48)
    rg.rotateX(-Math.PI / 2)
    this.rings = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ ...add, side: THREE.DoubleSide }), this.RN)
    for (const mesh of [this.parts, this.rings]) {
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      for (let i = 0; i < mesh.count; i++) {
        mesh.setMatrixAt(i, this.zero)
        mesh.setColorAt(i, this.col.setRGB(0, 0, 0))
      }
    }
    for (let i = 0; i < this.RN; i++) this.rq.push(new THREE.Quaternion())
    this.life.fill(1)
    this.max.fill(1)
    this.rlife.fill(1)
    this.rmax.fill(1)
  }

  emit(x: number, y: number, z: number, n: number, color: THREE.Color, o: EmitOpts = {}) {
    const speed = o.speed ?? 1.2, up = o.up ?? 1, spread = o.spread ?? 0.05
    const nv = o.normal ?? this.t.set(0, 1, 0)
    // 法线的两个切向
    this.side.set(-nv.z, 0, nv.x)
    if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0)
    this.side.normalize()
    this.side2.crossVectors(nv, this.side)
    for (let k = 0; k < n; k++) {
      const i = this.next
      this.next = (this.next + 1) % this.N
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9 + 0.1
      this.p[i * 3] = x + (Math.random() - 0.5) * spread
      this.p[i * 3 + 1] = y + (Math.random() - 0.5) * spread
      this.p[i * 3 + 2] = z + (Math.random() - 0.5) * spread
      const ca = Math.cos(a) * speed * (1 - e * 0.5), sa = Math.sin(a) * speed * (1 - e * 0.5), uu = up * speed * e
      this.v[i * 3] = this.side.x * ca + this.side2.x * sa + nv.x * uu
      this.v[i * 3 + 1] = this.side.y * ca + this.side2.y * sa + nv.y * uu
      this.v[i * 3 + 2] = this.side.z * ca + this.side2.z * sa + nv.z * uu
      this.nrm[i * 3] = nv.x
      this.nrm[i * 3 + 1] = nv.y
      this.nrm[i * 3 + 2] = nv.z
      this.c[i * 3] = color.r
      this.c[i * 3 + 1] = color.g
      this.c[i * 3 + 2] = color.b
      this.life[i] = 0
      this.max[i] = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6)
      this.size[i] = (o.size ?? 0.05) * (0.6 + Math.random() * 0.8)
      this.grav[i] = o.gravity ?? -0.6
    }
  }

  ring(x: number, y: number, z: number, normal: THREE.Vector3, color: THREE.Color, size = 0.6, life = 0.6) {
    const i = this.rnext
    this.rnext = (this.rnext + 1) % this.RN
    this.rp[i * 3] = x
    this.rp[i * 3 + 1] = y
    this.rp[i * 3 + 2] = z
    this.rq[i].setFromUnitVectors(this.t.set(0, 1, 0), normal)
    this.rc[i * 3] = color.r
    this.rc[i * 3 + 1] = color.g
    this.rc[i * 3 + 2] = color.b
    this.rlife[i] = 0
    this.rmax[i] = life
    this.rsize[i] = size
  }

  update(dt: number) {
    let dirty = false
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] >= this.max[i]) continue
      this.life[i] += dt
      dirty = true
      if (this.life[i] >= this.max[i]) {
        this.parts.setMatrixAt(i, this.zero)
        continue
      }
      const k = this.life[i] / this.max[i]
      this.v[i * 3] -= this.grav[i] * this.nrm[i * 3] * dt
      this.v[i * 3 + 1] -= this.grav[i] * this.nrm[i * 3 + 1] * dt
      this.v[i * 3 + 2] -= this.grav[i] * this.nrm[i * 3 + 2] * dt
      const drag = Math.exp(-1.8 * dt)
      this.v[i * 3] *= drag
      this.v[i * 3 + 1] *= drag
      this.v[i * 3 + 2] *= drag
      this.p[i * 3] += this.v[i * 3] * dt
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt
      const sc = this.size[i] * Math.sqrt(1 - k)
      this.m.makeScale(sc, sc, sc).setPosition(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2])
      this.parts.setMatrixAt(i, this.m)
      const f = Math.pow(1 - k, 1.4)
      this.parts.setColorAt(i, this.col.setRGB(this.c[i * 3] * f, this.c[i * 3 + 1] * f, this.c[i * 3 + 2] * f))
    }
    if (dirty) {
      this.parts.instanceMatrix.needsUpdate = true
      if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true
    }
    let rdirty = false
    for (let i = 0; i < this.RN; i++) {
      if (this.rlife[i] >= this.rmax[i]) continue
      this.rlife[i] += dt
      rdirty = true
      if (this.rlife[i] >= this.rmax[i]) {
        this.rings.setMatrixAt(i, this.zero)
        continue
      }
      const k = this.rlife[i] / this.rmax[i]
      const sc = this.rsize[i] * (0.15 + Math.sqrt(k))
      this.m.compose(this.t.set(this.rp[i * 3], this.rp[i * 3 + 1], this.rp[i * 3 + 2]), this.rq[i], this.s.set(sc, sc, sc))
      this.rings.setMatrixAt(i, this.m)
      const f = Math.pow(1 - k, 2)
      this.rings.setColorAt(i, this.col.setRGB(this.rc[i * 3] * f, this.rc[i * 3 + 1] * f, this.rc[i * 3 + 2] * f))
    }
    if (rdirty) {
      this.rings.instanceMatrix.needsUpdate = true
      if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true
    }
  }

  dispose() {
    for (const mesh of [this.parts, this.rings]) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    }
  }
}

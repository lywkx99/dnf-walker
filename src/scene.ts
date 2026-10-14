import * as THREE from 'three'

// 月光方向（开局视角的正前上方），也是月光平行光的方向
export const MOON_DIR = new THREE.Vector3(-0.06, 0.24, 0.97).normalize()
// 天空在地平线附近的颜色（线性空间），雾用同一个颜色，地平线才接得上
export const HORIZON = new THREE.Color().setRGB(0.075, 0.055, 0.16)
// 场景每帧写、各个组件读的共享状态：
// yaw：walker 累计转过的角度（天空跟着反向转）；
// fuelCD：每个 H2 燃料多久后重新出现（0 = 在场，燃料组件据此显示 / 隐藏）
export const view = { yaw: 0, fuelCD: null as Float32Array | null }

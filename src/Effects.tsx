import { Bloom, EffectComposer, N8AO, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

// 后期：环境光遮蔽（高画质）→ 辉光 → 电影色调映射 → 抗锯齿 → 暗角 → 细微胶片颗粒
export default function Effects({ hq }: { hq: boolean }) {
  if (hq)
    return (
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={1.2} intensity={2.4} distanceFalloff={0.8} halfRes quality="performance" />
        <Bloom mipmapBlur intensity={1.25} luminanceThreshold={0.82} luminanceSmoothing={0.25} radius={0.75} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA />
        <Vignette offset={0.2} darkness={0.62} />
        <Noise opacity={0.028} />
      </EffectComposer>
    )
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.85} luminanceSmoothing={0.25} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
      <Vignette offset={0.2} darkness={0.6} />
    </EffectComposer>
  )
}

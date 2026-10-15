// index.html 里载入画面的接口（见那里的说明）：build() 进入“搭建星球”阶段，done() 收起载入画面
type Boot = { build: () => void; done: () => void }
export const boot = () => (window as unknown as { __boot?: Boot }).__boot

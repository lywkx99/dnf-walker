import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 没有 Bahnschrift 的设备（iPhone、安卓、Mac）用的窄体字，随网页打包、不联网也能用（Windows 上不会下载）
import '@fontsource-variable/saira/wdth.css'
import './index.css'
import App from './App.tsx'
import { isTouch } from './hud'
import { boot } from './boot'

// 脚本到了：载入画面进入“搭建星球”（打包后的版本里载入脚本已经切过了，这里是给开发模式用的）
boot()?.build()

// 触屏设备用另一套版面（屏幕按钮、仪表挪到右上、竖屏提示横过来），见 index.css 里的 html.touch
document.documentElement.classList.toggle('touch', isTouch)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

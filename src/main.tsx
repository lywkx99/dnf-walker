import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTouch } from './hud'

// 触屏设备用另一套版面（屏幕按钮、仪表挪到右上、竖屏提示横过来），见 index.css 里的 html.touch
document.documentElement.classList.toggle('touch', isTouch)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

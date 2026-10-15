import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// 打包时改写 index.html，让载入画面最先出现、并显示真实的下载进度：
// - 去掉 Vite 放进 head 的主脚本标签，把它的地址和大小（解压后的字节数）交给 index.html 里的载入脚本；
//   载入脚本先边下载边报进度，下完再插入同一个地址的脚本（走浏览器缓存，不会下第二遍）
// - 样式表改成不阻塞首屏（preload + onload 再生效），载入画面不用等它
function bootLoader(): Plugin {
  return {
    name: 'boot-loader',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const entry = Object.values(ctx.bundle ?? {}).find((c) => c.type === 'chunk' && c.isEntry)
        const script = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/
        const m = html.match(script)
        if (!entry || entry.type !== 'chunk' || !m) return html
        const size = new TextEncoder().encode(entry.code).length
        return html
          .replace(script, '')
          .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/, '<link rel="preload" as="style" crossorigin href="$1" onload="this.onload=null;this.rel=\'stylesheet\';window.__cssOk=1">')
          .replace('<!--boot-src-->', `<script>window.__BOOT_SRC=${JSON.stringify(m[1])};window.__BOOT_SIZE=${size}</script>`)
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), bootLoader()],
})

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * packages/embed 构建配置 —— 库模式（library mode）
 *
 * 设计取舍：
 *  - 只输出 ESM。2026 年所有目标环境都支持 <script type="module">，
 *    UMD 只会让产物翻倍。要 UMD 再自行加 formats。
 *  - Vue 内联进产物。嵌入场景下宿主站点未必有 Vue，
 *    内联换来「零依赖、单文件、任何站点都能用」，代价约 35KB（gzip ~13KB），划算。
 *  - 单入口单文件：部署时只需要 dist/forge-notes.js（+ 可选 css），
 *    对「把博客扔进别人网站」这个场景最省事。
 */
export default defineConfig({
  // 必须显式指定 root。否则 Vite 以「执行命令时的 cwd」为 root，
  // outDir: 'dist' 会落到仓库根的 dist/，而不是 packages/embed/dist/。
  root: dirname,
  plugins: [vue()],

  /**
   * ⚠️ 库模式必须显式替换 process.env.NODE_ENV。
   *
   * Vite 在 library mode 下**不会**自动替换它（它假设由库的使用方去处理），
   * 于是 Vue 的 dev 分支会被原样打进产物，浏览器里一执行就抛
   *   ReferenceError: process is not defined
   * 模块从此中断，defineCustomElement 根本没机会执行，
   * <forge-notes> 永远是未升级的空标签（没有 shadowRoot、不渲染）。
   *
   * 替换成字面量后，Rollup 的常量折叠会摇掉全部 dev 分支，
   * 顺带把产物体积降下来。
   */
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    // 组件全部用 <script setup>（Composition API），不需要 Options API 运行时，
    // 置 false 让 Rollup 摇掉这部分代码。若将来引入依赖 Options API 的库，改回 true。
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    // 嵌入场景的宿主站点可能很老。Vite 7 的默认 target 是别名
    // 'baseline-widely-available'（实测定义：chrome107 / edge107 / firefox104 / safari16），
    // 对「把博客塞进别人老站点」这个场景过于激进。
    // 放宽到 es2018（chrome63 / firefox58 / safari12）覆盖绝大多数在跑的浏览器，
    // Custom Elements v1 与 Shadow DOM 在同样范围里都已可用。
    target: 'es2018',
    lib: {
      entry: path.resolve(dirname, 'src/index.js'),
      name: 'ForgeNotes',
      formats: ['es'],
      fileName: () => 'forge-notes.js',
      cssFileName: 'forge-notes',
    },
    rollupOptions: {
      // 不 external 任何东西，包括 vue —— 保证产物自包含
      external: [],
      output: {
        assetFileNames: 'forge-notes.[ext]',
      },
    },
  },
})

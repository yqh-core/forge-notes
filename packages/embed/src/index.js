/**
 * packages/embed/src/index.js
 *
 * Forge Notes 嵌入式组件包的公开入口。对外提供三种用法，
 * 覆盖从「Vue 站点」到「任意老站点」的全部集成场景：
 *
 *   1. Vue 组件      import { ForgeNotes } from '@forge-notes/embed'
 *   2. 命令式挂载    createForgeNotes({ el: '#blog' })
 *   3. Web Component defineForgeNotesElement()  ->  <forge-notes>
 *
 * 全部形态共享同一份内容数据与同一份 site.config.mjs 品牌配置，
 * 不会出现「站点改名了、嵌入版还是旧名字」这种不一致。
 */

import { createApp, defineCustomElement } from 'vue'
import ForgeNotes from './ForgeNotes.vue'
import content from './content.generated.json'

// 同时以两种方式引入样式：
//  - 副作用引入 -> 产出 dist/forge-notes.css，宿主可 <link> 预加载，避免样式闪烁
//  - ?inline   -> 得到 CSS 字符串，供 Web Component 注入 Shadow DOM
import './styles.css'
import stylesText from './styles.css?inline'

export { default as ForgeNotes } from './ForgeNotes.vue'

/** 内容数据（只读），需要自定义渲染时可自行取用 */
export const forgeNotesContent = content

/**
 * 命令式挂载到指定容器。
 *
 * `el` 之外的所有字段都会被当作组件 props 原样透传，
 * 所以这里不再逐个列举（避免与组件声明漂移）——
 * 完整清单见 packages/embed/README.md 的 API 表或 index.d.ts 的 ForgeNotesProps。
 *
 * @param {object} options
 * @param {string|Element} options.el  选择器或 DOM 元素（必填）
 * @param {string} [options.title]     覆盖站点标题
 * @param {string} [options.description] 覆盖副标题
 * @param {number} [options.perPage]   每页文章数，0 表示不分页
 * @param {boolean} [options.searchable] 是否显示搜索框
 * @param {boolean} [options.showTags] 是否显示标签筛选栏
 * @param {number} [options.maxTags]   标签栏最多显示几个标签，0 表示全部铺开
 * @param {boolean} [options.useHash]  是否用 URL hash 做路由（默认 false，零侵入）
 * @param {string} [options.initialSlug] 初始直接打开的文章 slug
 * @param {'auto'|'light'|'dark'} [options.theme] 主题
 *
 * ⚠️ 作为 Web Component 用时，Boolean 属性请按 HTML 惯例写：
 *
 *     <forge-notes show-tags="false">   关掉标签栏（"false" / "0" / "no" / "off" 都算关）
 *     <forge-notes show-tags>           打开标签栏（空 attribute = true，HTML 惯例）
 *
 * 为什么需要说明：Vue 的 defineCustomElement **只对 Number 型** props 做类型转换，
 * Boolean 型拿到的是原始字符串。若不归一化，`="false"` 会被当成真值，与直觉相反。
 * 组件在内部做了归一化（见 ForgeNotes.vue 的 normalizeBool），所以上面两种写法都对。
 * @returns {{ app: import('vue').App, unmount: () => void }}
 */
export function createForgeNotes(options = {}) {
  const { el, ...props } = options

  const target = typeof el === 'string' ? document.querySelector(el) : el
  if (!target) {
    throw new Error(`[forge-notes] 挂载目标不存在: ${String(el)}`)
  }

  const app = createApp(ForgeNotes, props)
  app.mount(target)

  return {
    app,
    unmount: () => app.unmount(),
  }
}

/**
 * 注册 <forge-notes> 自定义元素（Web Component）。
 *
 * 采用 Shadow DOM 隔离样式，因此不会与宿主站点的 CSS 互相污染，
 * 这是「嵌进任何网站」场景下最稳的形态。
 *
 * @param {string} tagName 自定义元素标签名，默认 forge-notes
 * @returns {CustomElementConstructor}
 */
export function defineForgeNotesElement(tagName = 'forge-notes') {
  if (typeof customElements === 'undefined') {
    throw new Error('[forge-notes] 当前环境不支持 Custom Elements')
  }

  const existing = customElements.get(tagName)
  if (existing) return existing

  // 按 Vue 官方文档的写法：styles 属于「组件选项」，
  // 由 defineCustomElement 注入到 shadow root。
  // 注意第二参数是应用级配置（configureApp），不是用来传样式的。
  const Element = defineCustomElement({
    ...ForgeNotes,
    styles: [stylesText],
  })

  customElements.define(tagName, Element)
  return Element
}

export default ForgeNotes

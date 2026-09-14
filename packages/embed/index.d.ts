/**
 * Forge Notes 嵌入式组件包 —— 类型声明
 *
 * 包本身是纯 JS，这里只提供 TS 宿主（尤其是 Vue + TS 主站）的类型提示。
 * 放在包根目录而非 src/，是为了让 files 能直接带上它，无需额外复制步骤。
 */

import type { App, Component } from 'vue'

/** 内容数据里单篇文章的形状 */
export interface ForgeNotePost {
  slug: string
  title: string
  date: string
  tags: string[]
  excerpt: string
  url: string
  html: string
}

/** 内容数据整体形状 */
export interface ForgeNotesContent {
  count: number
  posts: ForgeNotePost[]
}

/** 组件可接收的属性 */
export interface ForgeNotesProps {
  /** 覆盖站点标题，留空则用 site.config.mjs 里的 name */
  title?: string
  /** 覆盖站点描述 */
  description?: string
  /** 每页文章数，0 表示不分页 */
  perPage?: number
  /** 是否显示搜索框 */
  searchable?: boolean
  /** 是否显示标签筛选栏 */
  showTags?: boolean
  /** 标签栏最多展示多少个标签，超出的折叠为「+N」 */
  maxTags?: number
  /**
   * 是否用 URL hash 同步文章路由。
   * 默认 false —— 避免干扰宿主站点自身的路由。
   */
  useHash?: boolean
  /** 初始直接打开的文章 slug */
  initialSlug?: string
  /** 主题：auto 跟随系统 / light / dark */
  theme?: 'auto' | 'light' | 'dark'
}

/** Vue 组件本身 */
export declare const ForgeNotes: Component<ForgeNotesProps>

/** 构建期内联的文章内容数据（只读） */
export declare const forgeNotesContent: ForgeNotesContent

/** 命令式挂载的返回句柄 */
export interface ForgeNotesHandle {
  app: App
  unmount: () => void
}

/**
 * 命令式挂载到一个 DOM 容器。
 * @param options.el 选择器字符串或 DOM 元素，其余字段作为组件 props
 * @throws 挂载目标不存在时抛错
 */
export declare function createForgeNotes(
  options: ForgeNotesProps & { el: string | Element },
): ForgeNotesHandle

/**
 * 注册 `<forge-notes>` 自定义元素（Web Component，Shadow DOM 样式隔离）。
 * @param tagName 自定义标签名，默认 'forge-notes'
 * @returns 已注册的 CustomElementConstructor；重复注册时返回已存在的那个
 * @throws 当前环境不支持 Custom Elements 时抛错
 */
export declare function defineForgeNotesElement(tagName?: string): CustomElementConstructor

export default ForgeNotes

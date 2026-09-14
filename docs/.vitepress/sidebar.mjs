/**
 * docs/.vitepress/sidebar.mjs —— 侧边栏策略
 *
 * 职责单一：决定「侧边栏出现在哪些路径下」以及「装什么内容」。
 * 文章清单本身由 scripts/lib/posts.mjs 扫描生成，新增文章无需改动本文件。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { site } from '../../site.config.mjs'
import { buildSidebarItems } from '../../scripts/lib/posts.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * @returns {Record<string, Array>|undefined} VitePress sidebar 配置，关闭时为 undefined
 */
export function createSidebar() {
  if (!site.features.sidebar) return undefined

  const items = buildSidebarItems(
    projectRoot,
    site.content.postsDir,
    site.content.overviewText,
  )

  // 键为路径前缀：/posts/ 及其下级页面均展示该侧边栏，首页与关于页不展示
  return { '/posts/': items }
}

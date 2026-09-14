/**
 * docs/posts/posts.data.js —— 文章列表页的「构建期数据加载器」
 *
 * 采用 VitePress 官方的 createContentLoader：
 *   - 构建时扫描 posts/*.md，结果序列化成 JSON 内联进产物，运行时零请求；
 *   - 自带基于文件修改时间的缓存，dev 下改文章能热更新。
 *
 * 这个文件只在 Node 端执行，所以可以自由读取项目根的 site.config.mjs。
 * 分组规则来自配置源，新增文章只要写了 tag 就会自动归组 ——
 * 不必再手工维护列表页链接。
 *
 * ⚠️ 官方明确：loader 返回的 url **不含 base**（形如 /posts/foo.html）。
 *    子路径部署时渲染必须用 withBase() 补前缀，否则链接会指向站点根。
 */

import { createContentLoader } from 'vitepress'
import { site } from '../../site.config.mjs'

/** front matter 里的 tags 可能是数组、单值或缺失，统一成数组 */
function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

/** 列表页自身不是文章，要排除 */
function isIndexPage(url) {
  return /(\/index\.html|\/index|^posts\/?)$/.test(url) || url === '/posts/'
}

/**
 * 统一日期为 'YYYY-MM-DD' 字符串。
 *
 * ⚠️ 坑：front matter 里写 `date: 2025-12-22`（无引号）时，
 * YAML 会把它解析成 **Date 对象**而不是字符串，直接调 localeCompare 会抛
 * "is not a function"。这里归一成字符串，排序与展示才都稳。
 * Date 由 YAML 按 UTC 解析，所以取 UTC 字段，避免时区把日期挪到前一天。
 */
function normalizeDate(value) {
  if (!value) return ''
  if (value instanceof Date) {
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value)
}

export default createContentLoader('posts/*.md', {
  transform(raw) {
    const posts = raw
      .filter((page) => !isIndexPage(page.url))
      .map((page) => ({
        // 不含 base，渲染时用 withBase() 补全
        url: page.url,
        title: page.frontmatter.title || page.url,
        date: normalizeDate(page.frontmatter.date),
        tags: toArray(page.frontmatter.tags),
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

    // 按配置源里的规则分组；同一篇文章只归入第一个匹配到的分组
    const groups = []
    const claimed = new Set()

    for (const rule of site.content.postGroups || []) {
      const items = posts.filter((p) => p.tags.includes(rule.tag))
      items.forEach((p) => claimed.add(p.url))
      if (items.length) groups.push({ ...rule, items })
    }

    // 没匹配上的兜底，避免新文章「加进去了但页面上看不见」
    const rest = posts.filter((p) => !claimed.has(p.url))
    if (rest.length) groups.push({ ...site.content.otherGroup, items: rest })

    return { siteName: site.name, groups, total: posts.length }
  },
})

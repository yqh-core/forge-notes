/**
 * scripts/lib/posts.mjs —— 文章扫描与解析（站点与嵌入组件共用）
 *
 * 高内聚：所有「读文章目录 / 解析 front matter / 排序」的知识都收敛在这里。
 * 低耦合：不依赖 VitePress、不依赖 Vue、不依赖任何第三方 YAML 库。
 *
 * 同时被以下两处消费：
 *   - docs/.vitepress/sidebar.mjs        （生成侧边栏）
 *   - scripts/build-embed-content.mjs    （生成嵌入组件的内容数据）
 */

import fs from 'node:fs'
import path from 'node:path'

const FRONT_MATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * 极简 front matter 解析器。
 * 只支持本项目实际用到的三种字段：字符串（title/date）与字符串数组（tags）。
 * 刻意不引入 js-yaml —— 需求太窄，引入依赖反而增加耦合面。
 */
export function parseFrontMatter(raw) {
  const match = raw.match(FRONT_MATTER_RE)
  if (!match) return { data: {}, body: raw }

  const data = {}
  const lines = match[1].split(/\r?\n/)
  let currentKey = null

  for (const line of lines) {
    // 形如 "  - 标签" 的列表项
    const listItem = line.match(/^\s*-\s+(.*)$/)
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = []
      data[currentKey].push(stripQuotes(listItem[1].trim()))
      continue
    }
    // 形如 "key: value"
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!pair) continue
    const key = pair[1]
    const value = pair[2].trim()
    if (value === '') {
      // 值在后续缩进行里（数组）
      data[key] = []
      currentKey = key
    } else {
      data[key] = stripQuotes(value)
      currentKey = key
    }
  }

  return { data, body: raw.slice(match[0].length) }
}

function stripQuotes(str) {
  if (
    (str.startsWith("'") && str.endsWith("'")) ||
    (str.startsWith('"') && str.endsWith('"'))
  ) {
    return str.slice(1, -1)
  }
  return str
}

/**
 * 从 Markdown 正文里提取第一个 H1 作为标题兜底。
 */
function firstHeading(body) {
  const m = body.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * 去掉正文开头的第一个 H1。
 *
 * 标题已经由组件/主题单独渲染，正文里再带一遍会造成
 * 「卡片摘要开头重复标题」这种观感问题。
 * 只处理**开头**的 H1（保留前置空白的容忍度），不误伤正文中间的一级标题。
 */
export function stripLeadingH1(body) {
  return body.replace(/^\s*#\s+[^\n]*\r?\n?/, '')
}

/**
 * 从 Markdown 正文里提取纯文本摘要。
 */
export function extractExcerpt(body, maxLength = 120) {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')      // 代码块
    .replace(/`[^`]*`/g, ' ')              // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
    .replace(/^#{1,6}\s+/gm, '')           // 标题标记
    .replace(/^>\s?/gm, '')                // 引用
    .replace(/[*_~]/g, '')                 // 强调符号
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trimEnd() + '…'
}

/**
 * 扫描文章目录，返回按日期倒序排列的文章元数据列表。
 *
 * @param {string} projectRoot 项目根目录绝对路径
 * @param {string} postsDir    文章目录，相对项目根（默认 docs/posts）
 * @returns {Array<{slug,title,date,tags,excerpt,url,file}>}
 */
export function loadPosts(projectRoot, postsDir = 'docs/posts') {
  const absDir = path.resolve(projectRoot, postsDir)
  if (!fs.existsSync(absDir)) return []

  const files = fs
    .readdirSync(absDir)
    .filter((f) => f.endsWith('.md'))
    // index.md 是文章列表页，不是文章本身
    .filter((f) => f !== 'index.md')
    .sort()

  const posts = files.map((file) => {
    const raw = fs.readFileSync(path.join(absDir, file), 'utf8')
    const { data, body } = parseFrontMatter(raw)
    const slug = file.replace(/\.md$/, '')
    return {
      slug,
      file,
      title: data.title || firstHeading(body) || slug,
      date: data.date || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      // 摘要基于「去掉开头 H1」的正文，否则摘要第一句就是标题本身，观感重复
      excerpt: extractExcerpt(stripLeadingH1(body)),
      url: `/posts/${slug}`,
    }
  })

  // 按日期倒序；无日期的排到最后
  posts.sort((a, b) => {
    const da = a.date || ''
    const db = b.date || ''
    if (da === db) return a.slug.localeCompare(b.slug)
    if (!da) return 1
    if (!db) return -1
    return db.localeCompare(da)
  })

  return posts
}

/**
 * 生成 VitePress 侧边栏结构：一个「文章列表」总览项 + 全部文章。
 */
export function buildSidebarItems(projectRoot, postsDir, overviewText = '文章列表') {
  const posts = loadPosts(projectRoot, postsDir)
  return [
    { text: overviewText, link: '/posts/' },
    ...posts.map((p) => ({ text: p.title, link: p.url })),
  ]
}

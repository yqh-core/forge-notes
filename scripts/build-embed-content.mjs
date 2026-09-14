/**
 * scripts/build-embed-content.mjs
 *
 * 在构建嵌入组件包之前，把 docs/posts 下的 Markdown 预渲染成 HTML，
 * 输出成一份 JSON 供 packages/embed 打包内联。
 *
 * 为什么在构建期渲染？
 *   - 运行时零 Markdown 解析开销，宿主站点只加载静态数据
 *   - 组件包不需要把 markdown-it 打进运行时产物，体积更小
 *   - 渲染规则集中在这一个文件里，方便日后替换（例如换成 shiki 高亮）
 *
 * 输出的 JSON 是被 .gitignore 忽略的中间产物，不是源码。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import { loadPosts, parseFrontMatter, stripLeadingH1 } from './lib/posts.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const postsDir = 'docs/posts'
const outFile = path.resolve(projectRoot, 'packages/embed/src/content.generated.json')

const md = new MarkdownIt({
  html: true,       // 文章里有内联 HTML 示例
  linkify: true,    // 裸链接自动转 <a>
  breaks: false,
})

/**
 * 给 h2 / h3 自动加 id，便于分享锚点链接。
 * markdown-it 默认不生成标题 id。
 */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .replace(/-+/g, '-')
}

const defaultHeadingOpen =
  md.renderer.rules.heading_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const level = Number(token.tag.slice(1))
  if (level === 2 || level === 3) {
    const inline = tokens[idx + 1]
    if (inline && inline.type === 'inline') {
      token.attrSet('id', slugify(inline.content))
    }
  }
  return defaultHeadingOpen(tokens, idx, options, env, self)
}

// ==================== 渲染 ====================
const summaries = loadPosts(projectRoot, postsDir)
const posts = summaries.map((post) => {
  const raw = fs.readFileSync(path.join(projectRoot, postsDir, post.file), 'utf8')
  const { body } = parseFrontMatter(raw)
  // 去掉正文开头的 H1 —— 标题已由组件单独渲染，避免重复
  const withoutH1 = stripLeadingH1(body)
  return {
    ...post,
    html: md.render(withoutH1),
  }
})

const payload = {
  generatedAt: new Date().toISOString(),
  source: postsDir,
  count: posts.length,
  posts,
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(payload), 'utf8')

const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1)
console.log(`[embed-content] 渲染 ${posts.length} 篇文章 -> ${path.relative(projectRoot, outFile)} (${sizeKb} KB)`)

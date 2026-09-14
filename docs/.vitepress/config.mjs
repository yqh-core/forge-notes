/**
 * docs/.vitepress/config.mjs —— VitePress 构建入口
 *
 * 本文件只做「组装」：读取 site.config.mjs 与环境变量，拼装成 VitePress 配置。
 * 禁止在此处硬编码任何站点文案（标题、描述、作者、页脚等），
 * 一切品牌信息都来自 site.config.mjs —— 这是单一配置源的强制约束。
 *
 * 环境变量：
 *   VITE_BASE           部署子路径，如 /blog/ 或 ./（默认取 site.base）
 *   VITE_SITE_URL       站点完整域名，用于 sitemap（默认取 site.url）
 *   VITE_ADSENSE_CLIENT AdSense 发布商 ID，如 ca-pub-xxx；留空则不注入广告脚本
 *   VITE_OUT_DIR        构建输出目录，相对项目根（默认 docs/.vitepress/dist）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { site } from '../../site.config.mjs'
import { createSidebar } from './sidebar.mjs'

const dirname = path.dirname(fileURLToPath(import.meta.url))
// dirname = <项目根>/docs/.vitepress —— 退回两级才是项目根。
// ⚠️ 这里写 '../..'（两级）。写成 '../../..' 会多退一级到项目根的**上级目录**，
// 后果很隐蔽：hasGit 检测永远为假、「最后更新于」被静默关闭，而且不报任何错。
const projectRoot = path.resolve(dirname, '../..')

// ==================== 构建期变量解析 ====================
const base = normalizeBase(process.env.VITE_BASE || site.base)
const siteUrl = (process.env.VITE_SITE_URL || site.url || '').replace(/\/+$/, '')
const adsenseClient = (process.env.VITE_ADSENSE_CLIENT || '').trim()
const cleanUrls = site.features.cleanUrls === true

/**
 * 构建输出目录。
 *
 * 默认交给 VitePress（docs/.vitepress/dist）。设为环境变量是为了让并行/多配置
 * 构建各写各的目录，互不干扰 —— 验证脚本要连做多次不同 base / 不同品牌名的
 * 构建，共用一个 outDir 就得反复清空，既慢又容易互相污染。
 */
const outDir = (process.env.VITE_OUT_DIR || '').trim()
  ? path.resolve(projectRoot, process.env.VITE_OUT_DIR.trim())
  : undefined

/**
 * 规范化部署 base。
 *
 * VitePress 官方规定 base 必须以 / 开头且以 / 结尾，
 * 但有一个特例：'./' 表示「可重定位构建」，产物内全部用相对路径，
 * 一份产物挂到任意子目录都能跑。
 *
 * ⚠️ 若无条件给它补前导斜杠，'./' 会被破坏成 '/./'，相对构建静默失效
 * —— 表现为部署到子目录后资源 404。所以必须先放行这个特例。
 */
function normalizeBase(value) {
  const raw = (value ?? '').trim()
  if (raw === './' || raw === '.' || raw === '') return './'
  let result = raw
  if (!result.startsWith('/')) result = '/' + result
  if (!result.endsWith('/')) result = result + '/'
  return result
}

/**
 * 给以 / 开头的站内路径补上 base 前缀。
 *
 * 适用范围**仅限 head 里的手写标签**（如 favicon）—— 那些是纯字符串，
 * VitePress 不会处理。
 *
 * 反例：themeConfig.logo 与 front matter 的 hero.image.src 都不需要手动补，
 * VitePress 会自动加 base；再补一次会得到 /blog/blog/logo.svg 这种双重前缀。
 */
function withBase(p, baseValue) {
  if (!p || typeof p !== 'string') return p
  // 外链、协议相对、data URI、已是相对路径的都不处理
  if (!p.startsWith('/') || p.startsWith('//')) return p
  if (baseValue === './') return p.slice(1)
  return baseValue.replace(/\/+$/, '') + p
}

// ==================== 环境自检 ====================
/**
 * 「最后更新于」依赖 git 提交记录。没有 .git 时 VitePress 拿不到时间，
 * 既不会报错、也不会显示 —— 静默失效最容易让人以为是配置写错了。
 * 这里主动检测并提示，同时自动关闭该功能，避免页面上出现空的更新时间。
 */
const hasGit = fs.existsSync(path.join(projectRoot, '.git'))
const lastUpdatedEnabled = site.features.lastUpdated === true

if (lastUpdatedEnabled && !hasGit) {
  console.warn(
    '\n[forge-notes] 未检测到 .git 目录，「最后更新于」功能已自动关闭。\n' +
      '              启用方式：git init && git add . && git commit -m "init"\n',
  )
}

// ==================== <head> 注入 ====================
const head = [
  ['link', { rel: 'icon', type: 'image/svg+xml', href: withBase('/favicon.svg', base) }],
  ['meta', { name: 'theme-color', content: '#e0533d' }],
]

// 仅在显式配置了发布商 ID 时才注入 AdSense。
// 这样把博客嵌进他人站点时，不会把本站的广告代码带进去。
if (adsenseClient) {
  head.push([
    'script',
    {
      async: true,
      src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`,
      crossorigin: 'anonymous',
    },
  ])
}

// ==================== 首页数据注入 ====================
/**
 * 把 site.config.mjs 里的品牌数据注入页面 front matter。
 * 这样 docs/index.md 只需维护正文内容，品牌文案不会出现第二份副本
 * —— 这是「单一配置源」在页面层的落地方式。
 */
function injectHomePageData(pageData, site, siteUrl, cleanUrls) {
  pageData.frontmatter.head ??= []

  if (pageData.relativePath === 'index.md') {
    pageData.frontmatter.hero = {
      ...site.hero,
      // ⚠️ 不要手动给 hero.image.src 补 base —— VitePress 会自动加。
      // 手动补会变成双重前缀（/blog/blog/logo.svg），图片直接 404。
      // 这一点是实测确认的：base=/blog/ 时，'/logo.svg' 会被自动处理成 '/blog/logo.svg'。
      actions: site.heroActions,
    }
    pageData.frontmatter.features = site.highlights
  }

  if (siteUrl) {
    // canonical 必须与页面真实 URL 完全一致，否则等于告诉搜索引擎「这是另一个页面」。
    // VitePress 自带的 sitemap 在 cleanUrls 关闭时生成 /about.html，
    // 所以这里也必须补上 .html —— 官方示例同此写法。
    const canonicalUrl = `${siteUrl}/${pageData.relativePath}`
      .replace(/index\.md$/, '')
      .replace(/\.md$/, cleanUrls ? '' : '.html')

    pageData.frontmatter.head.push(['link', { rel: 'canonical', href: canonicalUrl }])
  }
}

// ==================== 主题配置 ====================
const themeConfig = {
  nav: site.nav,
  logo: site.logo,
  socialLinks: site.socialLinks,
  footer: site.footer,
  outline: { label: '本页目录', level: [2, 3] },
  docFooter: { prev: '上一篇', next: '下一篇' },
  returnToTopLabel: '回到顶部',
  sidebarMenuLabel: '菜单',
  darkModeSwitchLabel: '主题',
  lightModeSwitchTitle: '切换到浅色模式',
  darkModeSwitchTitle: '切换到深色模式',
  externalLinkIcon: true,

  ...(site.features.search && { search: { provider: 'local' } }),

  ...(lastUpdatedEnabled &&
    hasGit && {
      lastUpdated: {
        text: '最后更新于',
        formatOptions: { dateStyle: 'full', timeStyle: 'medium' },
      },
    }),

  // 修复原项目问题：editLink 指向不存在的 your-repo 占位仓库，默认关闭
  ...(site.features.editLinkRepo && {
    editLink: {
      pattern: `https://github.com/${site.features.editLinkRepo}/edit/main/${site.content.postsDir}/:path`,
      text: '在 GitHub 上编辑此页',
    },
  }),
}

// 侧边栏由 posts 目录自动生成，新增文章无需手工维护
const sidebar = createSidebar()
if (sidebar) themeConfig.sidebar = sidebar

export default defineConfig({
  title: site.name,
  description: site.description,
  lang: site.lang,
  base,
  cleanUrls,
  head,
  themeConfig,

  // 只有在显式指定时才覆盖 VitePress 的默认输出目录
  ...(outDir && { outDir }),

  markdown: {
    lineNumbers: true,
    theme: 'material-theme-palenight',
  },

  transformPageData(pageData) {
    injectHomePageData(pageData, site, siteUrl, cleanUrls)
  },

  // 配置了域名才生成 sitemap，避免产出含空 hostname 的无效文件
  ...(siteUrl && { sitemap: { hostname: siteUrl } }),
})

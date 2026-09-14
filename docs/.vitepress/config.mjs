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
import { loadPosts } from '../../scripts/lib/posts.mjs'

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

// ==================== 「最后更新于」的数据源 ====================
/**
 * 建立「页面 → 时间戳」索引，数据来自文章 front matter 的 `date`。
 *
 * ⚠️ 为什么不用 VitePress 默认的 git 提交时间（实测，2026-09-14）：
 *
 *   VitePress 在构建期只跑**一次** `git log --name-only` 扫描 srcDir，建立
 *   「文件 → 最新提交时间」映射（dist/node 里的 cacheAllGitTimestamps）。
 *   Cloudflare Pages 检出的是**浅克隆**，此时唯一可见的提交（边界提交）
 *   会被 git 当成「新增了全部文件」，于是每个文件都映射到**这次部署的提交时间**。
 *
 *   同一个仓库、同一份内容，两处构建量到的差异：
 *     本地（全量历史） → 全站 2026-09-14T06:52:47Z（= 初始提交，正确）
 *     Cloudflare       → 全站 2026-09-14T07:44:33Z（= 当时的 tip 提交）
 *   而那个 tip 提交只改了 README 与两个 .mjs，**没碰过任何文章**。
 *
 *   后果不只是"不准"：每推一次代码，17 篇文章都会对外宣称"今天刚更新"，
 *   sitemap 里 20 条 lastmod 也一起变成部署时间（均为线上实测）。
 *
 * 换成文章自带的 date 之后：日期由内容决定、与检出方式无关，
 * 本地与 CI 的产物完全一致，也不再需要 git 才能算出正确的日期。
 *
 * @returns {Map<string, number>} relativePath（如 posts/welcome.md）→ 时间戳
 */
function buildPostDateIndex() {
  const index = new Map()
  for (const post of loadPosts(projectRoot, site.content.postsDir)) {
    const ts = Date.parse(post.date)
    if (!Number.isFinite(ts)) continue
    // post.url 形如 /posts/welcome（不含 base），转成相对 srcDir 的 md 路径
    index.set(`${post.url.replace(/^\//, '')}.md`, ts)
  }
  return index
}

const postDateIndex = buildPostDateIndex()

// ==================== 环境自检 ====================
/**
 * 「最后更新于」的**日期值**来自文章 front matter（见上面的 buildPostDateIndex），
 * 与 git 无关。但 VitePress 有个内部行为要留意：只要 themeConfig.lastUpdated 存在，
 * 它在 configResolved 阶段就会调用 git（cacheAllGitTimestamps）。没装 git 的环境
 * 那次调用会直接抛错、构建失败；有 git 但没有 .git 仓库时虽不报错，却拿不到任何时间戳。
 *
 * 所以这里仍然保留检测：无 .git 就直接关掉整个功能，而不是让构建在半路挂掉。
 */
const hasGit = fs.existsSync(path.join(projectRoot, '.git'))
const lastUpdatedEnabled = site.features.lastUpdated === true

if (lastUpdatedEnabled && !hasGit) {
  console.warn(
    '\n[forge-notes] 未检测到 .git 目录，「最后更新于」已自动关闭。\n' +
      '              原因是 VitePress 在启用该功能时会内部调用 git；\n' +
      '              日期数据本身来自文章 front matter，与 git 无关。\n' +
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

// ==================== 页面数据注入 ====================
/**
 * 把 site.config.mjs 里的品牌数据注入页面 front matter，并校正「最后更新于」。
 * 这样 docs/index.md 只需维护正文内容，品牌文案不会出现第二份副本
 * —— 这是「单一配置源」在页面层的落地方式。
 */
function injectPageData(pageData, site, siteUrl, cleanUrls) {
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

  /**
   * 覆盖「最后更新于」。
   *
   * 位置很关键：VitePress 会先算好 pageData.lastUpdated（走 git），
   * **然后**才调用 transformPageData 并把返回值 merge 进 pageData
   * （见 dist/node 里 createMarkdownToVueRenderFn 的实现顺序），
   * 所以在这里赋值确实能覆盖掉上游结果。
   *
   * 取不到 date 的页面（首页 / 关于 / 文章列表）显式清成 0：
   * 主题的 hasLastUpdated 是**真值判断**，0 即整块不渲染。
   * 必须显式清 —— 不清就会把上游那个（在 CI 里必然失真的）部署时间接着显示出来。
   */
  if (lastUpdatedEnabled) {
    pageData.lastUpdated = postDateIndex.get(pageData.relativePath) || 0
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
  skipToContentLabel: site.ui.skipToContent,
  notFound: site.ui.notFound,

  /**
   * 本地搜索（minisearch）。
   *
   * translations 挂在 `root` locale 下 —— 这是官方文档给「单语言站点」的做法
   * （https://vitepress.dev/reference/default-theme-search#i18n）。
   * 不这么挂，中文站点上会残留一整套英文 UI：导航栏的 Search 按钮与输入框
   * placeholder，以及弹窗里的 Reset search / No results found / to select 等。
   */
  ...(site.features.search && {
    search: {
      provider: 'local',
      options: {
        locales: { root: { translations: site.ui.search } },
      },
    },
  }),

  ...(lastUpdatedEnabled &&
    hasGit && {
      lastUpdated: {
        text: '最后更新于',
        /**
         * dateStyle 用 long：数据源是**日期粒度**（front matter 的 date），
         * 带上 timeStyle 会显示出由 YAML 的 UTC 零点换算来的假时间（08:00:00）。
         *
         * timeZone: 'UTC' 是必需的：这个字符串由**浏览器端**按访客时区格式化
         * （VPDocFooterLastUpdated 在 onMounted 里调 Intl.DateTimeFormat），
         * 不钉 UTC 的话 UTC-5 的访客会把 2025-11-30 看成 2025-11-29 —— 差一天。
         * 实测：new Date('2025-11-30T00:00:00Z') 在 America/New_York 下格式化为 11月29日。
         *
         * forceLocale: true 让日期跟随**站点语言**而非访客浏览器语言，
         * 否则英文浏览器的访客会在中文页面上看到 "November 30, 2025"。
         */
        formatOptions: { dateStyle: 'long', timeZone: 'UTC', forceLocale: true },
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

  /**
   * markdown 渲染期的本地化 —— 走官方入口，不做构建后字符串替换。
   *
   * 这两条在**渲染期**生效，所以静态 HTML 与页面 chunk JS（SPA 跳转时注入的
   * 那份 HTML）会同时正确，天然没有 hydration 覆盖问题。
   */
  markdown: {
    lineNumbers: true,
    theme: 'material-theme-palenight',

    // 代码块的复制按钮。悬停提示由渲染器写死为 "Copy Code"，
    // 没有 themeConfig 键，但渲染器直接读 `markdown.codeCopyButtonTitle`。
    codeCopyButtonTitle: site.ui.markdown.codeCopyButtonTitle,

    /**
     * 标题锚点的 aria-label。
     *
     * VitePress 自己的 anchor 插件把 `Permalink to “标题”` 写死在渲染函数里
     * （createMarkdownRenderer 内联定义，没有任何配置键可改）。只能接管
     * `link_open` 渲染规则，把 token 上的 aria-label 属性换掉。
     *
     * ⚠️ 必须挂在 `config` 而**不是** `preConfig` —— 这里踩过一次，记下来：
     *   createMarkdownRenderer() 的调用顺序是
     *     await options.preConfig(md)   // 最早
     *     … 注册 componentPlugin / linkPlugin / anchorPlugin / … // 中间
     *     await options.config(md)      // 最后，紧挨 return md
     *   而 `md.renderer.rules.link_open` 在整条链上**只有一处赋值**：
     *     linkPlugin 里的 `md.renderer.rules.link_open = (…) => {…}`
     *   —— 是**直接赋值**，不是与前一版链式组合。所以写在 preConfig 里
     *   会被 linkPlugin 原样覆盖，**静默失效**（构建照样成功、产物里
     *   `Permalink to` 一个不少）。实测：preConfig 492 处残留，
     *   config 0 处。
     *
     * 因为 linkPlugin 的规则要处理站内/站外链接的 target/rel，不能丢弃，
     * 这里用 `prev = md.renderer.rules.link_open` 链式包一层，只改
     * `header-anchor` 那一个 token，其余原样交给 prev。
     */
    config(md) {
      const template = site.ui.markdown.permalinkLabel
      const fallback = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options)
      const prev = md.renderer.rules.link_open || fallback
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        if (token.attrGet('class') === 'header-anchor') {
          const label = token.attrGet('aria-label')
          // 原文形态固定为 `Permalink to “<title>”`，取引号之间的标题
          const m = label && /^Permalink to \u201C([\s\S]*)\u201D$/.exec(label)
          if (m) token.attrSet('aria-label', template.replace('{title}', m[1]))
        }
        return prev(tokens, idx, options, env, self)
      }
    },
  },

  transformPageData(pageData) {
    injectPageData(pageData, site, siteUrl, cleanUrls)
  },

  /**
   * 配置了域名才生成 sitemap，避免产出含空 hostname 的无效文件。
   *
   * transformItems 用来覆盖 VitePress 用 git 算出来的 lastmod —— 同一个浅克隆问题：
   * 线上实测 20 条 lastmod 全都是当次部署的提交时间。这里改成文章自己的 date；
   * 没有 date 的页面（首页 / 关于 / 文章列表）直接把 lastmod 字段删掉：
   * 与其给搜索引擎一个编造的「今天更新过」，不如不给。
   */
  ...(siteUrl && {
    sitemap: {
      hostname: siteUrl,
      transformItems(items) {
        return items.map((item) => {
          const key = `${String(item.url).replace(/^\//, '').replace(/\/$/, '')}.md`
          const ts = postDateIndex.get(key)
          if (!ts) {
            const { lastmod, ...rest } = item
            return rest
          }
          return { ...item, lastmod: ts }
        })
      },
    },
  }),

  /**
   * 构建收尾时补一个 robots.txt。
   *
   * 为什么不放在 docs/public/robots.txt：那是静态文件，域名得在仓库里再手写一遍，
   * 一旦换域名或改用 VITE_SITE_URL 覆盖，两处就会不一致 —— 而「域名只写一处」
   * 正是这个项目的核心约束。buildEnd 里从 siteUrl 派生，天然不会漂。
   *
   * 顺带说明：Cloudflare 对没有 robots.txt 的站点会自动注入一份（带 content signals
   * 条款的）托管版本。我们主动提供自己的，一是为了声明 Sitemap，二是把
   * 「允许哪些爬虫」这个决定权拿回自己手里，而不是默认接受别人的策略。
   */
  async buildEnd(siteConfig) {
    const lines = [
      '# robots.txt 由 docs/.vitepress/config.mjs 依据 site.config.mjs 的 url 生成',
      '# 想自定义策略请改这里，不要新建 docs/public/robots.txt（会造成域名两处维护）',
      'User-agent: *',
      'Allow: /',
    ]
    if (siteUrl) lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`)
    await fs.promises.writeFile(
      path.join(siteConfig.outDir, 'robots.txt'),
      lines.join('\n') + '\n',
      'utf8',
    )
  },
})

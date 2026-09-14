/**
 * site.config.mjs —— 全站唯一配置源 (Single Source of Truth)
 *
 * 设计原则：
 *  1. 本文件只包含「纯静态数据」，不含 process.env / node:fs 等环境相关逻辑，
 *     因此可以被浏览器端产物（packages/embed）安全导入，保证站点与嵌入组件品牌统一。
 *  2. 构建期相关的变量（部署 base、AdSense ID）由各构建入口读取环境变量后覆盖，
 *     见 docs/.vitepress/config.mjs 与 packages/embed/vite.config.js。
 *  3. 改造品牌只需改本文件，无需触碰任何页面或文章。
 *
 * 改名清单：name / nameZh / description / tagline / author / footer / nav / ui
 */

/** 站点英文名常量，供对象内部自引用，避免同一品牌名在多处重复书写 */
const SITE_NAME = 'Forge Notes'

export const site = {
  // ==================== 品牌标识 ====================
  /** 站点英文名，用于 <title>、页脚、组件标题 */
  name: SITE_NAME,
  /** 站点中文名，用于首页 hero 主标题 */
  nameZh: '锻造笔记',
  /** SEO 描述，也会用于首页 hero 副标题 */
  description: '分享跨境电商技术、Google SEO、AdSense 集成与工程实战经验',
  /** 首页 hero 的标语 */
  tagline: '把毛坯敲成能用的东西 —— 记录技术、架构与踩坑',
  /** HTML lang 属性 */
  lang: 'zh-CN',

  // ==================== 部署 ====================
  /**
   * 站点部署路径。默认 '/'。
   * 作为子功能挂到主站子目录时，用环境变量覆盖，例如：
   *   VITE_BASE=/blog/ npm run build
   */
  base: '/',

  /**
   * 站点完整域名，用于 sitemap 与 canonical 链接。
   * 通过环境变量覆盖：VITE_SITE_URL=https://your-domain.com
   *
   * 留空则**不生成** sitemap 与 canonical（避免产出 hostname 为空的无效文件）。
   * 当前值取自 Cloudflare Pages 的项目子域名 —— 实测该域名未被他人占用，
   * 所以没有随机后缀（Pages 的子域名冲突时会加后缀，届时改这里即可）。
   */
  url: 'https://forge-notes.pages.dev',

  // ==================== 作者信息 ====================
  author: {
    name: 'yqh',
    /** 显示在关于页与页脚的 GitHub 用户名 */
    github: 'yqh-core',
    email: '',
  },

  // ==================== 站点图标 ====================
  /**
   * 导航栏图标（VitePress 默认主题的 themeConfig.logo）。
   * 路径以 / 开头，构建时会自动补上 base 前缀 —— 子路径部署不会 404。
   */
  logo: '/logo.svg',

  // ==================== 首页 ====================
  /**
   * 首页 hero 区。由 docs/.vitepress/config.mjs 注入到 docs/index.md，
   * 因此 index.md 里不需要、也不应该重复维护这些文案。
   */
  hero: {
    name: SITE_NAME,
    text: '技术驱动业务增长',
    tagline: '分享跨境电商技术、Google SEO、AdSense 集成与工程实战经验',
    image: { src: '/logo.svg', alt: SITE_NAME + ' logo' },
  },

  /** 首页特性卡片 */
  highlights: [
    { icon: '🛒', title: '跨境电商技术', details: '从技术架构到支付集成，全栈实战经验分享' },
    { icon: '🔍', title: 'Google SEO 优化', details: '深度解析 SEO 策略，提升网站自然流量和排名' },
    { icon: '💰', title: 'AdSense 变现', details: '广告集成与收益优化，最大化网站商业价值' },
    { icon: '⚡', title: '性能优化', details: '前端性能优化技巧，提升用户体验和转化率' },
  ],

  // ==================== 导航与侧边栏 ====================
  nav: [
    { text: '首页', link: '/' },
    { text: '博客', link: '/posts/' },
    { text: '关于', link: '/about' },
  ],

  /** 首页 hero 按钮 */
  heroActions: [
    { theme: 'brand', text: '开始阅读', link: '/posts/' },
    { theme: 'alt', text: '关于', link: '/about' },
  ],

  // ==================== 社交链接 ====================
  /** 留空数组即隐藏社交图标区 */
  socialLinks: [
    { icon: 'github', link: 'https://github.com/yqh-core' },
  ],

  // ==================== 页脚 ====================
  // 注意：必须用 SITE_NAME 常量拼接，不能写字面量。
  // 否则改名时页脚不会跟随，「单一配置源」就在这一处失效了。
  footer: {
    message: '基于 VitePress 构建',
    copyright: `Copyright © ${new Date().getFullYear()} ${SITE_NAME}`,
  },

  // ==================== 内置 UI 文案本地化 ====================
  /**
   * VitePress 默认主题自带的英文 UI 文案。
   *
   * 站点是中文的，这些文案如果不换掉，访客会看到一半中文一半英文
   * （搜索按钮、搜索弹窗、404 页、键盘「跳到正文」链接等）。
   *
   * ⚠️ 两种机制，别混：
   *   - `search` / `notFound` / `skipToContent`：走 themeConfig 的官方开关，
   *     由 docs/.vitepress/config.mjs 透传给 VitePress；
   *   - `hardcodedAria`：主题里**写死的**字面量，`2.0.0-alpha.15` 没有任何
   *     配置键能改它（实测 grep 确认）。只能用 scripts/localize-theme-aria.mjs
   *     在构建完成后对产出的 HTML **与 theme JS** 做精确替换 —— 那个脚本
   *     同样以本文件为数据源。
   *
   * ⚠️ 改这里的文案之前先读 README 踩坑 17：只改 HTML 不改 JS 会被 hydration
   * 覆盖回英文；而给 JS 侧手写引号又会把字符串退化成裸标识符。
   */
  ui: {
    /** 键盘用户按 Tab 时第一个聚焦到的「跳到正文」链接 */
    skipToContent: '跳到正文',

    /**
     * 主题里写死、无配置键可改的 aria 文案。
     *
     * 这三条是 `visually-hidden` 的，普通访客看不见，但读屏用户会听到 ——
     * 不换的话，中文站点会读出 "Main Navigation" / "toggle section"。
     * 键名对应 scripts/localize-theme-aria.mjs 里的替换表；值写**裸文案**，
     * 引号由脚本按 HTML / JS 两种上下文各自补。
     */
    hardcodedAria: {
      /** VPNavBarMenu.vue：<nav aria-labelledby> 指向的隐藏标题 */
      mainNav: '主导航',
      /** VPSidebar.vue：侧边栏 <nav> 的隐藏标题 */
      sidebarNav: '侧边栏导航',
      /** VPDocFooter.vue：上一篇/下一篇 <nav aria-labelledby> 指向的隐藏标题（原文 "Pager"） */
      docFooter: '翻页导航',
      /** VPSidebarItem.vue：可折叠分组的 caret 按钮 aria-label */
      toggleSection: '展开或收起分组',
    },

    /**
     * 文章页「最后更新于」后面那个分隔符。
     *
     * 主题模板里写死的是半角 `": "`（`VPDocFooterLastUpdated.vue` 的
     * `{{ text }}:` 换行 `<time>`，Vue 把换行压成一个空格）。
     * 半角冒号在中文排版里不算错，但既然整行都是中文，用全角「：」更整齐 ——
     * 同样没有配置键可改，由 scripts/localize-theme-aria.mjs 在构建后替换。
     */
    lastUpdatedSeparator: '：',

    /**
     * 本地搜索（minisearch）的按钮与弹窗文案。
     *
     * ⚠️ 结构是**两层**的，不能拍平：VitePress 用 `createSearchTranslate` 按
     * `button.buttonText` / `modal.footer.selectText` 这样的路径逐层下钻，
     * 结构不对它不会报错，只是**静默回落到英文默认值**。
     * 这个形状抄自官方示例：
     * https://vitepress.dev/reference/default-theme-search#i18n
     *
     * 键名则是逐一对照 alpha.15 的 VPLocalSearchBox.vue 源码取的 ——
     * 下面这些是它真正读的键，多写无用，少写或写错会回落成英文。
     * 另外注意 buttonText 同时用作按钮文字与输入框 placeholder（VitePress 的行为），
     * 所以要短。
     */
    search: {
      button: {
        buttonText: '搜索',
        buttonAriaLabel: '搜索',
      },
      modal: {
        displayDetails: '显示详细列表',
        resetButtonTitle: '重置搜索',
        backButtonTitle: '关闭搜索',
        noResultsText: '没有结果',
        footer: {
          selectText: '选择',
          selectKeyAriaLabel: '回车',
          navigateText: '切换',
          navigateUpKeyAriaLabel: '上箭头',
          navigateDownKeyAriaLabel: '下箭头',
          closeText: '关闭',
          closeKeyAriaLabel: 'Esc',
        },
      },
    },

    /**
     * 404 页文案。
     *
     * VitePress 会在**没有** docs/404.md 时自动生成 404.html（Cloudflare Pages
     * 只在产物根目录存在 404.html 时才返真 404，否则按 SPA 兜底把未知路径
     * 全给 index.html 并返回 200 —— 那是软 404，SEO 上更糟）。
     * 所以这里**不建** 404.md，只用官方给的主题开关换掉文案，
     * 既保留自动生成的行为，又不会在仓库里多一个需要同步维护的页面。
     */
    notFound: {
      code: '404',
      title: '页面不存在',
      quote: '这个地址下没有内容。可能是链接过期了，也可能文章换了位置 —— 回首页或从博客列表找找。',
      linkLabel: '回到首页',
      linkText: '回到首页',
    },
  },

  // ==================== 功能开关 ====================
  features: {
    /** 本地全文搜索 */
    search: true,
    /**
     * 每页「最后更新于」。
     *
     * ⚠️ 日期取值是文章 front matter 的 `date`，**不是 git 提交时间** ——
     * 见 docs/.vitepress/config.mjs 的 buildPostDateIndex()。
     * 用 git 时间戳时，Cloudflare Pages 的浅克隆会让全站日期都变成「这次部署的时间」
     * （实测：线上 sitemap 20 条 lastmod 完全相同），详见 README 踩坑 15。
     *
     * 这个开关仍然依赖 .git 的存在：VitePress 只要看到 themeConfig.lastUpdated
     * 就会在内部调用 git，没有 .git 时会直接构建失败，所以本文件会在无 git 时整体关掉它。
     */
    lastUpdated: true,
    /** 文章侧边栏 */
    sidebar: true,
    /**
     * 是否生成不带 .html 后缀的干净链接。
     *
     * ⚠️ 本站部署在 Cloudflare Pages，必须为 true。实测（2026-09-14）：
     *     GET /about.html        -> 308 Permanent Redirect, Location: /about
     *     GET /posts/welcome.html-> 308 Permanent Redirect, Location: /posts/welcome
     *     GET /about             -> 200
     *     GET /posts/welcome     -> 200
     *   Pages 会把 *.html 统一 308 到去后缀的地址。若这里保持 false，
     *   VitePress 产出的**每一个**站内链接、canonical、sitemap 条目都指向一个会跳转的
     *   地址 —— 每次点击多一次往返，搜索引擎拿到的是「canonical 指向重定向」这种
     *   自相矛盾的信号。开启后三者与 Pages 实际返回 200 的地址完全一致。
     *
     * 开启的代价：服务端要能把 /about 映射到 about.html。
     *   - Cloudflare Pages / Netlify / Vercel：原生支持，无需配置
     *   - Nginx：try_files $uri $uri/ $uri.html（README 里有完整片段）
     */
    cleanUrls: true,
    /**
     * 「在 GitHub 上编辑此页」。
     * 留空字符串即关闭该功能（避免出现 your-repo 这类无效占位链接）。
     */
    editLinkRepo: '',
  },

  // ==================== 内容源 ====================
  content: {
    /** 文章目录，相对项目根。embed 组件与站点共用 */
    postsDir: 'docs/posts',
    /** 文章列表分组标题（用于自动侧边栏顶部） */
    overviewText: '文章列表',

    /**
     * 文章列表页的自动分组规则。
     *
     * 按文章 front matter 的 tags 匹配，数组顺序即页面展示顺序。
     * 新增文章只要写了 tag 就会自动落到对应分组，不需要再手工改列表页
     * —— 这是原模板「加文章要改两处」这个毛病的根治办法。
     *
     * 匹配不上的文章会进入 otherGroup，不会丢。
     */
    postGroups: [
      {
        tag: '跨境电商',
        label: '跨境电商技术',
        icon: '🛒',
        desc: '深入探讨跨境电商平台的技术架构、支付集成和系统设计。',
      },
      {
        tag: 'SEO',
        label: 'Google SEO 优化',
        icon: '🔍',
        desc: '深度解析 SEO 策略，提升网站自然流量和排名。',
      },
      {
        tag: 'AdSense',
        label: 'AdSense 变现',
        icon: '💰',
        desc: '广告集成与收益优化，最大化网站商业价值。',
      },
      {
        tag: '前端性能',
        label: '前端技术',
        icon: '⚡',
        desc: '现代前端开发技术和性能优化最佳实践。',
      },
    ],

    /** 未匹配到任何分组时的兜底分组 */
    otherGroup: {
      label: '其他',
      icon: '📚',
      desc: '未归类到上述主题的文章。',
    },
  },
}

export default site

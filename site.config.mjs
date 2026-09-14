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
 * 改名清单：name / nameZh / description / author / footer / nav
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
   */
  url: '',

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

  // ==================== 功能开关 ====================
  features: {
    /** 本地全文搜索 */
    search: true,
    /** 每页「最后更新于」 */
    lastUpdated: true,
    /** 文章侧边栏 */
    sidebar: true,
    /**
     * 是否生成不带 .html 后缀的干净链接。
     * 开启需服务端配合（Nginx: try_files $uri $uri/ $uri.html）。
     * 关闭时页面 URL 形如 /about.html，canonical 与 sitemap 均按此生成。
     */
    cleanUrls: false,
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

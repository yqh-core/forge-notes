# Forge Notes

基于 [VitePress](https://vitepress.dev/) 的技术博客系统。设计目标是**既能独立部署，也能作为子功能嵌入其他站点**。

## 两个产物，一套内容

| 产物 | 位置 | 形态 | 用途 |
|---|---|---|---|
| **L1 独立站点** | `docs/` | VitePress 静态站点 | 独立部署，功能完整：本地搜索、深色模式、代码高亮、侧边栏 |
| **L2 嵌入组件** | `packages/embed/` | Vue 组件 + Web Component | 把博客挂进别的网站作为子功能 |

两者**共用同一份内容**（`docs/posts/*.md`）和**同一份品牌配置**（`site.config.mjs`），
不存在「站点改名了、嵌入版还是旧名」的不一致。

## 环境要求

- Node.js >= 18.0.0
- npm >= 8.0.0

## 快速开始

```bash
# 安装依赖（含 workspace 内的 embed 包）
npm install

# 启动独立站点开发服务器
npm run dev

# 构建两个产物
npm run build
```

构建产出：

- `docs/.vitepress/dist/` —— 独立站点
- `packages/embed/dist/` —— 嵌入组件包

## 项目结构

```
forge-notes/
├── site.config.mjs             ★ 唯一配置源（品牌、导航、作者、功能开关）
├── package.json                workspace 根
├── scripts/
│   ├── lib/posts.mjs           文章扫描与 front matter 解析（站点与组件共用）
│   └── build-embed-content.mjs 构建期把 Markdown 预渲染为 HTML
├── docs/                       【L1】VitePress 独立站点
│   ├── .vitepress/
│   │   ├── config.mjs          组装 VitePress 配置（不含任何硬编码文案）
│   │   └── sidebar.mjs         侧边栏策略
│   ├── posts/                  文章（Markdown）
│   │   ├── posts.data.js       列表页的构建期数据加载器（自动分组）
│   │   └── index.md            列表页（正文手写，列表自动生成）
│   ├── index.md                首页正文（hero 由配置注入）
│   ├── about.md                关于页
│   └── public/                 logo.svg / favicon.svg
└── packages/embed/             【L2】可嵌入组件包
    ├── vite.config.js          库模式构建配置
    ├── index.d.ts              TypeScript 类型声明
    └── src/
        ├── index.js            公开入口（三种用法）
        ├── ForgeNotes.vue      主组件（列表 + 详情）
        └── styles.css          全部样式（.fn- 前缀，可被宿主覆盖）
```

## 配置

**所有品牌信息集中在根目录 `site.config.mjs`，改站名只需改这一个文件。**

```js
export const site = {
  name: 'Forge Notes',        // <title>、页脚、嵌入组件标题
  nameZh: '锻造笔记',          // 首页主标题
  description: '...',         // SEO 描述 + 首页副标题
  tagline: '...',             // 首页标语（供扩展使用）
  lang: 'zh-CN',              // <html lang>
  base: '/',                  // 部署路径（推荐用 VITE_BASE 覆盖，不改这里）
  url: 'https://forge-notes.pages.dev',  // 站点域名（留空则不生成 sitemap 与 canonical）
  author: { name: 'yqh', github: 'yqh-core', email: '' },
  logo: '/logo.svg',          // 导航栏图标（base 前缀由 VitePress 自动补，勿手动加）
  nav: [...],                 // 导航栏
  socialLinks: [...],         // 社交链接（留空即隐藏）
  hero: {...},                // 首页 hero（注入到 index.md，勿在 md 里重复写）
  heroActions: [...],         // hero 按钮
  highlights: [...],          // 首页特性卡片
  footer: {...},              // 页脚（copyright 用 SITE_NAME 常量拼接，保证改名跟随）
  ui: {                       // 内置英文 UI 的本地化（搜索、404、跳到正文）
    skipToContent: '跳到正文',
    search: {...},            // 搜索按钮 + 弹窗文案；键名逐一对照 VitePress 源码，见踩坑 16
    notFound: {...},          // 404 页文案（VitePress 自动生成 404.html，不需自建文件）
  },
  features: {                 // 功能开关
    search: true,
    lastUpdated: true,        // 日期取文章 front matter 的 date，不是 git；无 .git 时整体关闭（见踩坑 15）
    sidebar: true,
    cleanUrls: true,          // 生成不带 .html 的干净链接（Cloudflare Pages 必须开，原因见踩坑 12）
    editLinkRepo: '',         // 留空即关闭「编辑此页」，避免 your-repo 死链
  },
  content: {                  // 内容源 + 列表页自动分组规则
    postsDir: 'docs/posts',
    overviewText: '文章列表',
    postGroups: [             // 按 front matter 的 tags 匹配，数组顺序即展示顺序
      { tag: 'SEO', label: 'Google SEO 优化', icon: '🔍', desc: '...' },
    ],
    otherGroup: { label: '其他', icon: '📚', desc: '...' },  // 未匹配文章的兜底，保证不丢
  },
}
```

改完 `site.config.mjs`，**站点和嵌入组件同时生效**（嵌入组件需重新 `npm run build:embed`）。

### 环境变量

构建时可用环境变量覆盖，无需改代码：

| 变量 | 作用 | 示例 |
|---|---|---|
| `VITE_BASE` | 部署子路径；传 `./` 生成可重定位产物 | `VITE_BASE=/blog/ npm run build:site` |
| `VITE_SITE_URL` | 站点域名，用于 sitemap 与 canonical | `VITE_SITE_URL=https://example.com npm run build:site` |
| `VITE_ADSENSE_CLIENT` | AdSense 发布商 ID | `VITE_ADSENSE_CLIENT=ca-pub-1234... npm run build:site` |
| `VITE_OUT_DIR` | 构建输出目录（相对项目根，默认 `docs/.vitepress/dist`） | `VITE_OUT_DIR=build/site npm run build:site` |

> **AdSense 默认不注入。** 只有显式传入 `VITE_ADSENSE_CLIENT` 才会往 `<head>` 里插广告脚本。
> 这样把博客嵌进别人站点时，不会把本站的广告代码带过去。
>
> **`VITE_OUT_DIR` 的用处**：让多次构建各写各的目录、互不覆盖。
> 配合 `VITE_BASE` / `VITE_SITE_URL` 可以一次跑出多套产物（例如同时产出 `base=/` 与 `base=/blog/` 两版），
> 验证脚本就是靠它做到「6 次不同配置的构建彼此不干扰」。

### 「最后更新于」取哪个日期

取**文章 front matter 的 `date`**，不是 git 提交时间：

- 有 `date` 的文章页显示「最后更新于 <日期>」，只到天，不显示时分秒；
- 没有 `date` 的页面（首页 / 关于 / 文章列表）**不显示这一行** —— 宁可不显示，也不编造一个日期；
- `sitemap.xml` 里每条 `lastmod` 同样取自对应文章的 `date`，无 `date` 的条目直接省略 `lastmod`。

这么改的原因见踩坑 15：用 git 时间戳时，Cloudflare 的浅克隆会让**全站**日期都变成「这次部署的时间」。

### 新增文章

在 `docs/posts/` 下新建 `.md` 文件即可，**侧边栏会自动生成**，不需要改任何配置文件：

```markdown
---
title: 文章标题
date: 2026-09-14
tags:
  - 标签A
  - 标签B
---

正文……
```

文章列表页 `docs/posts/index.md` **已自动化**：由数据加载器 `posts.data.js` 扫描目录、
按 `tags` 自动分组（分组规则写在 `site.config.mjs` 的 `content.postGroups`），
所以列表页本身也不需要手工维护链接。

唯一保留人工维护的是 `docs/index.md` 里的「🔥 热门文章」精选列表 —— 那是**刻意的人工挑选**，
不随目录变化，属于编辑决策而非技术债。若想让它也自动生成，改成同样的数据加载器写法即可。

## 作为子功能集成到其他站点

### 方式一：子路径部署（改动最小）

构建产物直接挂到主站子目录，Nginx / Cloudflare 加一条规则即可。

```bash
VITE_BASE=/blog/ npm run build:site
# 把 docs/.vitepress/dist/ 的内容放到主站的 /blog/ 目录
```

```nginx
location /blog/ {
    alias /var/www/main-site/blog/;
    try_files $uri $uri/ $uri.html /blog/index.html;
}
```

**优点**：SEO 无损、功能完整、主站零侵入。
**缺点**：与主站是两个独立页面，跳转时整页刷新。

#### ⚠️ 「可重定位构建」（`base: './'`）不适用于本项目

VitePress 官方支持 `base: './'` 的 relocatable build，宣称「同一份产物在任意子路径都能用」。
**实测表明该说法对本站不成立** —— 用真实 Chrome 打开挂到子路径后的深层页面验证过
（脚本：`tools/verify/verify-deploy-modes.mjs`）：

```bash
VITE_BASE=./ npm run build:site     # ❌ 本站不要用这个
```

产物中**所有**页面（含 `posts/` 子目录下的）资源引用都写成 `./assets/...`，
VitePress **没有**按目录深度补 `../`。后果：

| 页面在产物中的位置 | 挂到子路径后的真实表现 |
|---|---|
| 站点根 `index.html` | 资源路径侥幸正确 |
| 子目录 `posts/welcome.html` | `./assets/` 被解析成 `/posts/assets/` → **CSS / JS / 字体共 9 个请求全 404**，页面无样式、无交互 |

本站有 `posts/` 子目录，因此**必须用固定子路径 `VITE_BASE=/blog/`**。

> 这条限制已固化为 `verify-deploy-modes.mjs` 里的断言（「形态 B 深层页面资源确实 404」）。
> 将来 VitePress 若修复了它，该断言会失败，提醒我们回来更新这一节。

### 方式二：Web Component（任意站点）

适合主站不是 Vue 的情况（React、原生、WordPress、静态 HTML 都可以）。

```bash
npm run build:embed
# 产物：packages/embed/dist/forge-notes.js（自包含，已内联 Vue）
```

```html
<!-- 引入样式（可选，也能由 JS 自动注入） -->
<link rel="stylesheet" href="/assets/forge-notes/forge-notes.css" />

<script type="module">
  import { defineForgeNotesElement } from '/assets/forge-notes/forge-notes.js'
  defineForgeNotesElement()   // 注册 <forge-notes>
</script>

<!-- 放到主站任意位置 -->
<forge-notes theme="auto"></forge-notes>
```

内部使用 **Shadow DOM**，样式与宿主站点完全隔离，不会互相污染。

### 方式三：Vue 组件（主站是 Vue 3）

```bash
npm install ./packages/embed     # 或本地 link
```

```vue
<script setup>
import { ForgeNotes } from '@forge-notes/embed'
import '@forge-notes/embed/style.css'
</script>

<template>
  <ForgeNotes :per-page="6" theme="auto" />
</template>
```

### Good to know

- **默认不碰 URL。** 组件内部用状态管理视图，不写 `location.hash`，不会干扰宿主站点的路由。
  需要分享链接时才传 `:use-hash="true"`。
- **主题自动跟随系统。** 用 `theme="light"` 或 `theme="dark"` 可强制指定。
- **换肤**：覆盖 CSS 变量即可，不必改组件源码。

```css
forge-notes {
  --fn-accent: #2563eb;
  --fn-radius: 8px;
}
```

### 组件属性

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | String | 配置源 `name` | 列表标题 |
| `description` | String | 配置源 `description` | 列表副标题 |
| `per-page` | Number | `8` | 每页文章数，`0` 表示不分页 |
| `searchable` | Boolean | `true` | 是否显示搜索框 |
| `show-tags` | Boolean | `true` | 是否显示标签筛选栏 |
| `max-tags` | Number | `12` | 标签栏最多显示几个标签（按频次排序取前 N），`0` 表示全部铺开 |
| `use-hash` | Boolean | `false` | 是否用 URL hash 同步文章路由 |
| `initial-slug` | String | `''` | 直接打开指定文章 |
| `theme` | String | `'auto'` | `auto` / `light` / `dark` |

#### Boolean 属性怎么写（Web Component 场景必读）

当 `<forge-notes>` 作为原生自定义元素使用时，Boolean 属性按 **HTML 惯例**写：

```html
<forge-notes show-tags="false">   <!-- 关掉标签栏 -->
<forge-notes show-tags>           <!-- 打开标签栏（空 attribute = true） -->
```

`"false"` / `"0"` / `"no"` / `"off"`（忽略大小写与首尾空格）都算 **false**；
空 attribute 按 HTML 惯例算 **true**。命令式挂载时直接传真正的布尔值即可。

> 为什么专门说明：Vue 的 `defineCustomElement` **只对 Number 型** props 做「属性字符串 → 值」的
> 转换（源码见 `@vue/runtime-dom` 的 `_numberProps`），Boolean 型拿到的是**原始字符串**。
> 不处理的话 `="false"` 会被当成真值、标签栏反而显示出来，而空 attribute 又会被当成假值
> ——两种写法都跟直觉相反。组件在内部做了一次归一化（`ForgeNotes.vue` 的 `normalizeBool`），
> 所以上面两种写法都符合预期。`verify.js` 里有对应断言钉住这个行为。

命令式挂载：

```js
import { createForgeNotes } from '@forge-notes/embed'

const instance = createForgeNotes({ el: '#blog', perPage: 10 })
// 需要时销毁：instance.unmount()
```

## 部署

### Nginx

```bash
VITE_SITE_URL=https://your-domain.com npm run build:site
```

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/forge-notes;
    index index.html;

    location / {
        try_files $uri $uri/ $uri.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml application/xml+rss text/javascript image/svg+xml;

    # 带 hash 的静态资源可长缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Cloudflare Pages / Netlify / Vercel

| 配置项 | 值 |
|---|---|
| 构建命令 | `npm run build:site` |
| 输出目录 | `docs/.vitepress/dist` |
| Node 版本 | 由仓库根的 `.nvmrc` 指定（`22.22.2`），平台会自动读取 |

Cloudflare Pages 的实际配置（Git 集成，push 即部署）：

| 字段 | 值 |
|---|---|
| 入口 | `Create application` → **Pages** 标签 → `Connect to Git` |
| Framework preset | `None` |
| Build command | `npm run build:site` |
| Build output directory | `docs/.vitepress/dist` |
| Root directory | 留空 |
| 环境变量 | 不需要（域名写在 `site.config.mjs` 的 `url`） |

三条不能踩的：

- **入口必须是 Pages，不是 Workers。** Workers 流程没有「Build output directory」字段，
  域名会变成 `*.workers.dev`，而且仓库里没有 wrangler 配置文件时它不会部署，
  只会给仓库开一个 PR。
- **不要加 `wrangler.toml`。** 文件里一旦出现 `pages_build_output_dir`，
  它就成为配置的唯一来源，仪表盘上的构建命令字段会变成只读。
- **不要再挂一条 GitHub Actions 做部署。** 两条链路写同一个生产环境会互相覆盖，
  两边日志都是绿的，线上到底是谁的产物就说不清了。

在推上线之前，本地可以先跑一遍等价复现（含干净克隆 + 与 CI 相同的安装与构建命令）：

```bash
bash tools/verify/cleanroom.sh ci https://forge-notes.pages.dev
```

## 已知取舍与限制

嵌入组件（L2）为了做到「自包含、零依赖、单文件」，有意做了以下简化。这是取舍，不是缺陷：

| 项 | 独立站点 | 嵌入组件 | 原因 |
|---|---|---|---|
| 语法高亮 | ✅ Shiki | ❌ 等宽 + 深色底 | 避免把 Shiki 及其语言包打进 200KB+ 的运行时产物 |
| 本地全文搜索 | ✅ | 仅标题/摘要/标签过滤 | 全文索引体积过大，不适合嵌入场景 |
| 深色模式 | ✅ 手动切换 | ✅ 跟随系统 / 属性指定 | 嵌入场景下由宿主决定更合理 |
| 文章内相对路径图片 | ✅ | ⚠️ 需自行处理 | 嵌入到子路径时图片路径会指向宿主站点 |

**需要完整功能就用 L1 独立站点；需要嵌进别人网站就用 L2 组件；两者可以同时部署。**

## 无障碍与本地化

站点是中文的，所以内置的英文 UI 文案都已本地化（文案集中在 `site.config.mjs` 的 `ui` 块）。

| 位置 | 处理方式 |
|---|---|
| 导航栏搜索按钮 / 输入框 placeholder / 搜索弹窗全套 | `search.options.locales.root.translations` |
| 404 页（标题、说明、回首页链接） | `themeConfig.notFound` |
| 键盘「跳到正文」链接 | `themeConfig.skipToContentLabel` |
| 上一篇 / 下一篇、本页目录、回到顶部、主题切换、侧栏菜单 | `docFooter` / `outline.label` / `returnToTopLabel` / `darkModeSwitch*` / `sidebarMenuLabel` |
| 正文日期 | 锁定 UTC + 跟随站点语言（否则 UTC-5 的访客会看到前一天） |
| **主题里写死的** `Main Navigation` / `Sidebar Navigation` / `toggle section` | `scripts/localize-theme-aria.mjs`（构建后替换 HTML **和** theme JS，见踩坑 17） |

> 最后一行没有官方开关可用 —— `2.0.0-alpha.15` 的主题产物里根本没有读取
> `navMenuLabel` / `mobileMenuLabel` / `extraMenuLabel` 这几个官方文档提到的键（实测 grep 确认）。
> 这三条 aria 文案都是 `visually-hidden` 的：普通访客看不见，但读屏用户会听到，
> 中文站点读出 "Main Navigation" 是真实的无障碍缺陷，所以用构建后替换补上了。

嵌入组件（L2）这边：

- 文章卡片是**真实 `<button>`**（放在 `<h3>` 里），Tab 可聚焦、回车可打开。
  早期写成 `<li @click>` —— 鼠标能用，但键盘与读屏用户根本打不开文章；
- 用 `::after` 把按钮命中区拉伸到整张卡，「整卡可点」的手感没有丢；
- 列表 ↔ 详情切换时管理焦点：进详情把焦点移到「返回列表」，返回时还给原来那张卡；
- 筛选结果用 `role="status"` 区域播报给读屏；尊重系统的「减弱动态效果」设置。

## 踩坑记录

改造过程中遇到并已修复的问题，记录于此以免重蹈：

1. **原项目 README 描述了一个不存在的功能。** 原文称「在 `config.js` 的侧边栏配置中添加文章链接」，
   但配置文件里根本没有 `sidebar` 字段，导航是靠手写的 `posts/index.md` 列表页。
   本项目已补上真实的自动侧边栏（`scripts/lib/posts.mjs` + `docs/.vitepress/sidebar.mjs`）。

2. **favicon 404。** 原配置引用 `/favicon.ico`，但 `public/` 下只有 `logo.png`，浏览器一直报 404。
   现已改为 `favicon.svg`，类型声明同步修正。

3. **editLink 指向无效仓库。** 原配置为 `https://github.com/your-repo/edit/main/...`，
   点击必然 404。现改为「留空即不渲染该链接」，避免死链。

4. **构建产物入库。** 原项目 `.gitignore` 虽有 `docs/.vitepress/dist`，但磁盘上残留了一份旧构建。
   本项目已清理，并补齐 `packages/embed/dist` 等规则。

5. **文章正文里的 `ca-pub-XXXX` 不能批量替换。** 那是 AdSense 教程的示例代码，
   属于内容本身，改掉会破坏教程正确性。真正需要处理的只有站点级配置里的那个占位符。

6. **Vite 库模式不会自动替换 `process.env.NODE_ENV`。** ← 改造过程中最费时间的一个坑。
   嵌入组件第一版构建「成功」、体积 488KB，但浏览器里一执行就抛
   `ReferenceError: process is not defined`：模块加载中断，
   `defineCustomElement` 根本没机会执行，`<forge-notes>` 永远是个没有 shadowRoot 的空标签。
   根因是 Vite 在 library mode 下把这个替换交给「库的使用方」处理，
   于是 Vue 的 **dev 分支**被原样打进了产物。
   修法是在 `packages/embed/vite.config.js` 里显式 `define`；
   Rollup 随后折叠掉全部 dev 分支，体积顺带从 488KB 降到 440KB。
   *教训：构建成功 ≠ 浏览器里能跑。这个 bug 只有真的把页面渲染出来、抓控制台才能发现。*

7. **`vite build --config <file>` 的 `outDir` 是相对 `root`，不是相对配置文件。**
   `root` 默认取「执行命令时的 cwd」，于是产物跑到了仓库根的 `dist/`，
   而不是 `packages/embed/dist/`。必须在配置里显式指定 `root`。

8. **canonical 必须与 sitemap 用同一套 URL 形态。**
   初版 canonical 生成 `/about`，而 VitePress 自带的 sitemap 写的是 `/about.html`
   （因为 `cleanUrls` 默认关闭）。不一致会被搜索引擎当成两个页面。
   现已在 `site.config.mjs` 里开启 `cleanUrls: true`，两边统一为无后缀的 `/about`，
   并在 `tools/verify/verify-config.sh` 里加了断言把这个一致性钉住。
   （为什么最后选「无后缀」而不是「带 .html」——见踩坑 14。）

9. **AdSense 脚本默认不注入是刻意的。** 只有显式传 `VITE_ADSENSE_CLIENT` 才会注入。
   这样把博客嵌进别人站点时，不会把本站广告代码带过去 —— 属于「默认安全」的设计，
   不是忘记实现。

10. **`projectRoot` 的层级差一级，会让「最后更新于」永久失效。**
    `docs/.vitepress/config.mjs` 里曾写成 `path.resolve(dirname, '../../..')`。
    `dirname` 已经是 `<项目根>/docs/.vitepress`，退**两**级才是项目根；
    退三级会落到**项目根的上级目录**（这里是 `D:\work`）。
    后果非常隐蔽：`hasGit` 永远为假 →「最后更新于」被静默关闭并打印误导性警告，
    而且构建照样成功、不报任何错。
    *这个 bug 是在给它加 `VITE_OUT_DIR` 时暴露的 —— 产物被写到了项目外的 `D:\work\tools\`，
    才发现根目录算错了。*
    （「最后更新于」后来改用文章 front matter 的 `date` 驱动，不再依赖 `.git` 是否存在，
    见踩坑 15；但这段「路径层级算错会静默改变行为」的教训仍然成立。）

11. **`outDir` 指到 `docs/` 之外时，Vite 不会清空它。**
    这是官方行为（只打一行 warning），本项目的验证脚本正是靠它做到
    「连做 6 次不同配置的构建而互不干扰」：每次输出到带时间戳的独立目录，
    既不需要清空、也不会读到上一次的陈旧产物。
    配合 `DEBUG=1`（VitePress 用 `if (!process.env.DEBUG) await rimraf(tempDir)` 控制
    `.temp` 清理）就能让整套验证构建做到**零批量删除** ——
    在会拦截批量删除的执行环境里，这一点是能否跑通的前提。

12. **`base: './'`（可重定位构建）对带子目录的站点是坏的 —— 而官方文档没提这一点。**
    VitePress 文档称 `'./'` 产出的「同一份产物在任意子路径都能用」（IPFS 网关、归档、
    共享目录等场景）。实测用**真实 Chrome** 打开挂到子路径后的页面，结论相反：

    - 产物里**所有**页面（包括 `posts/welcome.html`）的资源引用都是 `./assets/...`，
      VitePress **没有**按目录深度补 `../`；
    - 站点根页面侥幸正确（同目录），但 `posts/*.html` 会把 `./assets/` 解析成
      `/posts/assets/` → **CSS / JS / 字体共 9 个请求全部 404**，页面无样式无交互，
      控制台持续刷 404。

    根因：relocatable 模式对所有页面使用**统一**的相对前缀，而它的正确性依赖
    「页面 URL 的目录 == 站点根」，这只对**扁平站点**成立。本站有 `posts/` 子目录，
    因此必须用固定子路径 `VITE_BASE=/blog/`。

    这条限制已固化为 `tools/verify/verify-deploy-modes.mjs` 的断言（真实构建 `./` 产物 →
    搬到深层路径 → 浏览器取证 → 断言「深层页面资源确实 404」）。
    将来 VitePress 若修好它，该断言会失败，提醒回来更新本节。
    *教训：官方文档的「支持某场景」，要在**自己项目的真实结构下**验证一次再采信。*

13. **一条恒真的断言等于没有断言。** 列表页最初的检查写的是
    `document.querySelectorAll('a[href*="/posts/"]').length >= 17`，
    但左侧自动侧边栏本身就贡献了 17 个 `/posts/` 链接，
    于是「>= 17」在任何情况下都成立 —— 列表页彻底挂掉它也会绿。
    现改用 `.fn-post-list li a` 精确取列表页自己的条目，并断言**恰好等于** 17。
    *写断言时要问一句：这条有没有可能无论如何都通过？*

14. **Cloudflare Pages 会把 `*.html` 统一 308 掉 —— 于是「带 .html 的站内链接」全部变成重定向。**
   Pages 的 HTML URL 规范化行为，实测（2026-09-14，线上真实响应）：

   | 请求 | 响应 |
   |---|---|
   | `GET /about.html` | `308 Permanent Redirect` → `Location: /about` |
   | `GET /posts/welcome.html` | `308 Permanent Redirect` → `Location: /posts/welcome` |
   | `GET /posts` | `308 Permanent Redirect` → `Location: /posts/` |
   | `GET /about`、`GET /posts/welcome` | `200` |

   原配置 `cleanUrls: false`，VitePress 于是把**每一个**站内链接都渲染成
   `/posts/xxx.html`（首页 6 个、列表页 19 个、侧边栏 18 个），
   再加上 canonical 与 sitemap 也全是 `.html` —— 结果是：每次点击多一次 308 往返，
   搜索引擎拿到的则是「canonical 指向一个会跳转的地址」这种自相矛盾的信号，
   Search Console 会把整站 19 条 URL 报成 *Page with redirect*。
   对一个以 SEO 与 AdSense 过审为目标的站点，这属于要修的问题，不是可忽略的细节。

   修法是把 `cleanUrls` 打开，让产出的链接形态与 Pages 实际返回 200 的地址一致。
   VitePress 会把 markdown 里的 `/foo.html` 链接、`createContentLoader` 返回的
   `url`、canonical、sitemap 全部统一改写成无后缀形式，产物里一个 `.html` 站内链接都不剩
   （已固化为 `verify-config.sh` 的断言）。

   *教训：部署平台的 URL 规范化行为要用真实响应码验一遍。只跑本地 `vitepress preview`
   永远看不到 308 —— 本地预览服务器不吃 `.html` 那一套。*

15. **Cloudflare 的浅克隆，会让「最后更新于」与 sitemap 的 `lastmod` 全站都变成「这次部署的时间」。**
    VitePress 构建期只跑**一次** `git log --name-only` 扫描 `docs/`，建立
    「文件 → 最新提交时间」映射（见 `dist/node` 里的 `cacheAllGitTimestamps`）。
    而 Cloudflare Pages 检出的是**浅克隆**：唯一可见的那个提交（边界提交）
    会被 git 当成「新增了全部文件」，于是仓库里**每个**文件都映射到它。

    同一个仓库、同一份内容，两处构建量到的结果：

    | 构建位置 | 全站日期 | 实际含义 |
    |---|---|---|
    | 本地（全量历史） | `2026-09-14T06:52:47Z` | 初始提交，**正确** —— 所有 `.md` 确实只在那次提交里改过 |
    | Cloudflare | `2026-09-14T07:44:33Z` | 当时的 tip 提交；而**那次提交只改了 README 与两个 `.mjs`，没碰过任何文章** |

    线上实测：`sitemap.xml` 里 20 条 `lastmod` **全部是同一个值**，19 个页面也全都显示同一天。
    后果不只是「不准」：每推一次代码，17 篇文章都会对外宣称「今天刚更新」。

    修法是换数据源 —— 改用文章自带的 `date`：

    - 页面侧：在 `transformPageData` 里覆盖 `pageData.lastUpdated`。
      VitePress 是**先**算好 `lastUpdated`、**再**调用 `transformPageData` 并 merge 返回值，
      所以这里能覆盖（顺序抄自 `dist/node` 的 `createMarkdownToVueRenderFn`）；
    - sitemap 侧：用官方的 `sitemap.transformItems` 重写 `lastmod`，
      没有 `date` 的条目直接删掉该字段 —— 与其给搜索引擎一个编造的日期，不如不给。

    顺带的好处：构建不再依赖 git 历史，本地与 CI 的产物完全一致。

    *教训：只在本地跑得通的「正确」，在 CI 上可能是另一个答案。两边都量一遍再下结论。*

16. **本地化键名写错是静默失效；而且官方文档描述的版本可能比你装的新。**
    中文站点上曾残留一整套英文 UI：导航栏的 `Search`、输入框 placeholder、
    弹窗里的 `Reset search` / `No results found`。修法是官方文档给的
    `themeConfig.search.options.locales.root.translations`（单语言站点挂在 `root` 下）。

    两个坑：

    - **键名必须逐一对照源码**。`VPLocalSearchBox.vue` 只读
      `modal.displayDetails` / `resetButtonTitle` / `backButtonTitle` / `noResultsText`
      与 `modal.footer.*` 这一组键，写错任何一个都是**静默无效果** —— 不报错、不告警。
      所以 `verify.js` 里不是去 grep 配置文件，而是真的把弹窗打开、真的输入一个搜不到的词，
      量它渲染出来的文案。
    - **官方文档超前于已发布版本**。文档里有 `navMenuLabel` / `mobileMenuLabel` / `extraMenuLabel`，
      但 `2.0.0-alpha.15` 的主题产物里 grep 不到这几个键，写了就是空操作。
      用之前先在 `node_modules/vitepress` 里确认一次，别照着文档写完就以为生效了。

    顺便修掉一个顺序问题：`code`/`span` 之类的元素在 `<button>` 里合法，
    但 `<h3>`/`<p>` 不行 —— 所以卡片是「`<h3>` 里放 `<button>`，按钮只包标题文字」，
    而不是把整张卡的内容塞进按钮。

17. **只改产物 HTML 不改 theme JS，中文会在 hydration 之后被覆盖回英文。**

    踩坑 16 最后剩了三条纹丝不动的英文：`Main Navigation` / `Sidebar Navigation` /
    `toggle section`。它们是主题组件里的**字面量**，`2.0.0-alpha.15` 没有任何配置键能改，
    于是改用构建后替换（`scripts/localize-theme-aria.mjs`，挂在 `build:site` 之后）。

    第一版只替换了 `.html` —— grep 产物确认「英文没了、中文在」，看着已经修好了。
    但这是**假修好**：VitePress 是 SSG + hydration，同一个字符串在产物里存在**两份**：

    | 位置 | 形态 |
    |---|---|
    | 静态 HTML | `<span id="main-nav-aria-label" ...> Main Navigation </span>` |
    | `assets/chunks/theme.*.js` | `" Main Navigation "`（渲染函数里的字符串字面量） |

    页面加载后 Vue 会 hydrate。HTML 说中文、JS 说英文，两边对不上，Vue 就按 **JS** 的值
    修正 DOM —— 中文在首屏一闪之后被换成英文，**不报任何错**。只 grep 静态 HTML 是查不出来的。

    修法：两边一起替换。验证方式也跟着改了：`verify.js` 不再 grep 产物文件，而是在
    **真实浏览器、等过 hydration 之后**读
    `document.getElementById('main-nav-aria-label').textContent`。
    同一份产物，grep 说「已本地化」、浏览器说「Main Navigation」—— 只有后者算数。

    但「两边一起替换」这一版**又踩了一个更狠的**。JS 侧的正则是连引号一起匹配的
    （`/" Main Navigation "/`），替换值却写成了裸中文，产物于是变成：

    ```js
    createElementVNode("span",{id:"main-nav-aria-label",...},主导航,-1)   // ← 少了引号
    ```

    中文在 JS 里是**合法的标识符字符**，所以 `node --check` **全部通过**（45 个文件零报错）。
    可运行时 `主导航` 是个未定义变量 → 渲染抛 `ReferenceError` → **整个导航栏菜单子树不渲染**，
    导航栏空白。静态检查全绿、页面白给 —— 而且只影响这一个子树，首页其余部分照常，
    很容易被当成「样式问题」放过去。

    是浏览器断言把它拦下来的：`.VPNavBarMenu` 取到 `null`、`aria 标题` 读到空串。
    只做 grep / 语法检查的验证流水线会一路放行到线上。

    两处加固：

    - 替换值统一用 `JSON.stringify` 生成带引号的字面量，规则表里只写裸文案，不再手写引号；
    - 加了一条**引号数量不变**的不变式 —— JS 补丁前后双引号计数必须相等，
      不等就直接中止构建。宁可构建失败，也不要把「静态检查全绿、运行时报错」的产物发出去。

    *教训：`node --check` 只证明「这是合法语法」，不证明「这是对的代码」。
    SSG 站点的「产物对了」和「运行时对了」是两件事 —— 涉及客户端会接管的节点，
    断言必须放在 hydration 之后的真实 DOM 上；而涉及编译产物的字符串手术，
    要加一条能被机械校验的不变式，别依赖肉眼 grep。*

18. **验证脚本被打断，会把探针值留在配置文件里，让下一次运行假绿。**

    `verify-config.sh` 靠「改 `site.config.mjs` → 重建 → 断言」来验证单一配置源，
    收尾时会把文件还原回去。但它没防住**中途被打断**：一次前台超时把它 SIGTERM 掉，
    探针值 `ZZ-CONFIG-PROBE` 就留在了 `site.config.mjs` 里。

    后果不是「多跑一次就好」，而是下一次运行会**更难读懂**：

    - 它把这份脏文件当成了备份，`sed` 于是匹配不到原文（原文已被改掉）——
      但「文件里含 `ZZ-CONFIG-PROBE`」这条 grep 断言**照样通过**，探针 1 误报 PASS；
    - 收尾「还原」把脏文件又拷了回去，最后两条 `assert_hasnt` 失败，
      表现为一个费解的「还原后仍有探针残留」。

    两处修复：

    - `trap restore_config EXIT INT TERM` —— 无论怎么退出都还原，
      「被打断」和「正常结束」走同一条路径；
    - **前置条件检查**：开跑前先确认文件是原始的 `const SITE_NAME = 'Forge Notes'`，
      不是就直接中止并告诉用户执行 `git checkout -- site.config.mjs`。
      与其在下游看到两个看不懂的红灯，不如在第一时间停下来说清楚。

    *教训：会自动改用户文件的脚本，「被打断」也必须是一条被处理过的路径。
    顺带：被打断时**不要**用 `git checkout --` 去恢复 —— 仓库里可能还有没提交的改动，
    那次我就连带把 `ui` 配置块一起回滚了。先看 `git status`。*

19. **Web Component 的 Boolean 属性：`="false"` 反而是真值，空 attribute 反而是假值。**

    给嵌入组件写文档时承诺了 `<forge-notes show-tags="false">` 这种写法，
    于是加了一条断言去钉它 —— 结果 `tagbar=true`，标签栏照样显示出来。

    去翻 Vue 源码才明白：`defineCustomElement` 的 `_setAttr` **只判断 `_numberProps`**
    （Number 型），Boolean 型拿到的是**原始字符串**。于是：

    | 写法 | props.showTags 实得 | 直觉期望 | 结果 |
    |---|---|---|---|
    | `show-tags="false"` | `"false"`（真值字符串） | 隐藏 | ❌ 显示 |
    | `show-tags`（空 attribute） | `""`（假值） | 显示 | ❌ 隐藏 |

    两种都反着来，而且是**用户的写法错、组件默默照做** —— 这类坑最难被发现，
    因为没有任何报错，只是「设了没用」或「设了反效果」。

    修法不是改断言去迁就现状，而是在组件边界做归一化（`ForgeNotes.vue` 的 `normalizeBool`）：
    空 attribute 按 HTML 惯例算 true，`"false"/"0"/"no"/"off"` 算 false。
    顺带用 `normalizeCount` 兜住 `per-page="abc"`（NaN）和 `per-page="-1"` 这类非法数字。

    *教训：面向使用者的 API，「我认为这个写法应该怎样」不算数，
    「用户真的这么写会发生什么」才算数。断言要写成**用户视角的期望**，
    跑红的时候先怀疑实现，而不是先改断言。*

    附带发现两条断言本身的问题，一并修了：

    - `document.querySelector('.VPNavBarMenu').getAttribute(...)` 在元素不存在时**抛异常**，
      导致**整轮剩余几十条断言全部不跑**。断言工具自己出错只该算这一条失败 ——
      已经改成 null-safe 并返回诊断信息。
    - 「无控制台 error」把 **L1-5 故意访问的那个 404** 也算成了缺陷，于是永远红着。
      已改成记录来源 URL、排除预期内的 404，并把排除数量打印出来 ——
      一条永远红的断言等于没有断言，而且会训练所有人忽略它。

## 关键命令速查

```bash
npm install                  # 安装全部依赖（含 workspace）
npm run dev                  # 启动独立站点（默认 http://localhost:5173）
npm run build                # 构建站点 + 嵌入组件
npm run build:site           # 只构建独立站点（末尾会自动跑主题 aria 文案本地化）
npm run build:embed          # 只构建嵌入组件
npm run build:content        # 只重新生成嵌入组件的内容数据
npm run preview              # 预览构建后的站点

VITE_BASE=/blog/ npm run build:site                          # 子路径部署（推荐）
VITE_SITE_URL=https://a.com npm run build:site               # 生成 sitemap 与 canonical
VITE_ADSENSE_CLIENT=ca-pub-xxx npm run build:site            # 启用 AdSense
VITE_OUT_DIR=build/site npm run build:site                   # 指定输出目录（多套产物并存）
# 注意：不要用 VITE_BASE=./ —— 本站有 posts/ 子目录，会让深层页面资源全部 404，见上文说明

# 验证（四层，都是可重复运行的脚本）
ROUNDS=3 node tools/verify/verify.js           # ① 浏览器端到端：需先 npm run build:site + build:embed
bash tools/verify/verify-config.sh             # ② 架构与配置一致性：自己会重建，结束自动还原
node tools/verify/verify-deploy-modes.mjs      # ③ 部署形态：自己构建两种 base 并用浏览器取证
bash tools/verify/cleanroom.sh ci https://forge-notes.pages.dev
                                               # ④ 干净克隆复现 CI：等价于 Cloudflare 检出后的状态
```

> **构建产物里还会多出两个文件**，都不是手写进仓库的，而是构建期生成的：
> `sitemap.xml`（配了域名才有）与 `robots.txt`（由 `config.mjs` 的 `buildEnd` 从
> `site.config.mjs` 的 `url` 派生，顺带声明 `Sitemap:` 地址）。

## 技术栈

- [VitePress](https://vitepress.dev/) 2.x —— 静态站点生成
- [Vue 3](https://vuejs.org/) —— 组件框架
- [Vite](https://vitejs.dev/) —— 构建工具（站点 + 库模式）
- [markdown-it](https://github.com/markdown-it/markdown-it) —— 构建期 Markdown 渲染

## License

MIT

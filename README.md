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
  features: {                 // 功能开关
    search: true,
    lastUpdated: true,        // 依赖 .git；无 git 时自动关闭并打印告警
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

## 关键命令速查

```bash
npm install                  # 安装全部依赖（含 workspace）
npm run dev                  # 启动独立站点（默认 http://localhost:5173）
npm run build                # 构建站点 + 嵌入组件
npm run build:site           # 只构建独立站点
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

# @forge-notes/embed

把 [Forge Notes](../..) 博客作为子功能嵌入任意网站。产物自包含（已内联 Vue），零运行时依赖。

## 构建

```bash
# 在仓库根目录执行
npm run build:embed
```

产物：

```
packages/embed/dist/
├── forge-notes.js       ESM，自包含（含 Vue）
└── forge-notes.css      样式（JS 也会自动注入一份，可选引入）
```

## 用法一：Web Component（任意站点）

```html
<link rel="stylesheet" href="/assets/forge-notes/forge-notes.css" />

<script type="module">
  import { defineForgeNotesElement } from '/assets/forge-notes/forge-notes.js'
  defineForgeNotesElement()
</script>

<forge-notes theme="auto"></forge-notes>
```

使用 Shadow DOM，样式与宿主站点完全隔离。

## 用法二：Vue 组件

```vue
<script setup>
import { ForgeNotes } from '@forge-notes/embed'
import '@forge-notes/embed/style.css'
</script>

<template>
  <ForgeNotes :per-page="6" theme="auto" />
</template>
```

## 用法三：命令式挂载

```js
import { createForgeNotes } from '@forge-notes/embed'

const instance = createForgeNotes({ el: '#blog', perPage: 10 })
// 需要时销毁
instance.unmount()
```

## API

### 属性 / props

| 名称 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | String | `site.config.mjs` 的 `name` | 列表标题 |
| `description` | String | `site.config.mjs` 的 `description` | 列表副标题 |
| `perPage` | Number | `8` | 每页文章数，`0` 表示不分页 |
| `searchable` | Boolean | `true` | 显示搜索框 |
| `showTags` | Boolean | `true` | 显示标签筛选栏 |
| `maxTags` | Number | `12` | 标签栏最多显示几个标签（按频次排序取前 N），`0` 表示全部铺开 |
| `useHash` | Boolean | `false` | 用 URL hash 同步文章路由 |
| `initialSlug` | String | `''` | 初始打开的文章 slug |
| `theme` | String | `'auto'` | `auto` / `light` / `dark` |

> Web Component 形式下，属性用 kebab-case：`per-page`、`show-tags`、`use-hash`、`initial-slug`。

### 导出

| 导出 | 说明 |
|---|---|
| `ForgeNotes` | Vue 组件 |
| `createForgeNotes(options)` | 命令式挂载，返回 `{ app, unmount }` |
| `defineForgeNotesElement(tag?)` | 注册自定义元素，默认标签 `forge-notes` |
| `forgeNotesContent` | 只读内容数据（`{ generatedAt, count, posts }`），用于自定义渲染 |

### 组件方法（通过 ref 调用）

| 方法 | 说明 |
|---|---|
| `open(post)` | 打开指定文章 |
| `back()` | 返回列表 |
| `allPosts` | 全部文章数据 |

## 换肤

覆盖 CSS 变量，无需修改组件源码：

```css
forge-notes {
  --fn-accent: #2563eb;
  --fn-accent-hover: #1d4ed8;
  --fn-accent-soft: rgba(37, 99, 235, 0.08);
  --fn-bg: #ffffff;
  --fn-surface: #f7f7f8;
  --fn-border: #e6e6ea;
  --fn-text: #1f2328;
  --fn-text-soft: #6b7280;
  --fn-radius: 12px;
}
```

## 设计说明

**为什么不碰 URL？** 默认 `useHash: false`，组件用内部状态切换列表与详情，
不写 `location.hash`，因此不会干扰宿主站点自己的路由（含 SPA 的 history 路由）。
需要可分享的文章链接时才开启 `useHash`。

**为什么内联 Vue？** 嵌入场景下宿主未必有 Vue。内联换来「单文件、零配置、任何站点可用」，
代价约 35KB（gzip 约 13KB）。对博客这种内容型组件是划算的。

**内容从哪来？** 构建期由 `scripts/build-embed-content.mjs` 扫描 `docs/posts/*.md`，
用 markdown-it 渲染成 HTML 后内联进产物，运行时零 Markdown 解析开销。
品牌配置直接读取根目录 `site.config.mjs`，与独立站点保持一致。

**不含语法高亮。** 有意为之 —— 避免把 Shiki 及语言包打进运行时产物。
需要高亮效果请使用独立部署的 VitePress 站点。

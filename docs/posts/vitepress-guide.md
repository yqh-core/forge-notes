---
title: VitePress 入门指南
date: 2025-11-30
tags:
  - VitePress
  - 教程
  - 前端
---

# VitePress 入门指南

本文将带你快速了解如何使用 VitePress 搭建自己的博客或文档站点。

## 什么是 VitePress？

VitePress 是一个基于 Vite 和 Vue 3 的静态站点生成器（SSG），专为技术文档和博客而设计。它是 VuePress 的精神继承者，但更加轻量和快速。

## 核心特性

### 1. 极速的开发体验

```bash
# 启动开发服务器
npm run docs:dev
```

基于 Vite 的开发服务器可以实现：
- ⚡️ 即时热更新
- 🚀 快速的冷启动
- 📦 按需编译

### 2. Markdown 扩展

VitePress 扩展了标准的 Markdown 语法：

:::tip 提示
这是一个提示框
:::

:::warning 警告
这是一个警告框
:::

:::danger 危险
这是一个危险警告框
:::

### 3. 代码高亮

支持多种编程语言的语法高亮：

```javascript
// JavaScript 示例
function hello() {
  console.log('Hello, VitePress!')
}
```

```python
# Python 示例
def hello():
    print("Hello, VitePress!")
```

### 4. Vue 组件

你可以在 Markdown 中直接使用 Vue 组件：

<script setup>
import { ref } from 'vue'

const count = ref(0)
</script>

<button @click="count++">点击次数: {{ count }}</button>

## 项目结构

```
.
├── docs
│   ├── .vitepress
│   │   └── config.js       # 配置文件
│   ├── posts              # 博客文章
│   │   └── welcome.md
│   └── index.md           # 首页
├── package.json
└── node_modules
```

## 配置说明

### 基础配置

```javascript
export default {
  title: '我的博客',
  description: '这是我的博客描述',

  themeConfig: {
    nav: [...],      // 导航栏
    sidebar: {...},  // 侧边栏
    footer: {...}    // 页脚
  }
}
```

### 主题定制

VitePress 支持自定义主题：

```javascript
themeConfig: {
  // 自定义颜色
  colorScheme: 'dark',

  // 社交链接
  socialLinks: [
    { icon: 'github', link: 'https://github.com' }
  ]
}
```

## 部署

### 构建生产版本

```bash
npm run docs:build
```

### 部署到 GitHub Pages

1. 配置 `base` 路径
2. 创建部署脚本
3. 推送到 GitHub

### 部署到其他平台

- Netlify
- Vercel
- Cloudflare Pages

## 最佳实践

1. **组织内容** - 使用清晰的目录结构
2. **SEO 优化** - 设置合适的 meta 信息
3. **性能优化** - 使用懒加载和代码分割
4. **可访问性** - 注意语义化标签的使用

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式
npm run docs:dev

# 构建
npm run docs:build

# 预览构建结果
npm run docs:preview
```

## 资源链接

- [VitePress 官方文档](https://vitepress.dev/)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)

## 总结

VitePress 是一个强大而简洁的静态站点生成器，特别适合：

- ✅ 技术博客
- ✅ 项目文档
- ✅ 知识库
- ✅ 个人网站

开始使用 VitePress，享受现代化的内容创作体验吧！

---

*发布于 2025-11-30*

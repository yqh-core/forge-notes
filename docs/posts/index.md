---
title: 博客文章
---

<script setup>
import { withBase } from 'vitepress'
import { data as archive } from './posts.data.js'
</script>

# 博客文章

欢迎来到 {{ archive.siteName }}！这里分享跨境电商技术、SEO 优化、AdSense 变现和前端开发的实战经验。

以下分组与文章列表**由 `docs/posts` 目录自动生成**（数据加载器 `posts.data.js`），新增文章只要写了 `tags` 就会自动归组，无需再手工维护本页链接。

<template v-for="group in archive.groups" :key="group.label">
  <h2 class="fn-group-title">{{ group.icon }} {{ group.label }}</h2>
  <p class="fn-group-desc">{{ group.desc }}</p>
  <ul class="fn-post-list">
    <li v-for="post in group.items" :key="post.url">
      <a :href="withBase(post.url)">{{ post.title }}</a>
      <span class="fn-post-date">{{ post.date }}</span>
    </li>
  </ul>
</template>

<style>
.fn-group-title { margin-top: 2rem; }
.fn-group-desc { color: var(--vp-c-text-2); font-size: .92rem; margin: .35rem 0 .8rem; }
.fn-post-list { list-style: none; padding-left: 0; }
.fn-post-list li {
  display: flex; justify-content: space-between; gap: 1rem;
  padding: .45rem 0; border-bottom: 1px solid var(--vp-c-divider);
}
.fn-post-date { color: var(--vp-c-text-3); font-size: .85rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
@media (max-width: 640px) { .fn-post-list li { flex-direction: column; gap: .15rem; } }
</style>

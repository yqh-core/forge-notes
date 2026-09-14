<script setup>
/**
 * ForgeNotes.vue —— 博客主组件（列表 + 详情）
 *
 * 集成友好性设计：
 *  - 默认不碰 URL：useHash 默认 false，不会干扰宿主站点的路由
 *  - 品牌来自 site.config.mjs，与独立站点保持同一份配置
 *  - 样式全部在 styles.css（.fn- 前缀），组件内不写 <style>，
 *    这样 Shadow DOM 与普通挂载可以共用同一份样式
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import content from './content.generated.json'
import { site } from '../../../site.config.mjs'

const props = defineProps({
  /** 覆盖站点标题，默认取 site.config.mjs 的 name */
  title: { type: String, default: '' },
  /** 覆盖副标题，默认取 site.config.mjs 的 description */
  description: { type: String, default: '' },
  /** 每页文章数，0 表示不分页 */
  perPage: { type: Number, default: 8 },
  /** 是否显示搜索框 */
  searchable: { type: Boolean, default: true },
  /** 是否显示标签筛选栏 */
  showTags: { type: Boolean, default: true },
  /** 标签栏最多显示几个标签，0 表示全部铺开 */
  maxTags: { type: Number, default: 12 },
  /** 是否用 URL hash 同步文章路由。默认 false，避免干扰宿主站点路由 */
  useHash: { type: Boolean, default: false },
  /** 初始直接打开的文章 slug */
  initialSlug: { type: String, default: '' },
  /** 主题：auto 跟随系统 / light / dark */
  theme: { type: String, default: 'auto' },
})

const rootRef = ref(null)
const keyword = ref('')
const activeTag = ref('')
const currentSlug = ref(props.initialSlug)
const pageSize = ref(props.perPage > 0 ? props.perPage : 0)

const allPosts = content.posts || []
const displayTitle = computed(() => props.title || site.name)
const displayDesc = computed(() => props.description || site.description)

/**
 * 全部标签，按出现频次降序排列。
 *
 * 文章一多标签就会很碎（本项目 17 篇就产生 30+ 个标签，平铺要占五六行）。
 * 按频次排序能让最有代表性的标签排在前面，再配合 maxTags 折叠，
 * 标签栏就不会喧宾夺主。
 */
const allTags = computed(() => {
  const freq = new Map()
  for (const post of allPosts) {
    for (const tag of post.tags || []) {
      freq.set(tag, (freq.get(tag) || 0) + 1)
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([tag]) => tag)
})

const tagsExpanded = ref(false)

const visibleTags = computed(() =>
  tagsExpanded.value || props.maxTags <= 0
    ? allTags.value
    : allTags.value.slice(0, props.maxTags),
)

const hiddenTagCount = computed(() =>
  Math.max(0, allTags.value.length - visibleTags.value.length),
)

/** 搜索 + 标签筛选后的结果 */
const filtered = computed(() => {
  let list = allPosts

  if (activeTag.value) {
    list = list.filter((p) => (p.tags || []).includes(activeTag.value))
  }

  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((p) => {
      const haystack = `${p.title} ${p.excerpt} ${(p.tags || []).join(' ')}`
      return haystack.toLowerCase().includes(kw)
    })
  }

  return list
})

const visible = computed(() =>
  pageSize.value > 0 ? filtered.value.slice(0, pageSize.value) : filtered.value,
)

const hasMore = computed(() => pageSize.value > 0 && filtered.value.length > pageSize.value)

const current = computed(() => allPosts.find((p) => p.slug === currentSlug.value) || null)

const themeClass = computed(() => (props.theme === 'auto' ? '' : `fn-theme-${props.theme}`))

function open(post) {
  currentSlug.value = post.slug
  syncHash()
  scrollToTop()
}

function back() {
  currentSlug.value = ''
  syncHash()
  scrollToTop()
}

function loadMore() {
  pageSize.value += props.perPage || 8
}

function scrollToTop() {
  rootRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

function syncHash() {
  if (!props.useHash || typeof window === 'undefined') return
  const next = currentSlug.value
    ? `#/posts/${encodeURIComponent(currentSlug.value)}`
    : '#/'
  if (window.location.hash !== next) window.location.hash = next
}

function readHash() {
  if (!props.useHash || typeof window === 'undefined') return
  const match = (window.location.hash || '').match(/^#\/posts\/(.+)$/)
  currentSlug.value = match ? decodeURIComponent(match[1]) : props.initialSlug
}

onMounted(() => {
  if (!props.useHash) return
  readHash()
  window.addEventListener('hashchange', readHash)
})

onBeforeUnmount(() => {
  if (!props.useHash) return
  window.removeEventListener('hashchange', readHash)
})

// 改变筛选条件时重置分页，避免出现「筛选后列表为空」的错觉
watch([keyword, activeTag], () => {
  pageSize.value = props.perPage > 0 ? props.perPage : 0
})

defineExpose({ open, back, allPosts })
</script>

<template>
  <div ref="rootRef" class="fn-root" :class="themeClass">
    <!-- ===================== 详情视图 ===================== -->
    <article v-if="current" class="fn-post">
      <button class="fn-back" type="button" @click="back">← 返回列表</button>

      <h1 class="fn-post-title">{{ current.title }}</h1>

      <div class="fn-meta">
        <time v-if="current.date">{{ current.date }}</time>
        <span v-for="tag in current.tags" :key="tag" class="fn-tag">{{ tag }}</span>
      </div>

      <!-- 内容在构建期已渲染为 HTML，运行时零解析开销 -->
      <div class="fn-content" v-html="current.html" />
    </article>

    <!-- ===================== 列表视图 ===================== -->
    <div v-else class="fn-list">
      <header class="fn-header">
        <h2 class="fn-list-title">{{ displayTitle }}</h2>
        <p class="fn-list-desc">{{ displayDesc }}</p>

        <input
          v-if="searchable"
          v-model="keyword"
          class="fn-search"
          type="search"
          placeholder="搜索文章标题、标签或摘要…"
          aria-label="搜索文章"
        />

        <div v-if="showTags && allTags.length" class="fn-tagbar">
          <button
            type="button"
            class="fn-chip"
            :class="{ 'fn-chip-on': !activeTag }"
            @click="activeTag = ''"
          >
            全部
          </button>
          <button
            v-for="tag in visibleTags"
            :key="tag"
            type="button"
            class="fn-chip"
            :class="{ 'fn-chip-on': activeTag === tag }"
            @click="activeTag = tag"
          >
            {{ tag }}
          </button>
          <button
            v-if="hiddenTagCount > 0 || tagsExpanded"
            type="button"
            class="fn-chip fn-chip-more"
            @click="tagsExpanded = !tagsExpanded"
          >
            {{ tagsExpanded ? '收起' : `+${hiddenTagCount}` }}
          </button>
        </div>
      </header>

      <ul v-if="visible.length" class="fn-cards">
        <li v-for="post in visible" :key="post.slug" class="fn-card" @click="open(post)">
          <h3 class="fn-card-title">{{ post.title }}</h3>
          <p class="fn-card-excerpt">{{ post.excerpt }}</p>
          <div class="fn-meta">
            <time v-if="post.date">{{ post.date }}</time>
            <span v-for="tag in post.tags" :key="tag" class="fn-tag">{{ tag }}</span>
          </div>
        </li>
      </ul>

      <p v-else class="fn-empty">没有匹配的文章</p>

      <button v-if="hasMore" type="button" class="fn-more" @click="loadMore">
        加载更多（还有 {{ filtered.length - visible.length }} 篇）
      </button>
    </div>
  </div>
</template>

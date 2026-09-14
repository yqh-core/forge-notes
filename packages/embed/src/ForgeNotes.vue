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

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

/*
 * ============================================================================
 * 属性归一化：Web Component 下 Boolean / Number 属性不能直接信
 * ============================================================================
 *
 * Vue 的 `defineCustomElement` **只对 Number 型** props 做「属性字符串 → 数字」的转换
 * （源码见 @vue/runtime-dom 的 `_numberProps`，`_setAttr` 里只判断了它）。
 * Boolean 型拿到的是**原始字符串**，于是 HTML 里两种最自然的写法结果都跟直觉相反：
 *
 *   <forge-notes show-tags="false">   → props.showTags === "false"（真值）→ 标签栏**显示**
 *   <forge-notes show-tags>           → props.showTags === ""     （假值）→ 标签栏**隐藏**
 *
 * 用户写 `="false"` 本意是关掉，结果反而打开了 —— 这是纯粹的坑，不该让使用者去背。
 * 所以在组件边界做一次归一化，让「HTML 属性写法」与「JS 传值写法」表现一致：
 *
 *   - 空字符串（`<x show-tags>`）按 HTML 惯例视为 true
 *   - "false" / "0" / "no" / "off"（不分大小写、忽略首尾空格）视为 false
 *   - 其余非空字符串视为 true
 *   - 真正的布尔值按原样
 *
 * README 里对外的承诺以这里的语义为准。
 */
function normalizeBool(value, fallback) {
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    if (s === '') return true
    return !['false', '0', 'no', 'off'].includes(s)
  }
  if (value === undefined || value === null) return fallback
  return value !== false
}

/**
 * 数字型属性归一化。
 *
 * Number 型虽然会被 Vue 转成数字，但 `per-page="abc"` 会得到 NaN、
 * `per-page="-1"` 会得到负数 —— 都会让分页算出乱七八糟的切片。
 * 统一收敛：非法值回落到默认，0 保留（0 = 不分页，见 perPage 的说明）。
 */
function normalizeCount(value, fallback) {
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const tagsVisible = computed(() => normalizeBool(props.showTags, true))
const searchVisible = computed(() => normalizeBool(props.searchable, true))
const hashRouting = computed(() => normalizeBool(props.useHash, false))
/** 每页文章数；0 表示不分页 */
const perPageCount = computed(() => normalizeCount(props.perPage, 8))
/** 标签栏最多显示几个；0 表示全部铺开 */
const maxTagCount = computed(() => normalizeCount(props.maxTags, 12))

const rootRef = ref(null)
const keyword = ref('')
const activeTag = ref('')
const currentSlug = ref(props.initialSlug)
const pageSize = ref(perPageCount.value > 0 ? perPageCount.value : 0)
/** 记住刚打开过的文章，返回列表时把焦点还给对应的卡片 */
const lastOpenedSlug = ref('')

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
  tagsExpanded.value || maxTagCount.value <= 0
    ? allTags.value
    : allTags.value.slice(0, maxTagCount.value),
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

/**
 * 打开文章。
 *
 * 顺带把焦点移到「返回列表」按钮上：详情视图会把列表整体替换掉，
 * 原来那个触发按钮已经不在 DOM 里了。不管焦点的话它会掉回 <body>，
 * 键盘用户得从页首重新 Tab 一遍 —— 这是换视图后最基本的无障碍要求。
 */
async function open(post) {
  lastOpenedSlug.value = post.slug
  currentSlug.value = post.slug
  syncHash()
  scrollToTop()
  await nextTick()
  rootRef.value?.querySelector('.fn-back')?.focus()
}

/**
 * 返回列表，并把焦点还给「刚才打开的那张卡片」—— 从哪来的回哪去，
 * 免得用户在 17 张卡里重新找位置。
 * 找不到时（例如筛选条件变了、那张卡已不在当前结果里）退到搜索框。
 */
async function back() {
  const slug = lastOpenedSlug.value
  currentSlug.value = ''
  syncHash()
  scrollToTop()
  await nextTick()
  const card = slug ? rootRef.value?.querySelector(`[data-slug="${slug}"]`) : null
  const fallback =
    rootRef.value?.querySelector('.fn-search') || rootRef.value?.querySelector('.fn-list-title')
  ;(card || fallback)?.focus()
}

function loadMore() {
  pageSize.value += perPageCount.value || 8
}

/**
 * 滚动到组件顶部。
 * 平滑滚动对「前庭功能敏感」的用户是负担，所以先看系统设置再决定。
 */
function scrollToTop() {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  rootRef.value?.scrollIntoView?.({
    behavior: reduce ? 'auto' : 'smooth',
    block: 'start',
  })
}

function syncHash() {
  if (!hashRouting.value || typeof window === 'undefined') return
  const next = currentSlug.value
    ? `#/posts/${encodeURIComponent(currentSlug.value)}`
    : '#/'
  if (window.location.hash !== next) window.location.hash = next
}

function readHash() {
  if (!hashRouting.value || typeof window === 'undefined') return
  const match = (window.location.hash || '').match(/^#\/posts\/(.+)$/)
  currentSlug.value = match ? decodeURIComponent(match[1]) : props.initialSlug
}

onMounted(() => {
  if (!hashRouting.value) return
  readHash()
  window.addEventListener('hashchange', readHash)
})

onBeforeUnmount(() => {
  if (!hashRouting.value) return
  window.removeEventListener('hashchange', readHash)
})

// 改变筛选条件时重置分页，避免出现「筛选后列表为空」的错觉
watch([keyword, activeTag], () => {
  pageSize.value = perPageCount.value > 0 ? perPageCount.value : 0
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
        <!-- tabindex="-1" 让 back() 在找不到原卡片时能把它设为焦点（tabindex=-1 不进 Tab 序列） -->
        <h2 class="fn-list-title" tabindex="-1">{{ displayTitle }}</h2>
        <p class="fn-list-desc">{{ displayDesc }}</p>

        <!-- 筛选结果播报：只在真的筛选时才播，避免初次加载就朗读 -->
        <p class="fn-vh" role="status">
          <template v-if="keyword || activeTag">筛选后共 {{ filtered.length }} 篇文章</template>
        </p>

        <input
          v-if="searchVisible"
          v-model="keyword"
          class="fn-search"
          type="search"
          placeholder="搜索文章标题、标签或摘要…"
          aria-label="搜索文章"
        />

        <div
          v-if="tagsVisible && allTags.length"
          class="fn-tagbar"
          role="group"
          aria-label="按标签筛选"
        >
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
            :aria-expanded="tagsExpanded"
            :aria-label="tagsExpanded ? '收起多余标签' : `展开其余 ${hiddenTagCount} 个标签`"
            @click="tagsExpanded = !tagsExpanded"
          >
            {{ tagsExpanded ? '收起' : `+${hiddenTagCount}` }}
          </button>
        </div>
      </header>

      <ul v-if="visible.length" class="fn-cards">
        <li v-for="post in visible" :key="post.slug" class="fn-card">
          <h3 class="fn-card-title">
            <!--
              真 button，不是给 <li> 挂 @click：
              <li> 不可聚焦也没有键盘事件，键盘/读屏用户根本打不开文章。
              ::after 把命中区拉伸到整张卡，所以鼠标仍然点哪儿都能进。
            -->
            <button
              type="button"
              class="fn-card-btn"
              :data-slug="post.slug"
              @click="open(post)"
            >
              {{ post.title }}
            </button>
          </h3>
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

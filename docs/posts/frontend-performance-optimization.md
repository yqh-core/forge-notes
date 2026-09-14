---
title: 前端性能优化实战：提升网站速度与转化率
date: 2025-11-30
tags:
  - 前端性能
  - Web优化
  - Core Web Vitals
  - 用户体验
---

# 前端性能优化实战：提升网站速度与转化率

网站性能直接影响用户体验和业务指标。研究表明，页面加载时间每增加 1 秒，转化率下降 7%。本文将系统讲解前端性能优化的策略和实践。

## 性能指标详解

### Core Web Vitals

Google 的三大核心指标：

**1. LCP (Largest Contentful Paint) - 最大内容绘制**
```
评分标准：
- 优秀：< 2.5秒
- 需改进：2.5-4秒
- 差：> 4秒

优化目标：首屏最大元素的加载速度
```

**2. FID (First Input Delay) - 首次输入延迟**
```
评分标准：
- 优秀：< 100ms
- 需改进：100-300ms
- 差：> 300ms

优化目标：用户首次交互的响应速度
```

**3. CLS (Cumulative Layout Shift) - 累积布局偏移**
```
评分标准：
- 优秀：< 0.1
- 需改进：0.1-0.25
- 差：> 0.25

优化目标：减少页面元素的意外移动
```

### 性能监控实现

```typescript
// lib/performance-monitoring.ts
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

interface PerformanceMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  id: string;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];

  init() {
    // 收集所有 Web Vitals
    getCLS(this.handleMetric.bind(this));
    getFID(this.handleMetric.bind(this));
    getFCP(this.handleMetric.bind(this));
    getLCP(this.handleMetric.bind(this));
    getTTFB(this.handleMetric.bind(this));
  }

  private handleMetric(metric: PerformanceMetric) {
    this.metrics.push(metric);

    // 实时上报
    this.reportToAnalytics(metric);

    // 性能告警
    if (metric.rating === 'poor') {
      this.sendAlert(metric);
    }
  }

  private async reportToAnalytics(metric: PerformanceMetric) {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
    });

    // 使用 sendBeacon 确保数据发送
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/performance', body);
    } else {
      fetch('/api/analytics/performance', {
        method: 'POST',
        body,
        keepalive: true,
      });
    }
  }

  private sendAlert(metric: PerformanceMetric) {
    console.warn(`Performance issue detected: ${metric.name} = ${metric.value}`);
  }

  getMetrics() {
    return this.metrics;
  }
}

// 使用
export const performanceMonitor = new PerformanceMonitor();

if (typeof window !== 'undefined') {
  performanceMonitor.init();
}
```

## 图片优化

### 1. 现代图片格式

```typescript
// components/OptimizedImage.tsx
import Image from 'next/image';

interface OptimizedImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  priority = false,
}: OptimizedImageProps) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      loading={priority ? 'eager' : 'lazy'}
      quality={85}
      placeholder="blur"
      blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRg..."
      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
      style={{
        width: '100%',
        height: 'auto',
      }}
    />
  );
}
```

### 2. 响应式图片

```html
<!-- 使用 srcset 和 sizes -->
<picture>
  <!-- WebP 格式 (现代浏览器) -->
  <source
    type="image/webp"
    srcset="
      /images/product-small.webp 400w,
      /images/product-medium.webp 800w,
      /images/product-large.webp 1200w
    "
    sizes="(max-width: 768px) 100vw, 50vw"
  />

  <!-- AVIF 格式 (更先进) -->
  <source
    type="image/avif"
    srcset="
      /images/product-small.avif 400w,
      /images/product-medium.avif 800w,
      /images/product-large.avif 1200w
    "
    sizes="(max-width: 768px) 100vw, 50vw"
  />

  <!-- 回退到 JPEG -->
  <img
    src="/images/product-medium.jpg"
    srcset="
      /images/product-small.jpg 400w,
      /images/product-medium.jpg 800w,
      /images/product-large.jpg 1200w
    "
    sizes="(max-width: 768px) 100vw, 50vw"
    alt="Product"
    loading="lazy"
    decoding="async"
  />
</picture>
```

### 3. 图片懒加载

```typescript
// hooks/useImageLazyLoad.ts
import { useEffect, useRef, useState } from 'react';

export function useImageLazyLoad() {
  const imgRef = useRef<HTMLImageElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isLoaded) {
            const img = entry.target as HTMLImageElement;
            const src = img.dataset.src;

            if (src) {
              img.src = src;
              img.onload = () => setIsLoaded(true);
            }
          }
        });
      },
      {
        rootMargin: '50px', // 提前 50px 开始加载
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, [isLoaded]);

  return { imgRef, isLoaded };
}

// 使用
export function LazyImage({ src, alt }: { src: string; alt: string }) {
  const { imgRef, isLoaded } = useImageLazyLoad();

  return (
    <img
      ref={imgRef}
      data-src={src}
      alt={alt}
      className={isLoaded ? 'loaded' : 'loading'}
      style={{
        filter: isLoaded ? 'none' : 'blur(10px)',
        transition: 'filter 0.3s ease',
      }}
    />
  );
}
```

## 代码分割与懒加载

### 1. 路由级代码分割

```typescript
// app/layout.tsx
import { lazy, Suspense } from 'react';

// 懒加载组件
const ProductList = lazy(() => import('@/components/ProductList'));
const UserProfile = lazy(() => import('@/components/UserProfile'));
const ShoppingCart = lazy(() => import('@/components/ShoppingCart'));

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Header />

      <Suspense fallback={<LoadingSkeleton />}>
        {children}
      </Suspense>

      <Footer />
    </div>
  );
}
```

### 2. 组件级代码分割

```typescript
// 动态导入重型组件
import dynamic from 'next/dynamic';

// 客户端渲染的组件
const HeavyChart = dynamic(() => import('@/components/HeavyChart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), {
  ssr: false,
  loading: () => <div>Loading video...</div>,
});

export function Dashboard() {
  return (
    <div>
      <h1>Analytics Dashboard</h1>
      <HeavyChart />
      <VideoPlayer />
    </div>
  );
}
```

### 3. 条件加载

```typescript
// 仅在需要时加载
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const Comments = dynamic(() => import('@/components/Comments'));
const ShareModal = dynamic(() => import('@/components/ShareModal'));

export function BlogPost({ content }: { content: string }) {
  const [showComments, setShowComments] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  return (
    <article>
      <div dangerouslySetInnerHTML={{ __html: content }} />

      <button onClick={() => setShowComments(true)}>
        Show Comments
      </button>

      {showComments && <Comments />}

      <button onClick={() => setShowShareModal(true)}>
        Share
      </button>

      {showShareModal && (
        <ShareModal onClose={() => setShowShareModal(false)} />
      )}
    </article>
  );
}
```

## 资源优化

### 1. 字体优化

```css
/* 字体优化 */
@font-face {
  font-family: 'CustomFont';
  src: url('/fonts/custom-font.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap; /* 避免 FOIT (Flash of Invisible Text) */
}

/* 预加载关键字体 */
```

```html
<head>
  <!-- 预加载字体 -->
  <link
    rel="preload"
    href="/fonts/custom-font.woff2"
    as="font"
    type="font/woff2"
    crossorigin="anonymous"
  />

  <!-- 预连接到字体 CDN -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
</head>
```

### 2. CSS 优化

```typescript
// 关键 CSS 内联
export default function RootLayout({ children }: {
  children: React.ReactNode;
}) {
  return (
    <html>
      <head>
        {/* 关键 CSS 内联 */}
        <style dangerouslySetInnerHTML={{
          __html: `
            body { margin: 0; font-family: system-ui; }
            .header { height: 60px; background: #fff; }
            .main { min-height: calc(100vh - 120px); }
          `
        }} />

        {/* 非关键 CSS 异步加载 */}
        <link
          rel="preload"
          href="/styles/main.css"
          as="style"
          onLoad="this.onload=null;this.rel='stylesheet'"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### 3. JavaScript 优化

```html
<!-- 脚本加载策略 -->
<head>
  <!-- 关键脚本：阻塞加载 -->
  <script src="/critical.js"></script>

  <!-- 非关键脚本：defer -->
  <script src="/analytics.js" defer></script>

  <!-- 独立脚本：async -->
  <script src="/chat-widget.js" async></script>

  <!-- 模块脚本 -->
  <script type="module" src="/app.js"></script>
</head>
```

## 缓存策略

### 1. HTTP 缓存

```typescript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=60, stale-while-revalidate=120',
          },
        ],
      },
    ];
  },
};
```

### 2. Service Worker 缓存

```typescript
// public/sw.js
const CACHE_VERSION = 'v1';
const CACHE_STATIC = `static-${CACHE_VERSION}`;
const CACHE_DYNAMIC = `dynamic-${CACHE_VERSION}`;

// 安装 Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return cache.addAll([
        '/',
        '/styles/main.css',
        '/scripts/app.js',
        '/images/logo.png',
      ]);
    })
  );
});

// 拦截请求
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // 缓存命中，返回缓存
      if (response) {
        return response;
      }

      // 缓存未命中，发起网络请求
      return fetch(event.request).then((response) => {
        // 克隆响应
        const responseToCache = response.clone();

        caches.open(CACHE_DYNAMIC).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    })
  );
});
```

### 3. 客户端缓存

```typescript
// lib/cache.ts
class ClientCache {
  private cache = new Map<string, {
    data: any;
    timestamp: number;
    ttl: number;
  }>();

  set(key: string, data: any, ttl: number = 5 * 60 * 1000) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);

    if (!item) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return null;
    }

    return item.data as T;
  }

  clear() {
    this.cache.clear();
  }
}

export const cache = new ClientCache();

// 使用
async function fetchProducts() {
  const cached = cache.get<Product[]>('products');

  if (cached) {
    return cached;
  }

  const products = await fetch('/api/products').then(r => r.json());
  cache.set('products', products, 5 * 60 * 1000); // 缓存 5 分钟

  return products;
}
```

## 渲染优化

### 1. 虚拟滚动

```typescript
// components/VirtualList.tsx
import { useEffect, useRef, useState } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  containerHeight: number;
}

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  containerHeight,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 计算可见范围
  const startIndex = Math.floor(scrollTop / itemHeight);
  const endIndex = Math.min(
    startIndex + Math.ceil(containerHeight / itemHeight) + 1,
    items.length
  );

  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div
      ref={containerRef}
      style={{
        height: containerHeight,
        overflow: 'auto',
      }}
      onScroll={handleScroll}
    >
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, index) =>
            renderItem(item, startIndex + index)
          )}
        </div>
      </div>
    </div>
  );
}
```

### 2. 防抖与节流

```typescript
// hooks/useDebounce.ts
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

// hooks/useThrottle.ts
export function useThrottle<T>(value: T, limit: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastRan = useRef(Date.now());

  useEffect(() => {
    const handler = setTimeout(() => {
      if (Date.now() - lastRan.current >= limit) {
        setThrottledValue(value);
        lastRan.current = Date.now();
      }
    }, limit - (Date.now() - lastRan.current));

    return () => clearTimeout(handler);
  }, [value, limit]);

  return throttledValue;
}

// 使用示例
function SearchInput() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 500);

  useEffect(() => {
    if (debouncedSearch) {
      // 执行搜索
      performSearch(debouncedSearch);
    }
  }, [debouncedSearch]);

  return (
    <input
      type="text"
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      placeholder="Search..."
    />
  );
}
```

### 3. React 性能优化

```typescript
// 使用 memo 避免不必要的渲染
import { memo } from 'react';

export const ProductCard = memo(function ProductCard({
  product,
  onAddToCart,
}: {
  product: Product;
  onAddToCart: (id: string) => void;
}) {
  return (
    <div className="product-card">
      <img src={product.image} alt={product.name} />
      <h3>{product.name}</h3>
      <p>${product.price}</p>
      <button onClick={() => onAddToCart(product.id)}>
        Add to Cart
      </button>
    </div>
  );
});

// 使用 useMemo 缓存计算结果
import { useMemo } from 'react';

function ProductList({ products, filters }: {
  products: Product[];
  filters: Filters;
}) {
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      if (filters.category && product.category !== filters.category) {
        return false;
      }
      if (filters.minPrice && product.price < filters.minPrice) {
        return false;
      }
      if (filters.maxPrice && product.price > filters.maxPrice) {
        return false;
      }
      return true;
    });
  }, [products, filters]);

  return (
    <div>
      {filteredProducts.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

// 使用 useCallback 缓存回调函数
import { useCallback } from 'react';

function Parent() {
  const [items, setItems] = useState<Item[]>([]);

  const handleAddItem = useCallback((item: Item) => {
    setItems((prev) => [...prev, item]);
  }, []);

  return <Child onAdd={handleAddItem} />;
}
```

## 网络优化

### 1. 预加载与预获取

```html
<head>
  <!-- 预连接到关键域名 -->
  <link rel="preconnect" href="https://api.example.com" />
  <link rel="dns-prefetch" href="https://cdn.example.com" />

  <!-- 预加载关键资源 -->
  <link rel="preload" href="/critical.css" as="style" />
  <link rel="preload" href="/hero-image.jpg" as="image" />

  <!-- 预获取下一页资源 -->
  <link rel="prefetch" href="/page2.html" />
  <link rel="prefetch" href="/products.json" />

  <!-- 预渲染下一页 -->
  <link rel="prerender" href="/checkout" />
</head>
```

### 2. 资源提示

```typescript
// 动态预加载
function prefetchPage(url: string) {
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = url;
  document.head.appendChild(link);
}

// 鼠标悬停时预加载
function ProductLink({ href, children }: {
  href: string;
  children: React.ReactNode;
}) {
  const handleMouseEnter = () => {
    prefetchPage(href);
  };

  return (
    <a href={href} onMouseEnter={handleMouseEnter}>
      {children}
    </a>
  );
}
```

## 性能预算

```typescript
// performance-budget.config.ts
export const performanceBudget = {
  // 页面大小限制
  totalSize: 2 * 1024 * 1024, // 2MB
  imageSize: 500 * 1024, // 500KB
  scriptSize: 300 * 1024, // 300KB
  cssSize: 100 * 1024, // 100KB

  // 性能指标限制
  metrics: {
    FCP: 1.8, // 秒
    LCP: 2.5, // 秒
    FID: 100, // 毫秒
    CLS: 0.1,
    TTI: 3.8, // 秒
  },

  // 资源数量限制
  resources: {
    images: 30,
    scripts: 10,
    stylesheets: 5,
  },
};

// 性能预算检查
function checkPerformanceBudget() {
  const resources = performance.getEntriesByType('resource');

  const totalSize = resources.reduce(
    (sum, r) => sum + (r.transferSize || 0),
    0
  );

  if (totalSize > performanceBudget.totalSize) {
    console.warn(`Total size ${totalSize} exceeds budget`);
  }
}
```

## 总结

性能优化的核心原则：

1. **测量优先** - 先测量，再优化
2. **关键渲染路径** - 优先优化首屏加载
3. **代码分割** - 按需加载，减少初始包大小
4. **图片优化** - 使用现代格式，实施懒加载
5. **缓存策略** - 充分利用浏览器缓存
6. **持续监控** - 建立性能监控体系

**性能优化带来的业务价值：**
- 页面加载速度提升 50% → 转化率提升 20%
- LCP 从 4秒降至 2秒 → SEO 排名提升
- 减少跳出率 → 用户停留时间增加

---

*发布于 2025-11-30 | 前端性能系列*

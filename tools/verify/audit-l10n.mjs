/**
 * tools/verify/audit-l10n.mjs —— 扫构建产物，列出 aria-label / title 的取值分布，
 * 挑出疑似英文残留。
 *
 * 为什么需要它：本地化这类「逐项列出」的工作，**按题修（发现一个改一个）的漏项率极高**，
 * 而且漏项不会报错 —— 它会一直安静地留在产物里，直到某天有人截图问「这里怎么是英文」。
 * 这个脚本的作用是**给出全集**：先把所有取值摊开，再逐项修。
 *
 * 本项目实际用它一次扫出 4 类每页都有的写死英文（各 ×20 / ×20 / ×492 / ×328），
 * 而前几轮逐条修时一条都没发现。详见 README「无障碍与本地化」与踩坑 21。
 *
 * 用法：
 *   node tools/verify/audit-l10n.mjs                    # 默认扫 docs/.vitepress/dist
 *   node tools/verify/audit-l10n.mjs path/to/dist
 *
 * 退出码：0 = 没有疑似残留；2 = 有（供 CI / 脚本判断）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { site } from '../../site.config.mjs'

const OUT = process.argv[2] || 'docs/.vitepress/dist'

/**
 * 只出现在类名 / 标识符 / 品牌里的词，出现次数再多也不是文案缺陷。
 *   - 站点品牌名从配置读，改名后这里自动跟随（不用手改白名单）
 *   - `github` 是主题拿**图标名**当无障碍名读出来的默认值，
 *     想更规范就配 site.config.mjs 的 socialLinks[].ariaLabel
 */
const IGNORE = new Set([site.name.toLowerCase(), 'github'])

/**
 * 这些 chunk 里装的是**文章内容**（标题 / 正文索引），不是 UI 文案。
 * 不排除的话，像 "Core Web Vitals" / "1. Stripe" 这类正文标题会淹没信号。
 */
const CONTENT_FILE = /@localSearchIndex/

/** 取值含 >=3 个连续 ASCII 字母且完全不含中文 → 疑似英文文案 */
const isSuspect = (v) => !IGNORE.has(v.toLowerCase())
  && /[A-Za-z]{3}/.test(v) && !/[\u4e00-\u9fff]/.test(v)

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(html|js)$/.test(e.name) && !CONTENT_FILE.test(e.name)) out.push(p)
  }
  return out
}

if (!fs.existsSync(OUT)) {
  console.error(`[audit-l10n] 目录不存在：${OUT}（先 npm run build:site）`)
  process.exit(1)
}

const files = walk(OUT)
console.log(`[audit-l10n] 扫描 ${files.length} 个产物文件：${OUT}`)

const counters = { 'aria-label': new Map(), title: new Map(), label: new Map() }
const ctx = new Map()

/*
 * ⚠️ 必须同时匹配**两种形态**，否则会漏掉整类文件：
 *
 *   HTML 属性：      aria-label="extra navigation"
 *   JS 对象键：      "aria-label":"mobile navigation"   ← 冒号，不是等号
 *   Vue 编译后的 prop： label: "extra navigation"        ← VPFlyout 把 label 渲染成 aria-label
 *
 * 第一版只写了 `aria-label="…"`（等号），结果扫不到 theme JS 里的任何一条 ——
 * 而「只改 HTML 不改 theme JS」正是本项目最危险的失败模式（hydration 会覆盖回英文）。
 * 这个是靠变异测试发现的：故意把产物里一处中文改回英文，脚本居然报「无疑似残留」。
 */
const KEY_RE = /["']?\b(aria-label|title|label)["']?\s*[:=]\s*["']([^"'\n]{1,60})["']/g

for (const p of files) {
  // ⚠️ 先把 `\"` 归一化成 `"` 再匹配：页面 chunk 里的 HTML 是 JSON 序列化的，
  // 不归一化的话整类文件都匹配不到（第一版就栽在这）。
  const s = fs.readFileSync(p, 'utf8').replaceAll('\\"', '"')
  for (const m of s.matchAll(KEY_RE)) {
    const kind = m[1]
    const v = m[2]
    if (v.startsWith('#') || v.startsWith('data-') || v.includes('${')) continue // 选择器 / 模板
    const c = counters[kind]
    c.set(v, (c.get(v) || 0) + 1)
    const key = `${kind}\u0000${v}`
    if (!ctx.has(key)) {
      ctx.set(key, `${path.basename(p)}  …${s.slice(Math.max(0, m.index - 70), m.index + 60)}…`)
    }
  }
}

let suspects = 0
for (const [kind, c] of Object.entries(counters)) {
  const sus = [...c.entries()].filter(([k]) => isSuspect(k)).sort((a, b) => b[1] - a[1])
  console.log(`\n=== ${kind} ===  取值共 ${c.size} 种，疑似英文残留 ${sus.length} 种`)
  for (const [k, n] of sus) {
    suspects += 1
    console.log(`  ${String(n).padStart(5)}  ${JSON.stringify(k)}`)
    console.log(`         ↳ ${ctx.get(`${kind}\u0000${k}`)}`)
  }
}

console.log('\n提示：只在 JS 里、HTML 里出现 0 次的默认值通常是被 themeConfig 覆盖掉的死代码，')
console.log('      不是缺陷 —— 判定方法是分别统计 HTML 与 JS 两侧的出现次数。')

console.log(`\n[audit-l10n] ${suspects === 0 ? '通过：无疑似英文残留' : `发现 ${suspects} 处疑似残留`}`)
process.exit(suspects === 0 ? 0 : 2)

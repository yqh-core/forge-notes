/**
 * scripts/localize-theme-aria.mjs —— 把主题里**写死的**英文 aria 文案换成中文
 *
 * ── 为什么要这么绕 ────────────────────────────────────────────────
 * VitePress 默认主题有几处文案是**字面量写死在组件里**的，`2.0.0-alpha.15`
 * 没有提供任何 themeConfig 开关能改它们（实测 grep 整个 theme-default 目录，
 * `navMenuLabel` / `mobileMenuLabel` / `extraMenuLabel` 这些官方文档提到的键
 * 在本版本的主题产物里根本没有被读取）：
 *
 *   VPNavBarMenu.vue            <span id="main-nav-aria-label">Main Navigation</span>
 *   VPSidebar.vue               <span id="sidebar-aria-label">Sidebar Navigation</span>
 *   VPDocFooter.vue             <span id="doc-footer-aria-label">Pager</span>
 *   VPSidebarItem.vue           <div role="button" aria-label="toggle section">
 *   VPNavBarExtra.vue           <button aria-label="extra navigation">（右上角「…」）
 *   VPNavBarHamburger.vue       <button aria-label="mobile navigation">（移动端汉堡）
 *   VPDocFooterLastUpdated.vue  「最后更新于⟨半角冒号⟩」中间那个分隔符（纯排版，不是英文残留）
 *
 * 除最后一条（分隔符，属排版）外，其余六条都是**读屏专用**：普通访客看不见，
 * 但读屏用户会听到。中文站点读出 "Main Navigation" / "Pager" 是真实的无障碍缺陷，不是洁癖。
 *
 * ── 什么时候**不该**用这个脚本（重要）──────────────────────────────
 * 字符串手术是**最后手段**。能走官方配置的一律走官方配置，理由不只是「更干净」：
 * 本脚本在**产物落盘之后**才动手，而渲染期配置（`markdown.codeCopyButtonTitle` /
 * `markdown.config`）在渲染时就生效，静态 HTML 与页面 chunk JS 会**同时**正确。
 * 也就是说：
 *
 *   走 markdown 配置（渲染期） → 天然无 hydration 风险，改一次全对
 *   走本脚本（构建后）         → 必须保证 HTML 与 JS 两侧都命中，否则半成品
 *
 * 所以 `Copy Code`（代码块复制按钮）和 `Permalink to “标题”`（标题锚点）
 * **不在这里**，它们由 docs/.vitepress/config.mjs 的 markdown 配置处理。
 * 每次想往 RULES 里加规则前先问一句：有没有官方配置键？
 *
 * 既然没有配置开关，就在构建完成后对产物做一次精确替换。
 * 文案仍然取自 site.config.mjs（ui.hardcodedAria），维持「单一配置源」约束 ——
 * 这个脚本里不出现任何可改的品牌文案。
 *
 * ── 为什么必须同时改 HTML 和 JS（重要）────────────────────────────
 * 同一个字符串在产物里出现**两次**，位置不同、必须都改：
 *
 *   1. 静态 HTML：SSG 渲染出的 <span ...> Main Navigation </span>
 *   2. theme.*.js：组件编译后的渲染函数里的字符串字面量 " Main Navigation "
 *
 * 只改 HTML 是不够的 —— 页面加载后 Vue 会做 hydration。若 HTML 说中文、
 * JS 说英文，两者对不上，Vue 会按 JS 的值修正 DOM，中文被覆盖回英文。
 * 也就是说「只改 HTML」的版本在首屏看似正确、**hydration 之后就变回英文**，
 * 而且不会有任何报错。所以两边一起改，让 hydration 前后完全一致。
 *
 * ── ⚠️ 匹配式必须「形态无关」（这里踩过一个静默失效的坑）──────────
 * 产物有两种形态，同一个字面量的**空白写法完全不同**：
 *
 *   DEBUG=1 构建（验证脚本用它跳过 .temp 清理）→ **不压缩**，跨行缩进：
 *       id: "doc-footer-aria-label"
 *                 }, "Pager", -1)),
 *       … || "Last updated") + ": ", 1),
 *   普通/线上构建（无 DEBUG）→ 压成一行：
 *       id:"doc-footer-aria-label"},"Pager",-1)
 *
 * 依据是 vitepress 源码里这一行：
 *   `minify: ssr ? !!config.mpa : options.minify ?? !process.env.DEBUG`
 * 也就是 **DEBUG 有值就不压缩**。验证脚本为了绕开沙箱的批量删除拦截一直在用
 * DEBUG=1，于是「验证时跑的产物」和「线上发的产物」形态根本不同。
 *
 * 第一版的 JS 匹配式是照着压缩形态写的（`(?<="doc-footer-aria-label"\},)"Pager"`
 * 要求 `}` 紧跟同行、`\+": ",1\)` 要求没有空格），结果：
 *   压缩产物 → 正常替换；
 *   未压缩产物 → **静默不匹配** → HTML 改成中文、JS 还是英文
 *                → hydration 之后又被改回英文，且全程不报错。
 * 更糟的是脚本当时只看「这条规则总共命中几处」：HTML 命中了就记成功，
 * 日志一片绿 —— 半成品被当成完成品。所以现在同时做两件事：
 *   1. 匹配式一律用 \s* 容忍空白，**不假设压缩与否**；
 *   2. 每条规则**分通道统计**（HTML / JS），只命中一侧就告警。
 *
 * ── 为什么不做成 Vite 插件 ────────────────────────────────────────
 * VitePress 的页面落盘发生在 vite build **之后**（它先跑完 rollup 再渲染写盘），
 * 所以插件的 closeBundle 钩子执行时 HTML 还没生成，挂在那里会静默不生效。
 * 挂在 build:site 之后当独立步骤，顺序是确定的。
 *
 * ── 失效保护 ──────────────────────────────────────────────────────
 * 上游改文案是可能的（升级 VitePress 时）。届时替换会匹配不到 —— 那正是
 * 「静默失效」的经典场景。所以这里对每条规则统计命中数：
 *   - 英文在、中文不在   → 执行替换
 *   - 中文已在、英文不在 → 已本地化，静默通过（保证脚本可重复执行）
 *   - 两者都不在         → required:true 的规则**告警**；required:false 的只提示
 *   - 只在 HTML 或只在 JS 命中 → **告警**（半成品，hydration 会把中文覆盖回去）
 * 告警不中断构建：aria 文案是装饰性缺陷，不值得让一次正常部署失败。
 * 真正的把关交给验证脚本 —— tools/verify/verify-config.sh 与 verify.js
 * 都断言了「中文在、英文不在」，且 verify.js 是在**真实浏览器 hydration 之后**
 * 读的 DOM，能抓到「只改了 HTML、被 hydration 覆盖回去」这种半成品状态。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { site } from '../site.config.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 与 docs/.vitepress/config.mjs 保持完全相同的解析规则：
// 有 VITE_OUT_DIR 就用它（验证脚本靠这个让多次构建各写各的目录），
// 否则用 VitePress 默认产物目录。
const outDir = process.env.VITE_OUT_DIR
  ? path.resolve(projectRoot, process.env.VITE_OUT_DIR)
  : path.join(projectRoot, 'docs/.vitepress/dist')

const aria = site.ui.hardcodedAria
const sep = site.ui.lastUpdatedSeparator

/**
 * 替换规则：每条同时给出 HTML 形态与 JS 形态的匹配式。
 *
 * 用正则而不是固定字符串，是因为两边的空白处理不同：
 *   - HTML：Vue 模板编译把 span 内的换行缩进压成**单个空格** → "> Main Navigation <"
 *   - JS  ：渲染函数里的字符串字面量保留**首尾空格**       → "\" Main Navigation \""
 * 用 \s* 把两种形态一起兜住，升级后压法变了也不至于失效。
 *
 * ⚠️ `chinese` 一律写**裸文案**（不带引号）：HTML 分支直接用，
 * JS 分支由代码统一 JSON.stringify 补引号。手写引号是上面那个
 * 「`},主导航,-1)`」事故的来源，不要再那么干。
 */
const RULES = [
  {
    key: 'mainNav',
    label: '主导航（导航栏 aria-labelledby 目标）',
    source: 'VPNavBarMenu.vue',
    chinese: aria.mainNav,
    /** 判断「已本地化」用的裸中文串，见下方 already 逻辑 */
    probe: aria.mainNav,
    english: 'Main Navigation',
    htmlMatch: /(?<=main-nav-aria-label[^>]*>)\s*Main Navigation\s*(?=<\/span>)/g,
    jsMatch: /"\s*Main Navigation\s*"/g,
    required: true,
    bothChannels: true,
  },
  {
    key: 'sidebarNav',
    label: '侧边栏导航（侧栏 aria-labelledby 目标）',
    source: 'VPSidebar.vue',
    chinese: aria.sidebarNav,
    probe: aria.sidebarNav,
    english: 'Sidebar Navigation',
    htmlMatch: /(?<=sidebar-aria-label[^>]*>)\s*Sidebar Navigation\s*(?=<\/span>)/g,
    jsMatch: /"\s*Sidebar Navigation\s*"/g,
    required: true,
    bothChannels: true,
  },
  {
    key: 'docFooter',
    label: '翻页导航（上一篇/下一篇 aria-labelledby 目标）',
    source: 'VPDocFooter.vue',
    chinese: aria.docFooter,
    probe: aria.docFooter,
    english: 'Pager',
    htmlMatch: /(?<=doc-footer-aria-label[^>]*>)\s*Pager\s*(?=<\/span>)/g,
    /*
     * JS：`"Pager"` 是 createBaseVNode 的第三个参数，紧跟在 props 对象后面。
     * 用 `id:"doc-footer-aria-label"` 卡住位置，避免误伤别处的 "Pager"。
     *
     * ⚠️ `\s*` 一个都不能省 —— 未压缩产物在这里是**跨行**的：
     *      id: "doc-footer-aria-label"
     *                }, "Pager", -1)),
     * 去掉 \s* 就只适配压缩形态，未压缩产物上会静默不匹配（踩过，见文件头说明）。
     */
    jsMatch: /(?<="doc-footer-aria-label"\s*\}\s*,\s*)"Pager"/g,
    required: true,
    bothChannels: true,
  },
  {
    key: 'lastUpdatedSeparator',
    label: '「最后更新于」的分隔符（排版：半角 → 全角）',
    source: 'VPDocFooterLastUpdated.vue',
    chinese: sep,
    // 探针必须带上下文，不能只写「：」——正文里本来就有全角冒号，
    // 用裸串判断会让第一次构建就误判成「已本地化」，替换永远不执行且不报错。
    probe: /：\s*(?=<time)/,
    jsProbe: /\+"：",1\)/,
    english: '": "',
    /*
     * ⚠️ 这条与前三条不同：它不是「英文残留」，是**排版**。
     * 换掉的是文本节点与日期之间的分隔符，所以匹配式要卡住位置、不能误伤别处：
     *   HTML：`: <time` —— 实测全产物 `<time>` 共 17 个，全部紧跟在 `: ` 之后，
     *         所以这个模式只会命中「最后更新于」这一处。
     *   JS  ：渲染函数里是 `… || "Last updated") + ": ", 1)`
     *         —— 压缩形态 `)+": ",1)`、未压缩形态 `) + ": ", 1)`。
     *         所以 `\s*` 必须同时兜住两种；替换值统一写成压缩形态，语义等价。
     * 两条都在每次运行时由 verify-config.sh 的断言兜底，上游变了会立刻暴露。
     */
    htmlMatch: /:\s*(?=<time)/g,
    jsMatch: /\+\s*": "\s*,\s*1\)/g,
    jsReplacer: () => `+"${sep}",1)`,
    required: true,
    bothChannels: true,
  },
  {
    key: 'toggleSection',
    label: '分组折叠按钮（caret 的 aria-label）',
    source: 'VPSidebarItem.vue',
    chinese: `aria-label="${aria.toggleSection}"`,
    probe: aria.toggleSection,
    english: 'toggle section',
    htmlMatch: /aria-label="toggle section"/g,
    // JS 里是对象字面量的值：role:"button","aria-label":"toggle section"
    jsMatch: /"aria-label"\s*:\s*"toggle section"/g,
    jsReplacer: () => `"aria-label":"${aria.toggleSection}"`,
    // 只在「分组设了 collapsed 且含子项」时才渲染。本站侧边栏目前没有可折叠组，
    // 所以 HTML 里命中数为 0 是正常的，不能算异常（但 JS 里始终存在这个字面量）。
    required: false,
  },
  {
    key: 'extraNav',
    label: '右上角「…」按钮（VPFlyout 的 aria-label）',
    source: 'VPNavBarExtra.vue',
    chinese: `aria-label="${aria.extraNav}"`,
    /*
     * ⚠️ 探针必须**带上下文**，不能用裸中文「更多」——
     * 实测产物里文章正文本来就出现过 12 次「更多」，
     * 用裸串判断会让第一次构建就被误判成「已本地化」，
     * 替换永远不执行且不报错（同 lastUpdatedSeparator 那条的坑）。
     */
    probe: /aria-label="更多"/,
    jsProbe: /label\s*:\s*"更多"/,
    english: 'extra navigation',
    htmlMatch: /aria-label="extra navigation"/g,
    // VPFlyout 是 :aria-label="label"，所以 JS 侧要改的是**传进去的 prop 值**，
    // 形态 `label:"extra navigation"`（未压缩是 `label: "extra navigation"`）。
    jsMatch: /label\s*:\s*"extra navigation"/g,
    jsReplacer: () => `label:"${aria.extraNav}"`,
    required: true,
    bothChannels: true,
  },
  {
    key: 'mobileNav',
    label: '移动端汉堡菜单按钮（aria-label）',
    source: 'VPNavBarHamburger.vue',
    chinese: `aria-label="${aria.mobileNav}"`,
    probe: /aria-label="移动端导航"/,
    jsProbe: /"aria-label"\s*:\s*"移动端导航"/,
    english: 'mobile navigation',
    htmlMatch: /aria-label="mobile navigation"/g,
    jsMatch: /"aria-label"\s*:\s*"mobile navigation"/g,
    jsReplacer: () => `"aria-label":"${aria.mobileNav}"`,
    required: true,
    bothChannels: true,
  },
]

/** 递归收集 outDir 下所有目标文件 */
function collect(dir, exts, acc = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, exts, acc)
    else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) acc.push(full)
  }
  return acc
}

function main() {
  if (!fs.existsSync(outDir)) {
    console.error(`[localize-aria] 产物目录不存在：${outDir}`)
    console.error('[localize-aria] 请确认先跑过 build:site（本脚本必须在其之后执行）')
    process.exit(1)
  }

  // JS 只扫产物根下的 assets/：站点自己的业务代码里不该出现这几个主题字面量，
  // 限制范围可以避免误伤（例如文章正文里恰好有 "toggle section" 这种词）。
  const htmlFiles = collect(outDir, ['.html'])
  const assetsDir = path.join(outDir, 'assets')
  const jsFiles = fs.existsSync(assetsDir) ? collect(assetsDir, ['.js']) : []
  const files = [...htmlFiles, ...jsFiles]

  // 分通道统计：n/files 是合计，html/js 是各自命中数。
  // 拆开是为了能识别「只改了一侧」的半成品 —— 见文件头「形态无关」那节。
  const replaced = new Map(RULES.map((r) => [r.key, { n: 0, files: 0, html: 0, js: 0 }]))
  const already = new Map(RULES.map((r) => [r.key, 0]))

  for (const file of files) {
    const isJs = file.endsWith('.js') && file.startsWith(assetsDir)
    const original = fs.readFileSync(file, 'utf8')
    let next = original

    for (const rule of RULES) {
      const match = isJs ? rule.jsMatch : rule.htmlMatch
      if (!match) continue

      // ⚠️ JS 侧的替换值必须**带引号**。
      //
      // 这里踩过一个要命的坑：jsMatch 是连引号一起匹配的（/" Main Navigation "/），
      // 但替换值当时给的是裸中文 → 产物里变成 `},主导航,-1)`。
      // 中文在 JS 里是**合法的标识符字符**，所以 `node --check` **照样通过**；
      // 运行时它是个未定义变量 → 渲染抛 ReferenceError → 整个导航栏子树崩掉。
      // 静态检查全绿、页面白给 —— 典型的「语法对了不等于语义对了」。
      //
      // 所以非 HTML 分支统一用 JSON.stringify 生成带引号的字面量，
      // 规则表里只写裸文案，不再手写引号。
      const replacement = isJs
        ? rule.jsReplacer
          ? rule.jsReplacer()
          : JSON.stringify(rule.chinese)
        : rule.chinese

      /*
       * 「已经处理过」判定（保证脚本可重复执行）。
       *
       * probe 支持字符串与**非全局**正则两种形态：
       *   - 字符串 `includes`：适合「中文短语」这种基本不会出现在正文里的探针；
       *   - 正则 `test`：适合**单个字符**的探针。
       *
       * 为什么需要正则：分隔符那条规则的探针是「：」—— 而正文里本来就可能有
       * 全角冒号，一旦用 includes 判断，第一次构建就会被误判成「已本地化」，
       * 替换**永远不执行**，而且不报错。所以它必须连上下文一起卡住（`：<time`）。
       */
      const probe = isJs ? rule.jsProbe ?? rule.probe : rule.probe
      const done = probe instanceof RegExp ? probe.test(next) : next.includes(probe)
      if (done) {
        already.set(rule.key, already.get(rule.key) + 1)
        continue
      }

      match.lastIndex = 0
      const found = next.match(match)
      if (!found || found.length === 0) continue

      match.lastIndex = 0
      next = next.replace(match, replacement)
      const s = replaced.get(rule.key)
      s.n += found.length
      s.files += 1
      s[isJs ? 'js' : 'html'] += found.length
    }

    /*
     * JS 补丁的安全不变式：替换只换字符串**内容**，不该改变双引号的数量。
     *
     * 这条是被上面那个 bug 逼出来的。少一个引号 = 字符串字面量退化成裸标识符；
     * 中文是合法的 JS 标识符字符，所以 `node --check` 查不出来，
     * 只有真正渲染到那个组件时才会抛 ReferenceError。
     * 与其指望下次也恰好被浏览器测试逮住，不如在这里直接卡死：宁可构建失败，
     * 也不要把一个「静态检查全绿、运行时白屏」的产物发出去。
     */
    if (isJs && next !== original) {
      const before = (original.match(/"/g) || []).length
      const after = (next.match(/"/g) || []).length
      if (before !== after) {
        console.error(
          `[localize-aria] ✗ 中止：引号数量被改变（${before} → ${after}）\n` +
            `      文件：${path.relative(projectRoot, file)}\n` +
            '      替换破坏了字符串字面量，产物在运行时会抛 ReferenceError。本次未写入。',
        )
        process.exit(1)
      }
    }

    if (next !== original) fs.writeFileSync(file, next)
  }

  // ---------------- 结果汇报 ----------------
  console.log(
    `[localize-aria] 扫描 ${htmlFiles.length} 个 HTML + ${jsFiles.length} 个 JS` +
      `（${path.relative(projectRoot, outDir)}）`,
  )

  let warned = 0
  for (const rule of RULES) {
    const s = replaced.get(rule.key)
    const done = already.get(rule.key)
    if (s.n > 0) {
      console.log(
        `  ✅ ${rule.label}：替换 ${s.n} 处 / ${s.files} 个文件 → 「${rule.chinese}」` +
          `（HTML ${s.html} / JS ${s.js}）`,
      )
      /*
       * 半成品检测：两侧必须都改到。
       *
       * 只改 HTML 的产物「首屏看着是对的」—— 静态 HTML 已经是中文了，
       * 但 hydration 会按 theme JS 里的值把中文覆盖回原文，而且不报错。
       * 命中了一侧、另一侧 0 处，几乎只能是匹配式不适配当前产物形态
       * （压缩 vs 未压缩，见文件头）。这种情况必须在构建时就喊出来。
       */
      if (rule.bothChannels && (s.html === 0 || s.js === 0)) {
        warned += 1
        console.warn(
          `  ⚠️  ${rule.label}：只替换了 ${s.html > 0 ? 'HTML' : 'JS'} 一侧，另一侧 0 处命中。\n` +
            '      两侧必须同时改 —— 只改 HTML 会在 hydration 之后被 theme JS 覆盖回原文，且不报错。\n' +
            '      多半是匹配式只适配了「压缩」或「未压缩」其中一种产物形态\n' +
            `      （DEBUG=1 构建不压缩、线上构建压缩），请核对「${rule.english}」的两种写法。`,
        )
      }
    } else if (done > 0) {
      console.log(`  ✅ ${rule.label}：已就位（${done} 个文件命中，无需改动）`)
    } else if (rule.required) {
      warned += 1
      console.warn(
        `  ⚠️  ${rule.label}：**没有匹配到**「${rule.english}」。\n` +
          `      主题源码是 ${rule.source}，上游可能改了模板 —— 请核对后更新本脚本的匹配式。\n` +
          `      （当前站点上这处文案仍会保持英文/半角。）`,
      )
    } else {
      console.log(`  ○  ${rule.label}：HTML 中未出现（该元素在本站不渲染，属正常）`)
    }
  }

  console.log(warned > 0 ? `[localize-aria] 完成，但有 ${warned} 条规则未命中 —— 见上面的 ⚠️` : '[localize-aria] 完成')
  // 刻意不因告警而失败：aria 文案是装饰性缺陷，不该阻断部署。
  // 回归拦截由 tools/verify 里的断言负责。
}

main()

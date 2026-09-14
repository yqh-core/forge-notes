#!/usr/bin/env node
/**
 * tools/verify/verify-localize-shapes.mjs —— 「构建后替换」的**形态回归测试**
 *
 * ── 为什么需要这个脚本 ──────────────────────────────────────────────
 * scripts/localize-theme-aria.mjs 做的是「对产物做字符串手术」，而同一份源码
 * 会产出**两种空白形态**的产物：
 *
 *   未压缩（DEBUG=1 构建，验证脚本用的那种）
 *       id: "doc-footer-aria-label"
 *                 }, "Pager", -1)),
 *       … || "Last updated") + ": ", 1),
 *   压缩（普通构建 = 线上）
 *       id:"doc-footer-aria-label"},"Pager",-1)
 *       …+"：",1)
 *
 * 依据：vitepress 源码 `minify: ssr ? !!config.mpa : options.minify ?? !process.env.DEBUG`。
 *
 * 这里出过一次**静默的半成品事故**：第一版 JS 匹配式照着压缩形态写
 * （`(?<="doc-footer-aria-label"\},)"Pager"` 要求 `}` 同行；`\+": ",1\)` 要求无空格），
 * 结果压缩产物上正常、未压缩产物上不匹配 → HTML 改了、JS 没改 →
 * hydration 之后中文又被覆盖回英文，全程不报错。而且脚本当时只看「规则总命中数」，
 * HTML 命中就算成功，日志一片绿。
 *
 * 所以这个脚本存在，专门钉住「两种形态都必须被替换」：
 *   - 不需要构建（毫秒级），因此可以每次都跑；
 *   - 与真实产物的差别只有「文件更小」，形态是**从真实产物里抄下来的原文**；
 *   - 断言落在**最终文件内容**上：JS 里必须出现中文、且不能残留英文。
 *     这正是当初被违反的那条不变式。
 *
 * 退出码 0 = 两种形态都通过。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { site } from '../../site.config.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const localizer = path.join(projectRoot, 'scripts/localize-theme-aria.mjs')
const aria = site.ui.hardcodedAria
const sep = site.ui.lastUpdatedSeparator

const OUT_ROOT = path.join(projectRoot, 'tools/verify/.out')

let failed = 0
const ok = (msg) => console.log(`  [PASS] ${msg}`)
const bad = (msg) => {
  failed += 1
  console.log(`  [FAIL] ${msg}`)
}

/**
 * 两种形态的产物片段。
 *
 * ⚠️ 这些字符串是从**真实产物**里抄下来的（压缩形态抄自 docs/.vitepress/dist 的
 * theme.*.js，未压缩形态抄自 DEBUG=1 构建的 theme.*.js），不是照着自己的正则编的 ——
 * 否则测试只会证明「我写的东西符合我的想象」。
 */
const VARIANTS = {
  minified: {
    label: '压缩形态（= 线上构建）',
    js: [
      'const a=v("span",{id:"main-nav-aria-label",class:"visually-hidden"},"Main Navigation",-1);',
      'const b=v("span",{class:"visually-hidden",id:"sidebar-aria-label"},"Sidebar Navigation",-1);',
      'const c=v("span",{class:"visually-hidden",id:"doc-footer-aria-label"},"Pager",-1);',
      'const d=v("div",{role:"button","aria-label":"toggle section"});',
      'const e=G(S(i(t).lastUpdated?.text||i(t).lastUpdatedText||"Last updated")+": ",1),v("time",{r:1});',
      'const f=v(_e,{key:0,class:"VPNavBarExtra",label:"extra navigation"},{default:f(()=>[])});',
      'const g=u("button",{type:"button",class:T(["VPNavBarHamburger",{active:e.active}]),"aria-label":"mobile navigation","aria-expanded":e.active});',
    ].join('\n'),
  },
  pretty: {
    label: '未压缩形态（= DEBUG=1 构建）',
    js: [
      'const a = createElementVNode("span", {',
      '  id: "main-nav-aria-label",',
      '  class: "visually-hidden"',
      '}, "Main Navigation", -1);',
      'const b = createBaseVNode("span", {',
      '  class: "visually-hidden",',
      '  id: "sidebar-aria-label"',
      '}, "Sidebar Navigation", -1);',
      'const c = createBaseVNode("span", {',
      '  class: "visually-hidden",',
      '  id: "doc-footer-aria-label"',
      '}, "Pager", -1);',
      'const d = createBaseVNode("div", {',
      '  role: "button",',
      '  "aria-label": "toggle section"',
      '}, null, -1);',
      'const e = createTextVNode(toDisplayString(unref(theme2).lastUpdated?.text || unref(theme2).lastUpdatedText || "Last updated") + ": ", 1);',
      // 注意这两条的真实形态差异：extraNav 在 JS 侧是 **prop 值** `label:` 而不是
      // `aria-label`（组件收到 label 后再渲染成 aria-label），mobileNav 才是 aria-label。
      'const f = createBlock(VPFlyout, {',
      '  key: 0,',
      '  class: "VPNavBarExtra",',
      '  label: "extra navigation"',
      '}, { default: () => [] });',
      'const g = createElementBlock("button", {',
      '  type: "button",',
      '  class: normalizeClass(["VPNavBarHamburger", { active: __props.active }]),',
      '  "aria-label": "mobile navigation",',
      '  "aria-expanded": __props.active',
      '}, null, -1);',
    ].join('\n'),
  },
}

/** HTML 侧：与真实 SSG 产物同形（这里是压缩后的样子，两种构建都一样） */
const HTML_FIXTURE = [
  '<nav aria-labelledby="main-nav-aria-label"><span id="main-nav-aria-label" class="visually-hidden">Main Navigation</span></nav>',
  '<span class="visually-hidden" id="sidebar-aria-label">Sidebar Navigation</span>',
  '<span class="visually-hidden" id="doc-footer-aria-label">Pager</span>',
  '<button aria-label="toggle section">分组</button>',
  `<p class="VPLastUpdated">最后更新于: <time datetime="2025-11-30T00:00:00.000Z">2025年11月30日</time></p>`,
  // HTML 侧两条都是 aria-label（与 JS 侧的 extraNav 是 label: 不同，见上）
  '<button type="button" class="button" aria-haspopup="true" aria-expanded="false" aria-label="extra navigation" data-v-42cb505d>',
  '<button type="button" class="VPNavBarHamburger hamburger" aria-label="mobile navigation" aria-expanded="false" aria-controls="VPNavScreen" data-v-70946a35>',
].join('\n')

function buildFixture(variant) {
  const dir = path.join(OUT_ROOT, `localize-shapes-${variant}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'assets/chunks'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'post.html'), HTML_FIXTURE)
  fs.writeFileSync(path.join(dir, 'assets/chunks/theme.fixture.js'), VARIANTS[variant].js)
  return dir
}

function run() {
  console.log('[localize-shapes] 形态回归：同一套规则必须同时适配压缩与未压缩产物')
  fs.mkdirSync(OUT_ROOT, { recursive: true })

  for (const variant of Object.keys(VARIANTS)) {
    const { label } = VARIANTS[variant]
    const dir = buildFixture(variant)
    const jsFile = path.join(dir, 'assets/chunks/theme.fixture.js')
    const htmlFile = path.join(dir, 'post.html')

    // 用与 build:site 完全相同的方式调用（VITE_OUT_DIR 决定扫哪个目录）
    const res = spawnSync(process.execPath, [localizer], {
      cwd: projectRoot,
      env: { ...process.env, VITE_OUT_DIR: path.relative(projectRoot, dir) },
      encoding: 'utf8',
    })
    const log = `${res.stdout || ''}${res.stderr || ''}`

    if (res.status !== 0) {
      bad(`${label}：替换脚本以非 0 退出（${res.status}）\n${log}`)
      continue
    }
    // 替换脚本自己报的两侧命中数，也要是两侧都非 0
    if (log.includes('⚠️')) {
      bad(`${label}：替换脚本发出了告警（说明有规则只命中一侧或完全没命中）\n${log}`)
    } else {
      ok(`${label}：替换脚本无告警`)
    }

    const js = fs.readFileSync(jsFile, 'utf8')
    const html = fs.readFileSync(htmlFile, 'utf8')

    /*
     * 断言落在「最终文件内容」上 —— 这是当年真正被违反的不变式：
     * HTML 改了、JS 没改。所以两侧分别断言「英文没了 + 中文在」。
     */
    const jsChecks = [
      ['JS 无 Main Navigation 残留', !js.includes('Main Navigation')],
      ['JS 无 Sidebar Navigation 残留', !js.includes('Sidebar Navigation')],
      ['JS 无 Pager 残留', !js.includes('Pager')],
      ['JS 无 toggle section 残留', !js.includes('toggle section')],
      ['JS 无 extra navigation 残留', !js.includes('extra navigation')],
      ['JS 无 mobile navigation 残留', !js.includes('mobile navigation')],
      ['JS 无半角分隔符残留（": " 未替换）', !/\+\s*": "\s*,\s*1\)/.test(js)],
      ['JS 已写入主导航', js.includes(aria.mainNav)],
      ['JS 已写入侧边栏导航', js.includes(aria.sidebarNav)],
      ['JS 已写入翻页导航', js.includes(aria.docFooter)],
      ['JS 已写入更多', js.includes(aria.extraNav)],
      ['JS 已写入移动端导航', js.includes(aria.mobileNav)],
      [`JS 已写入全角分隔符 ${sep}`, /\+\s*"："/.test(js)],
      ['JS 引号数量未变（防止字符串字面量退化成裸标识符）', (js.match(/"/g) || []).length % 2 === 0],
    ]
    for (const [name, pass] of jsChecks) {
      if (pass) ok(`${label}：${name}`)
      else bad(`${label}：${name}`)
    }

    const htmlChecks = [
      ['HTML 无 Main Navigation 残留', !html.includes('Main Navigation')],
      ['HTML 无 Sidebar Navigation 残留', !html.includes('Sidebar Navigation')],
      ['HTML 无 Pager 残留', !html.includes('Pager')],
      ['HTML 无 extra navigation 残留', !html.includes('extra navigation')],
      ['HTML 无 mobile navigation 残留', !html.includes('mobile navigation')],
      ['HTML 已写入更多（aria-label）', html.includes(`aria-label="${aria.extraNav}"`)],
      ['HTML 已写入移动端导航（aria-label）', html.includes(`aria-label="${aria.mobileNav}"`)],
      [`HTML 的「最后更新于」分隔符已换为全角 ${sep}`, html.includes(`${sep}<time`)],
      ['HTML 无半角分隔符残留', !/: <time/.test(html)],
    ]
    for (const [name, pass] of htmlChecks) {
      if (pass) ok(`${label}：${name}`)
      else bad(`${label}：${name}`)
    }

    // 幂等：再跑一次不应再改动任何字节
    const before = fs.readFileSync(jsFile, 'utf8')
    spawnSync(process.execPath, [localizer], {
      cwd: projectRoot,
      env: { ...process.env, VITE_OUT_DIR: path.relative(projectRoot, dir) },
      encoding: 'utf8',
    })
    const after = fs.readFileSync(jsFile, 'utf8')
    if (before === after) ok(`${label}：可重复执行（第二次运行未改动产物）`)
    else bad(`${label}：第二次运行仍在改动产物 —— 幂等性被破坏`)

    fs.rmSync(dir, { recursive: true, force: true })
  }

  console.log(failed === 0 ? '[localize-shapes] 通过' : `[localize-shapes] 存在 ${failed} 个失败`)
  process.exit(failed === 0 ? 0 : 1)
}

run()

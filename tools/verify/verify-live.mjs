/**
 * 线上真机验收（默认针对 https://forge-notes.pages.dev）
 *
 * 与其它三层验证的分工：
 *   verify.js                 L1 站点 + L2 嵌入组件，服务本地 dist —— 验「源码能否正确构建」
 *   verify-config.sh          架构与配置一致性 —— 验「配置与产物对不对得上」
 *   verify-deploy-modes.mjs   两种 base 的真实挂载 —— 验「部署形态是否成立」
 *   verify-live.mjs（本文件） **已部署的线上产物** —— 验「推上去之后是否真的对用户生效」
 *
 * 为什么线上还要单独验一次：本项目踩过「hydration 覆盖」的坑（README 踩坑 17）。
 * 构建后替换脚本同时改 HTML 与 theme JS，只改一侧的话静态 HTML 是对的、但浏览器
 * 一 hydrate 就被 JS 里的英文覆盖回去，而且**不报任何错**。所以线上必须用真实
 * 浏览器读到 hydration 之后的 DOM 才算数 —— 光 grep 产物文件不够。
 *
 * 用法：
 *   node tools/verify/verify-live.mjs                # 直接验当前线上
 *   BASE=https://xxx.pages.dev node tools/verify/verify-live.mjs
 *   OLD_THEME=theme.abc123.js node tools/verify/verify-live.mjs   # 先等新构建上线再验
 *
 * 退出码：0 = 全绿；1 = 有失败项。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BASE = (process.env.BASE || 'https://forge-notes.pages.dev').replace(/\/$/, '')
const ARTICLE = process.env.ARTICLE || '/posts/adsense-application-complete-guide'
// 给了 OLD_THEME 就先轮询等新构建上线（hash 变了才继续），不给自己就立刻开验。
const OLD_THEME = process.env.OLD_THEME || ''
const PORT_CDP = Number(process.env.PORT_CDP || 9444)
const SHOT_DIR = path.join(ROOT, '.verify')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const checks = []
function check(name, pass, detail = '') {
  checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + String(detail).slice(0, 160) : ''}`)
}

/* ---------------------------- ① 产物层 ---------------------------- */

async function fetchThemeChunk() {
  for (let i = 1; i <= 40; i++) {
    let html = ''
    try {
      html = await (await fetch(`${BASE}/`, { redirect: 'follow' })).text()
    } catch (e) {
      console.log(`  第 ${i} 次：请求失败 ${e.message}`)
      await sleep(15000)
      continue
    }
    const m = html.match(/assets\/chunks\/theme\.[A-Za-z0-9_-]+\.js/)
    if (!m) {
      console.log(`  第 ${i} 次：首页未引用 theme chunk（可能构建中或页面结构变了）`)
      await sleep(15000)
      continue
    }
    const name = path.basename(m[0])
    if (!OLD_THEME || name !== OLD_THEME) {
      if (OLD_THEME) console.log(`  第 ${i} 次：已更新 → ${name}`)
      return name
    }
    console.log(`  第 ${i} 次：仍是 ${name}（等待新构建）`)
    await sleep(15000)
  }
  return null
}

function markers(text, list, label) {
  console.log(`\n  ── ${label} ──`)
  for (const [mark, shouldExist, readable] of list) {
    const n = text.split(mark).length - 1
    check(readable, shouldExist ? n > 0 : n === 0, `"${mark}" 出现 ${n} 次`)
  }
}

async function artifactLayer(themeChunk) {
  console.log(`\n== ① 产物层（线上静态文件）==`)

  const js = await (await fetch(`${BASE}/assets/chunks/${themeChunk}`)).text()
  console.log(`  theme chunk: ${themeChunk}（${js.length} 字节，${js.split('\n').length} 行）`)
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  fs.writeFileSync(path.join(SHOT_DIR, 'live-theme-after.js'), js)

  // 正向 = 中文必须在；反向 = 英文必须不在。
  // 只有单侧会假绿：英文还在但中文也在了（替换了一部分），或中文在但英文也在（hydration 会覆盖）。
  markers(
    js,
    [
      ['翻页导航', true, 'theme JS 已本地化「翻页导航」'],
      ['"Pager"', false, 'theme JS 无 Pager 残留'],
      ['主导航', true, 'theme JS 已本地化「主导航」'],
      ['Main Navigation', false, 'theme JS 无 Main Navigation 残留'],
      ['侧边栏导航', true, 'theme JS 已本地化「侧边栏导航」'],
      ['Sidebar Navigation', false, 'theme JS 无 Sidebar Navigation 残留'],
      ['toggle section', false, 'theme JS 无 toggle section 残留'],
      ['"：",1)', true, 'theme JS 日期分隔符已换为全角'],
      ['": ",1)', false, 'theme JS 日期分隔符无半角残留'],
    ],
    '线上 theme chunk 标记核对',
  )

  const art = await (await fetch(BASE + ARTICLE)).text()
  fs.writeFileSync(path.join(SHOT_DIR, 'live-article-after.html'), art)
  console.log(`\n  文章页: ${ARTICLE}（${art.length} 字节）`)
  check('文章页 HTML 用全角冒号连接「最后更新于」', /最后更新于：\s*<time/.test(art),
    (art.match(/最后更新于.{0,6}/) || ['未找到'])[0])
  check('文章页 HTML 无半角冒号残留', !/最后更新于:\s*<time/.test(art))
  check('文章页 HTML 翻页导航已本地化', art.includes('翻页导航'))
  check('文章页 HTML 无 Pager 残留', !art.includes('Pager'))
}

/* ---------------------------- ② 渲染层 ---------------------------- */

async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
  })
  let seq = 0
  const pending = new Map()
  const listeners = []
  ws.addEventListener('message', (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method) {
      for (const fn of listeners) fn(msg)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时: ${method}`)) }
      }, 30000)
    })
  return { send, on: (fn) => listeners.push(fn), close: () => ws.close() }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('页面内异常: ' + (r.exceptionDetails.text || ''))
  return r.result?.value
}

function findChrome() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p))
}

async function renderLayer() {
  console.log(`\n== ② 渲染层（真实浏览器 + CDP，读 hydration 之后的 DOM）==`)
  const chromePath = findChrome()
  if (!chromePath) { check('找到 Chrome/Edge 可执行文件', false); return }
  console.log(`  浏览器: ${chromePath}`)

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-live-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1440,900',
    `--remote-debugging-port=${PORT_CDP}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' })

  let cdp
  try {
    let wsUrl = null
    for (let i = 0; i < 60; i++) {
      try {
        const list = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`).then((r) => r.json())
        const page = list.find((t) => t.type === 'page')
        if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break }
      } catch { /* 还没起来 */ }
      await sleep(300)
    }
    if (!wsUrl) throw new Error('无法连接浏览器调试端口')

    cdp = await connectCDP(wsUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })

    const consoleErrors = []
    cdp.on((msg) => {
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        const e = msg.params.entry
        consoleErrors.push(`${e.text} @ ${e.url || '(inline)'}`)
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.text || ''))
      }
    })

    await cdp.send('Page.navigate', { url: BASE + ARTICLE })
    await sleep(4000)

    const title = await evaluate(cdp, 'document.title')
    check('线上页面能打开（标题非空）', !!title && title.trim().length > 0, `title="${title}"`)

    // ⚠️ 这几个断言读的都是 hydration 之后的 DOM，不是产物文件 —— 这是本层的全部意义。
    const nav = await evaluate(cdp, `(document.querySelector('#main-nav-aria-label')||{}).textContent || null`)
    check('hydration 后导航 aria = 主导航', nav === '主导航', `"${nav}"`)

    const sidebar = await evaluate(cdp, `(document.querySelector('#sidebar-aria-label')||{}).textContent || null`)
    check('hydration 后侧栏 aria = 侧边栏导航', sidebar === '侧边栏导航', `"${sidebar}"`)

    const footer = await evaluate(cdp, `(document.querySelector('#doc-footer-aria-label')||{}).textContent || null`)
    check('hydration 后翻页导航 aria = 翻页导航', footer === '翻页导航', `"${footer}"`)

    const lastUpd = await evaluate(cdp, `(document.querySelector('.VPLastUpdated')||{}).textContent || ''`)
    check('hydration 后「最后更新于」用全角冒号',
      lastUpd.includes('：') && !lastUpd.includes('最后更新于:'), `"${lastUpd.trim()}"`)

    const bodyText = await evaluate(cdp, 'document.body.innerText.slice(0,400)')
    check('页面有正文（不是空白/错误页）', typeof bodyText === 'string' && bodyText.trim().length > 30,
      JSON.stringify((bodyText || '').slice(0, 60)))

    // 无头环境常报 favicon 404，那不算缺陷；错误页的 404 已在上面「有正文」里兜住。
    const real = consoleErrors.filter((e) => !/favicon/i.test(e))
    check('无意外控制台错误', real.length === 0, real.slice(0, 3).join(' | ') || '(干净)')

    fs.mkdirSync(SHOT_DIR, { recursive: true })
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(SHOT_DIR, 'live-article-after.png'), Buffer.from(shot.data, 'base64'))
    console.log('  截图: .verify/live-article-after.png')
  } catch (e) {
    check('渲染层执行完成', false, e.message)
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    try { chrome.kill() } catch { /* ignore */ }
  }
}

/* ------------------------------ 主流程 ------------------------------ */

console.log(`线上验收目标: ${BASE}${OLD_THEME ? `（先等 theme chunk 从 ${OLD_THEME} 变化）` : ''}`)
const chunk = await fetchThemeChunk()
if (chunk) {
  if (OLD_THEME) check('新构建已上线（theme chunk 哈希变化）', chunk !== OLD_THEME, chunk)
  await artifactLayer(chunk)
  await renderLayer()
} else {
  check('取到线上 theme chunk', false, '轮询超时，请检查 Cloudflare Pages 构建状态')
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n===== 线上验收汇总：${checks.length - failed.length}/${checks.length} PASS =====`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  - ${f.name}  ${f.detail}`)
  process.exit(1)
}
console.log('线上验收全绿。')

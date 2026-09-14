#!/usr/bin/env node
/**
 * tools/verify/verify.js —— Forge Notes 端到端验证
 *
 * 用本机 Chrome + CDP 做真实渲染验证，不依赖 Playwright（省掉 ~500MB 下载）。
 * 一次调用内完成：起静态服务 -> 起 Chrome -> 逐项断言 -> 截图 -> 清理。
 *
 * 用法：
 *   node tools/verify/verify.js                 # 默认跑 3 轮
 *   ROUNDS=1 node tools/verify/verify.js        # 快跑一轮
 *
 * 退出码：全部断言通过为 0，否则为 1。
 */

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const SITE_DIR = path.join(ROOT, 'docs/.vitepress/dist')
const OUT_DIR = path.join(ROOT, '.verify')

const ROUNDS = Number(process.env.ROUNDS || 3)
const PORT_SITE = 4199
const PORT_HOST = 4200
const PORT_CDP = 9333

const BASE_SITE = `http://127.0.0.1:${PORT_SITE}`
const BASE_HOST = `http://127.0.0.1:${PORT_HOST}`

/**
 * L1-5 里**故意**访问的不存在路径。
 *
 * 主文档返回 404 会被 Chrome 记成一条控制台 error —— 那是我们要验的行为本身，
 * 不是缺陷。所以「无预期外控制台错误」这条断言要把这个地址排除掉，
 * 否则它永远红着，红久了就没人看了。
 */
const EXPECTED_404_PATH = '/no-such-page-xyz'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ============================ 静态服务 ============================ */

function createServer(rootDir) {
  const root = path.resolve(rootDir)
  return http.createServer((req, res) => {
    let urlPath
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    } catch {
      urlPath = '/'
    }

    let filePath = path.normalize(path.join(root, urlPath))

    // 防目录穿越
    if (!filePath.startsWith(root)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('403')
      return
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html')
    }
    if (!fs.existsSync(filePath) && !path.extname(filePath) && fs.existsSync(filePath + '.html')) {
      filePath += '.html'
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      /*
       * 未知路径：对齐 Cloudflare Pages 的行为 —— 产物根目录有 404.html 就
       * 以 404 状态把它返回，否则才是纯文本兜底。
       *
       * 为什么要在本地模拟：真实站点上「未知路径返真 404 而不是软 404」
       * 完全由这一步决定。本地服务器若不模拟，404 页就只能等上线才暴露问题，
       * 而 Cloudflare 对没有 404.html 的站点会走 SPA 兜底，返回 200 + 首页 ——
       * 那是 SEO 上最难查的软 404。
       */
      const custom404 = path.join(root, '404.html')
      if (fs.existsSync(custom404)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        fs.createReadStream(custom404).pipe(res)
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 ' + urlPath)
      return
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(filePath).pipe(res)
  })
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

/* ============================ CDP 客户端 ============================ */

async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true })
  })

  let seq = 0
  const pending = new Map()
  const listeners = []

  ws.addEventListener('message', (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
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
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 30000)
    })

  return { send, on: (fn) => listeners.push(fn), close: () => ws.close() }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    throw new Error('页面内异常: ' + (r.exceptionDetails.text || ''))
  }
  return r.result?.value
}

async function waitReady(cdp, timeout = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      const s = await evaluate(cdp, 'document.readyState')
      if (s === 'complete') return true
    } catch {
      /* 导航中可能短暂失败，继续等 */
    }
    await sleep(200)
  }
  return false
}

/* ============================ 断言收集 ============================ */

const allChecks = []
let currentRound = 0

function check(name, pass, detail = '') {
  allChecks.push({ round: currentRound, name, pass: !!pass, detail: String(detail).slice(0, 200) })
  const mark = pass ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${name}${detail ? '  -> ' + String(detail).slice(0, 160) : ''}`)
}

/* ============================ 主流程 ============================ */

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  return candidates.find((p) => fs.existsSync(p))
}

async function main() {
  // --- 前置检查 ---
  if (!fs.existsSync(SITE_DIR)) {
    console.error('未找到站点构建产物，请先执行 npm run build:site')
    process.exit(1)
  }
  const embedJs = path.join(ROOT, 'packages/embed/dist/forge-notes.js')
  if (!fs.existsSync(embedJs)) {
    console.error('未找到嵌入组件产物，请先执行 npm run build:embed')
    process.exit(1)
  }

  /*
   * 清理上一轮的截图。
   *
   * 两个刻意的设计，都是被本机环境逼出来的：
   *
   * 1) **只删自己产出的文件**（`r{n}-*.png`），不再整个递归删 OUT_DIR。
   *    别人往这个目录放过东西（线上验收脚本的 html/js 快照、手工下载的基线）
   *    不该被顺手清掉。
   *
   * 2) **best-effort**：清理失败只告警，绝不让整轮验证崩掉。
   *    实测踩过：沙箱对「单轮批量删除」有阈值（>50 个）保护，目录里累积的
   *    文件一多，第 232 行这个 rmSync 直接抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED，
   *    于是一条断言都没跑就退出 —— 清理失败和验证失败是两件完全不同的事，
   *    不该共用一个退出码。
   */
  fs.mkdirSync(OUT_DIR, { recursive: true })
  let cleaned = 0
  try {
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (!/^r\d+-[a-z0-9-]+\.png$/i.test(f)) continue
      fs.rmSync(path.join(OUT_DIR, f), { force: true })
      cleaned += 1
    }
  } catch (e) {
    console.warn(`⚠️  清理上一轮截图失败（不影响本轮验证）：${e.message}`)
  }
  if (cleaned) console.log(`已清理上一轮截图 ${cleaned} 张`)

  const chromePath = findChrome()
  if (!chromePath) {
    console.error('未找到 Chrome / Edge')
    process.exit(1)
  }
  console.log(`浏览器: ${chromePath}`)

  // --- 起服务 ---
  const siteServer = await listen(createServer(SITE_DIR), PORT_SITE)
  const hostServer = await listen(createServer(ROOT), PORT_HOST)
  console.log(`站点服务: ${BASE_SITE}`)
  console.log(`宿主服务: ${BASE_HOST}`)

  // --- 起 Chrome ---
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-verify-'))
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=1440,900',
      `--remote-debugging-port=${PORT_CDP}`,
      `--user-data-dir=${userDataDir}`,
      // 本地地址必须绕开系统代理（本机有 Clash，否则会渲染成错误页）
      '--no-proxy-server',
      '--proxy-bypass-list=<-loopback>',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let cdp
  try {
    // 等待 CDP 就绪
    let wsUrl = null
    for (let i = 0; i < 60; i++) {
      try {
        const list = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`).then((r) => r.json())
        const page = list.find((t) => t.type === 'page')
        if (page?.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl
          break
        }
      } catch {
        /* 还没起来 */
      }
      await sleep(300)
    }
    if (!wsUrl) throw new Error('无法连接 Chrome 调试端口')

    cdp = await connectCDP(wsUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    // 无头标签页默认不「持有焦点」，键盘默认行为（按钮的回车激活等）不会发生。
    // 不打开这个，下面测键盘操作时会把「没焦点」误判成「组件不支持键盘」。
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })

    // 控制台错误收集。
    //
    // ⚠️ 必须带上**来源 URL**：主文档自身返回 404，Chrome 也会在控制台记一条
    // error 级日志（text 里只有「Failed to load resource: 404」，不含 URL）。
    // 而我们在 L1-5 里是**故意**访问一个不存在的路径的 —— 不记录来源，
    // 就没法把「预期内的 404」和「真的坏了」分开，这条断言会永远红着，
    // 然后所有人就都学会忽略它了。那等于没有断言。
    let consoleErrors = []
    let currentPageUrl = ''
    cdp.on((msg) => {
      if (msg.method === 'Page.frameNavigated' && !msg.params.frame?.parentId) {
        currentPageUrl = msg.params.frame.url
      } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('exception: ' + (msg.params.exceptionDetails?.text || 'unknown'))
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        const e = msg.params.entry
        // entry.url 对主文档 404 可能是空的，那就退回到「当时所在的页面地址」
        const where = e.url || currentPageUrl || '(未知来源)'
        consoleErrors.push(`log: [${e.source}] ${e.text}  @ ${where}`)
      }
    })

    // 探测实际的文章页文件名（cleanUrls 开关会影响）
    const postsDir = path.join(SITE_DIR, 'posts')
    const welcomeFile = fs.existsSync(postsDir)
      ? fs.readdirSync(postsDir).find((f) => f.startsWith('welcome'))
      : null
    const welcomeUrl = `${BASE_SITE}/posts/${welcomeFile || 'welcome.html'}`

    for (let round = 1; round <= ROUNDS; round++) {
      currentRound = round
      consoleErrors = []
      console.log(`\n================ 第 ${round}/${ROUNDS} 轮 ================`)

      /* ---------------- L1-1 首页 ---------------- */
      console.log('\n[L1] 首页')
      await cdp.send('Page.navigate', { url: `${BASE_SITE}/` })
      await waitReady(cdp)
      await sleep(1200)

      const title = await evaluate(cdp, 'document.title')
      check('首页 title 含 Forge Notes', /Forge Notes/.test(title), title)

      const heroText = await evaluate(
        cdp,
        `(document.querySelector('.VPHero .heading') || document.querySelector('.VPHero') || {}).innerText || ''`,
      )
      check('首页 hero 渲染出品牌名', /Forge Notes/i.test(heroText), heroText.replace(/\n/g, ' | ').slice(0, 90))

      const featCount = await evaluate(cdp, `document.querySelectorAll('.VPFeature').length`)
      check('首页特性卡片数量 = 4', featCount === 4, `count=${featCount}`)

      const homeBody = await evaluate(cdp, 'document.body.innerText')
      check('首页含配置源里的卡片文案', /跨境电商技术/.test(homeBody) && /AdSense 变现/.test(homeBody))
      check('首页无原作者残留', !/geeeeeeeek|java1024|kefu308|Tim技术博客/.test(homeBody))

      // favicon 是否真的可访问（原项目这里是 404）
      const faviconStatus = await evaluate(
        cdp,
        `fetch('/favicon.svg').then(r => r.status).catch(() => -1)`,
      )
      check('favicon.svg 可访问', faviconStatus === 200, `HTTP ${faviconStatus}`)

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l1-home.png`), Buffer.from(s.data, 'base64')))

      /* ---------------- L1-1a 主题硬编码 aria 本地化 ---------------- */
      // 这三条 aria 文案是主题里**写死的英文**（alpha.15 没有任何配置键能改），
      // 靠 scripts/localize-theme-aria.mjs 在构建后替换 HTML + theme JS。
      //
      // ⚠️ 必须**在 hydration 之后**读 DOM，这是本轮最容易骗过自己的地方：
      //   只改 HTML 不改 theme JS 的话，Vue 会在 hydration 时按 JS 里的字面量
      //   把中文修正回英文 —— 首屏看着是中文，一秒后变回英文，而且不报任何错。
      //   所以这里不是去 grep 产物文件，而是在真实浏览器里读 textContent：
      //   此时已过 waitReady + 1200ms，拿到的是 hydration 之后的最终状态。
      const mainNavAria = await evaluate(
        cdp,
        `(document.getElementById('main-nav-aria-label') || {}).textContent || ''`,
      )
      check(
        '导航栏 aria 标题已本地化（hydration 后仍是中文）',
        mainNavAria.trim() === '主导航',
        `"${mainNavAria.trim()}"`,
      )

      const ariaHtml = await evaluate(cdp, 'document.documentElement.outerHTML')
      check('页面 HTML 无 "Main Navigation" 英文残留', !ariaHtml.includes('Main Navigation'))
      // 注意这里必须 null-safe：早期写成 document.querySelector('.VPNavBarMenu').getAttribute(...)，
      // 一旦这个元素不存在（正是上面那个「导航栏整棵子树崩掉」的 bug 的形态），
      // 表达式直接抛异常，**整轮剩余断言全部不跑** —— 后面几十条断言被一条掩盖掉了。
      // 断言工具自己出错时应该只算这一条失败，不能中断整轮。
      const ariaLink = await evaluate(
        cdp,
        `(() => {
          const nav = document.querySelector('.VPNavBarMenu')
          if (!nav) return { ok: false, why: '未找到 .VPNavBarMenu 元素' }
          const id = nav.getAttribute('aria-labelledby')
          return { ok: !!document.getElementById(id), why: 'aria-labelledby=' + id }
        })()`,
      )
      check('aria-labelledby 仍指向存在的 id（改文案没破坏关联）', ariaLink.ok, ariaLink.why)

      /* ---------------- L1-1b 搜索 UI 本地化（真实交互） ---------------- */
      // 只在配置里写了翻译键是不够的 —— 键名写错会**静默失效**，
      // 所以这里真的把弹窗打开、真的输入内容，量它渲染出来的文案。
      console.log('\n[L1] 搜索 UI 本地化')
      const navSearchText = await evaluate(
        cdp,
        `(document.querySelector('.DocSearch-Button-Placeholder') || {}).innerText || ''`,
      )
      check('导航栏搜索按钮是中文', navSearchText.trim() === '搜索', `text="${navSearchText}"`)

      const skipLinkText = await evaluate(
        cdp,
        `(document.querySelector('.VPSkipLink') || {}).innerText || ''`,
      )
      check('「跳到正文」链接已本地化', skipLinkText.trim() === '跳到正文', `text="${skipLinkText}"`)

      await evaluate(cdp, `document.querySelector('.DocSearch-Button').click(), true`)
      await sleep(700)
      const modalState = await evaluate(
        cdp,
        `(() => {
          const input = document.querySelector('#localsearch-input')
          return {
            opened: !!document.querySelector('.VPLocalSearchBox'),
            placeholder: input ? input.placeholder : '',
            resetTitle: (document.querySelector('.clear-button') || {}).title || '',
            backTitle: (document.querySelector('.back-button') || {}).title || '',
          }
        })()`,
      )
      check('点击后搜索弹窗真的打开', modalState.opened)
      check('搜索框 placeholder 已本地化', modalState.placeholder === '搜索', `"${modalState.placeholder}"`)
      check('「重置搜索」按钮已本地化', modalState.resetTitle === '重置搜索', `"${modalState.resetTitle}"`)
      check('「关闭搜索」按钮已本地化', modalState.backTitle === '关闭搜索', `"${modalState.backTitle}"`)

      /*
       * 搜索要验**两个对照**：先证明能搜到，再验搜不到时的文案。
       *
       * 为什么必须有正向对照：只验「搜不到时显示中文」，无法区分两种情况 ——
       *   (a) 搜索正常工作，这个词确实搜不到      → 应该通过
       *   (b) 检索压根没跑起来，结果列表永远是空的 → 也会「通过」（假绿）
       * 加一条正向对照（一个必须搜得到的词）就能把 (b) 排除掉。
       *
       * 另一个坑：「必搜不到的词」不能随便编。MiniSearch 配的是
       * prefix: true + fuzzy: 0.2，最初用的 `zzz-definitely-no-such-thing`
       * 会被切成词元，其中 `no` 能**前缀匹配**到全站都有的 `notes` ——
       * 它其实搜得到结果，所以 .no-results 永远不出现。换成不含常见前缀的乱串。
       */
      const typeQuery = async (text) => {
        // focus + select()：insertText 会**替换当前选区**，所以这样等于「清空并重输」。
        // 比手动改 value 好 —— 后者绕过了 v-model，测不出真实输入路径。
        await evaluate(
          cdp,
          `(() => { const i = document.querySelector('#localsearch-input'); if (!i) return false; i.focus(); i.select(); return true })()`,
        )
        await sleep(120)
        await cdp.send('Input.insertText', { text })
      }

      const readSearchState = () =>
        evaluate(
          cdp,
          `(() => {
            const input = document.querySelector('#localsearch-input')
            return {
              typed: input ? input.value : '',
              results: document.querySelectorAll('.results .result').length,
              noResults: (document.querySelector('.no-results') || {}).innerText || '',
            }
          })()`,
        )

      // ---- 正向对照：这个词必须搜得到 ----
      await typeQuery('AdSense')
      let hitState = await readSearchState()
      for (let i = 0; i < 25 && hitState.results === 0; i++) {
        await sleep(200)
        hitState = await readSearchState()
      }
      check(
        '搜索能返回结果（正向对照，防止「搜索整个坏掉」蒙混过关）',
        hitState.results > 0,
        `输入 "${hitState.typed}" → ${hitState.results} 条结果`,
      )

      // ---- 反向对照：搜不到时文案是中文 ----
      await typeQuery('zzqqxxjjvvkkwwyy')
      let missState = await readSearchState()
      for (let i = 0; i < 25 && !missState.noResults; i++) {
        await sleep(200)
        missState = await readSearchState()
      }
      check(
        '搜索无结果文案已本地化',
        /没有结果/.test(missState.noResults),
        missState.noResults
          ? missState.noResults.slice(0, 60)
          : `输入 "${missState.typed}" 后 .no-results 未出现（该词意外匹配到 ${missState.results} 条结果）`,
      )

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l1-search.png`), Buffer.from(s.data, 'base64')))

      // 关掉弹窗，避免残留遮罩影响后续断言
      await evaluate(cdp, `document.querySelector('.back-button').click(), true`)
      await sleep(500)

      /* ---------------- L1-2 文章列表 ---------------- */
      console.log('\n[L1] 文章列表页')
      await cdp.send('Page.navigate', { url: `${BASE_SITE}/posts/` })
      await waitReady(cdp)
      await sleep(900)

      // 注意：这里必须用 .fn-post-list li a 精确取「列表页自己的条目」。
      // 早期版本用的是 a[href*="/posts/"]，那会把左侧自动侧边栏的 17 个链接
      // 一起算进来，于是「>= 17」永远成立 —— 一条恒真断言等于没有断言。
      const listInfo = await evaluate(
        cdp,
        `(() => {
          const groups = [...document.querySelectorAll('.fn-group-title')]
          const items = [...document.querySelectorAll('.fn-post-list li a')]
          const docText = document.querySelector('.VPDoc')?.innerText || ''
          return {
            groupCount: groups.length,
            groupTitles: groups.map((g) => g.innerText.trim()),
            itemCount: items.length,
            bodyText: document.body.innerText,
            welcomeHasBrand: /Forge Notes/.test(docText),
          }
        })()`,
      )
      check('列表页按 tag 自动分组渲染', listInfo.groupCount >= 4, `groups=${listInfo.groupCount}`)
      check('列表页分组标题非空', listInfo.groupTitles.every((t) => t.length > 2), listInfo.groupTitles.join(' / '))
      check('列表页收录全部文章', listInfo.itemCount === 17, `items=${listInfo.itemCount}`)
      check('列表页欢迎语由配置注入品牌名', listInfo.welcomeHasBrand)
      check('列表页无原作者残留', !/geeeeeeeek|java1024|kefu308|Tim技术博客/.test(listInfo.bodyText))

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l1-list.png`), Buffer.from(s.data, 'base64')))

      /* ---------------- L1-3 文章详情 ---------------- */
      console.log('\n[L1] 文章详情页')
      await cdp.send('Page.navigate', { url: welcomeUrl })
      await waitReady(cdp)
      await sleep(1200)

      const postH1 = await evaluate(cdp, `document.querySelector('.VPDoc h1')?.innerText || ''`)
      check('文章页 H1 已使用新品牌名', /Forge Notes/.test(postH1), postH1)

      const sidebarCount = await evaluate(cdp, `document.querySelectorAll('.VPSidebar .VPSidebarItem').length`)
      check('自动侧边栏渲染（>=17 项）', sidebarCount >= 17, `items=${sidebarCount}`)

      const sidebarText = await evaluate(cdp, `document.querySelector('.VPSidebar')?.innerText || ''`)
      check('侧边栏含文章列表入口', /文章列表/.test(sidebarText))
      check('侧边栏含具体文章标题', /AdSense/.test(sidebarText))

      // 侧边栏的 aria 标题同样是主题写死的英文，见 L1-1a 的说明。
      // 这里在真实文章页（带侧边栏）上验，且同样是 hydration 之后的 DOM。
      const sidebarAria = await evaluate(
        cdp,
        `(document.getElementById('sidebar-aria-label') || {}).textContent || ''`,
      )
      check(
        '侧边栏 aria 标题已本地化（hydration 后仍是中文）',
        sidebarAria.trim() === '侧边栏导航',
        `"${sidebarAria.trim()}"`,
      )
      const sidebarAriaLink = await evaluate(
        cdp,
        `(() => {
          const nav = document.querySelector('.VPSidebar .nav')
          if (!nav) return { ok: false, why: '未找到 .VPSidebar .nav 元素' }
          const id = nav.getAttribute('aria-labelledby')
          return { ok: !!document.getElementById(id), why: 'aria-labelledby=' + id }
        })()`,
      )
      check('侧栏 aria-labelledby 仍指向存在的 id（改文案没破坏关联）', sidebarAriaLink.ok, sidebarAriaLink.why)

      // 翻页导航（上一篇 / 下一篇）的隐藏标题，原文是硬编码的 "Pager"
      const pagerAria = await evaluate(
        cdp,
        `(document.getElementById('doc-footer-aria-label') || {}).textContent || ''`,
      )
      check(
        '翻页导航 aria 标题已本地化（hydration 后仍是中文）',
        pagerAria.trim() === '翻页导航',
        `"${pagerAria.trim()}"`,
      )
      const pagerHtml = await evaluate(
        cdp,
        `(() => {
          const nav = document.querySelector('.prev-next')
          if (!nav) return { ok: false, why: '未找到 .prev-next 元素' }
          const id = nav.getAttribute('aria-labelledby')
          return { ok: !!document.getElementById(id), why: 'aria-labelledby=' + id }
        })()`,
      )
      check('翻页导航 aria-labelledby 仍指向存在的 id', pagerHtml.ok, pagerHtml.why)

      /*
       * 标题锚点的 aria-label 与代码块的复制按钮。
       *
       * 这两条跟上面几处「构建后字符串替换」不同 —— 它们走**构建期渲染**
       * （markdown.config 改写 link_open 规则 / markdown.codeCopyButtonTitle），
       * 所以静态 HTML 与页面 chunk JS 天然一致，不存在 hydration 覆盖。
       *
       * 但这里仍然要验，而且必须验：它们最初是**静默失效**的 ——
       * 钩子挂在 `preConfig`（在所有插件之前），而 linkPlugin 是**直接赋值**
       * `md.renderer.rules.link_open`，把 preConfig 的改动原样覆盖，构建照样
       * 成功、产物里 `Permalink to` 一处不少、没有任何警告。
       * 详见 docs/.vitepress/config.mjs 里那段注释。
       */
      const permalink = await evaluate(
        cdp,
        `(() => {
          const a = document.querySelector('.VPDoc .header-anchor')
          return { found: !!a, label: a ? a.getAttribute('aria-label') || '' : '' }
        })()`,
      )
      check(
        '标题锚点 aria-label 已本地化（hydration 后）',
        permalink.found && /固定链接$/.test(permalink.label) && !/Permalink to/.test(permalink.label),
        permalink.found ? `"${permalink.label}"` : '未找到 .VPDoc .header-anchor',
      )

      // 社交链接：不配 ariaLabel 时主题会把图标名（小写 github）当无障碍名称读出来
      const socialAria = await evaluate(
        cdp,
        `(() => {
          const a = document.querySelector('.VPSocialLink')
          return { found: !!a, label: a ? a.getAttribute('aria-label') || '' : '' }
        })()`,
      )
      check(
        '社交链接 aria-label 不是图标名（github → GitHub）',
        socialAria.found && socialAria.label === 'GitHub',
        socialAria.found ? `"${socialAria.label}"` : '未找到 .VPSocialLink',
      )

      /*
       * 「最后更新于」必须等于**文章自己 front matter 里的 date**。
       *
       * 这条断言是钉住一个只在线上暴露的 bug：VitePress 用一次
       * `git log --name-only` 扫全仓建「文件→时间」映射，而 Cloudflare Pages
       * 检出的是浅克隆，边界提交会被当成「改了所有文件」，
       * 于是全站日期都变成当次部署的提交时间。本地全量历史下看不出来。
       * 所以这里不比「今天」，而是直接和文章里的 date 对照。
       */
      const lastUpdatedState = await evaluate(
        cdp,
        `(() => {
          const p = document.querySelector('.VPLastUpdated')
          const t = p ? p.querySelector('time') : null
          return {
            present: !!p,
            datetime: t ? t.getAttribute('datetime') : '',
            text: t ? t.innerText : '',
          }
        })()`,
      )
      const welcomeMdPath = path.join(ROOT, 'docs/posts', welcomeFile.replace(/\.html$/, '.md'))
      const welcomeDate = (fs.readFileSync(welcomeMdPath, 'utf8').match(/^date:\s*(\S+)/m) || [])[1] || ''
      const expectedIso = welcomeDate ? new Date(`${welcomeDate}T00:00:00.000Z`).toISOString() : ''
      check('文章页显示「最后更新于」', lastUpdatedState.present && !!lastUpdatedState.datetime, lastUpdatedState.datetime)
      check(
        '「最后更新于」取文章 front matter 的 date（不是构建时间）',
        !!expectedIso && lastUpdatedState.datetime === expectedIso,
        `页面=${lastUpdatedState.datetime} 期望=${expectedIso}（date: ${welcomeDate}）`,
      )
      check(
        '日期只到天，没有 YAML 零点换算出来的假时分秒',
        lastUpdatedState.text.length > 0 && !/\d{1,2}:\d{2}/.test(lastUpdatedState.text),
        `"${lastUpdatedState.text}"`,
      )

      /*
       * 「最后更新于」的分隔符：主题模板里写死半角 `": "`（VPDocFooterLastUpdated.vue），
       * 已由 scripts/localize-theme-aria.mjs 换成全角「：」。
       * 同样验**可见文本**而不是产物文件 —— 只改 HTML 会被 hydration 覆盖回去。
       *
       * 断言刻意**精确到分隔符那一个字符**，而不是「整串里出现过全角冒号」：
       * 后者是弱正向 —— 只要标签里别处碰巧有全角冒号就能过，
       * 而 hydration 把分隔符改回半角时照样亮红灯。取 `(.)` 捕一个字符最直接。
       */
      const lastUpdatedLabel = await evaluate(
        cdp,
        `(document.querySelector('.VPLastUpdated') || {}).textContent || ''`,
      )
      const lastUpdatedSep = (lastUpdatedLabel.match(/最后更新于\s*(.)/) || [])[1] || ''
      check(
        '「最后更新于」用全角冒号分隔（hydration 后可见文本）',
        lastUpdatedSep === '：',
        `分隔符="${lastUpdatedSep}"（U+${lastUpdatedSep.codePointAt(0)?.toString(16).toUpperCase() ?? '----'}），整串="${lastUpdatedLabel.trim()}"`,
      )

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l1-post.png`), Buffer.from(s.data, 'base64')))

      /*
       * 代码块复制按钮。
       *
       * 这一步**必须换一篇文章**：复制按钮只在有代码块的页面上渲染，而 L1-3 用的
       * welcome 页实测 0 个代码块（`Read the docs` 那种纯说明页）—— 第一版把断言
       * 写在这里，3 轮全红、报「未找到 button.copy」，而产物其实完全正确。
       *
       * 所以改成从产物里**自动挑**第一篇含代码块的文章：加文章、改内容、甚至
       * welcome 被删掉，这条断言都不会因此假失败。
       * 一条「只在正好选中某篇文章时才成立」的断言等于没断言。
       *
       * 位置也刻意放在 L1-3 的最后 —— 后面几条断言（最后更新于 / 日期来源）
       * 都依赖当前停在 welcome 页，先跳走会把它们全部带偏。
       */
      const postsHtmlDir = path.join(SITE_DIR, 'posts')
      const codePostFile = fs.existsSync(postsHtmlDir)
        ? fs.readdirSync(postsHtmlDir).find(
            (f) => /\.html$/.test(f) && /class="copy"/.test(fs.readFileSync(path.join(postsHtmlDir, f), 'utf8')),
          )
        : null
      if (!codePostFile) {
        check('产物里存在带代码块的文章页', false, '全部 posts/*.html 都没有 class="copy" —— 复制按钮无处可验')
      } else {
        await cdp.send('Page.navigate', { url: `${BASE_SITE}/posts/${codePostFile}` })
        await waitReady(cdp)
        await sleep(1000)
        const copyBtn = await evaluate(
          cdp,
          `(() => {
            const all = document.querySelectorAll('button.copy')
            const b = all[0]
            return { found: !!b, n: all.length, title: b ? b.getAttribute('title') || '' : '' }
          })()`,
        )
        check(
          `代码块复制按钮提示已本地化（hydration 后，${codePostFile} 共 ${copyBtn.n} 个）`,
          copyBtn.found && copyBtn.title === '复制代码',
          copyBtn.found ? `title="${copyBtn.title}"` : '未找到 button.copy',
        )
      }

      /* ---------------- L1-4 关于页 ---------------- */
      console.log('\n[L1] 关于页')
      await cdp.send('Page.navigate', { url: `${BASE_SITE}/about.html` })
      await waitReady(cdp)
      await sleep(900)

      const aboutText = await evaluate(cdp, `document.querySelector('.VPDoc')?.innerText || document.body.innerText`)
      check('关于页含 yqh-core', /yqh-core/.test(aboutText))
      check('关于页无原作者联系方式', !/geeeeeeeek|java1024|kefu308@gmail/.test(aboutText))

      // 没有 date 的页面不显示「最后更新于」—— 宁可不显示，也不编造一个日期
      const aboutHasLastUpdated = await evaluate(cdp, `!!document.querySelector('.VPLastUpdated')`)
      check('无 date 的页面不显示「最后更新于」', !aboutHasLastUpdated)

      /* ---------------- L1-5 404 页 ---------------- */
      // 404 页的内容是**客户端渲染**的（VitePress 生成的 404.html 里 #app 是空的），
      // 所以必须真的用浏览器访问一个不存在的路径才能验证，光看产物文件不够。
      console.log('\n[L1] 404 页')
      await cdp.send('Page.navigate', { url: `${BASE_SITE}${EXPECTED_404_PATH}` })
      await waitReady(cdp)
      await sleep(1000)
      const notFoundState = await evaluate(
        cdp,
        `(() => {
          const box = document.querySelector('.NotFound')
          const link = document.querySelector('.NotFound .link')
          return {
            hasBox: !!box,
            code: (document.querySelector('.NotFound .code') || {}).innerText || '',
            title: (document.querySelector('.NotFound .title') || {}).innerText || '',
            linkText: link ? link.innerText : '',
            linkHref: link ? link.getAttribute('href') : '',
            bodyText: document.body.innerText || '',
          }
        })()`,
      )
      check('404 页渲染出主题的未找到视图', notFoundState.hasBox)
      check('404 页显示 404', notFoundState.code.trim() === '404', notFoundState.code)
      check('404 页标题已本地化', notFoundState.title.trim() === '页面不存在', notFoundState.title)
      check(
        '404 页有「回到首页」链接且指向站点根',
        notFoundState.linkText.trim() === '回到首页' && notFoundState.linkHref === '/',
        `${notFoundState.linkText} -> ${notFoundState.linkHref}`,
      )
      check('404 页无英文默认文案残留', !/PAGE NOT FOUND|Take me home/.test(notFoundState.bodyText))

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l1-404.png`), Buffer.from(s.data, 'base64')))

      /* ---------------- L2 嵌入组件 ---------------- */
      console.log('\n[L2] 嵌入组件（宿主页面）')
      await cdp.send('Page.navigate', { url: `${BASE_HOST}/examples/embed-demo.html` })
      await waitReady(cdp)
      await sleep(2000)

      const hostH2Color = await evaluate(
        cdp,
        `getComputedStyle(document.querySelector('h2')).color`,
      )

      const shadowInfo = await evaluate(
        cdp,
        `(() => {
          const el = document.querySelector('forge-notes')
          if (!el) return { ok: false, reason: 'element-missing' }
          if (!el.shadowRoot) return { ok: false, reason: 'no-shadow-root' }
          const cards = el.shadowRoot.querySelectorAll('.fn-card')
          const title = el.shadowRoot.querySelector('.fn-list-title')
          return {
            ok: true,
            cards: cards.length,
            titleText: title ? title.innerText : '',
            titleColor: title ? getComputedStyle(title).color : '',
            firstCardText: cards.length ? cards[0].innerText.slice(0, 60) : '',
          }
        })()`,
      )

      check('L2 <forge-notes> 已定义并渲染', shadowInfo.ok, shadowInfo.reason || '')
      check('L2 使用 Shadow DOM 隔离', shadowInfo.ok && shadowInfo.cards > 0, `cards=${shadowInfo.cards}`)
      check('L2 卡片渲染数量 >= 8', shadowInfo.cards >= 8, `cards=${shadowInfo.cards}`)
      check('L2 组件标题用品牌名', /Forge Notes/.test(shadowInfo.titleText || ''), shadowInfo.titleText)

      // 样式隔离：宿主的 h2 是 crimson，组件内的 h2 不应被染红
      const hostIsCrimson = hostH2Color.replace(/\s/g, '') === 'rgb(220,20,60)'
      const shadowIsCrimson = (shadowInfo.titleColor || '').replace(/\s/g, '') === 'rgb(220,20,60)'
      check('L2 对照组生效（宿主 h2 是 crimson）', hostIsCrimson, hostH2Color)
      check('L2 Shadow DOM 隔离有效（组件内标题未被染红）', !shadowIsCrimson, shadowInfo.titleColor)

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l2-embed.png`), Buffer.from(s.data, 'base64')))

      /*
       * 交互：用**键盘**打开第一篇。
       *
       * 旧实现是 `<li @click>` —— 不可聚焦、没有键盘事件、也没有语义，
       * 键盘与读屏用户根本打不开文章。所以这里不测「能点」，
       * 测「能 Tab 到、能回车触发」，这样那种实现会被直接判失败。
       */
      const cardA11y = await evaluate(
        cdp,
        `(() => {
          const sr = document.querySelector('forge-notes').shadowRoot
          const btn = sr.querySelector('.fn-card-btn')
          if (!btn) return { ok: false, reason: 'no-fn-card-btn（卡片里没有真实按钮）' }
          btn.focus()
          return {
            ok: true,
            tag: btn.tagName,
            focused: sr.activeElement === btn,
            insideHeading: !!btn.closest('.fn-card-title'),
          }
        })()`,
      )
      check(
        'L2 卡片是可聚焦的真实 button',
        cardA11y.ok && cardA11y.tag === 'BUTTON' && cardA11y.focused,
        JSON.stringify(cardA11y),
      )
      check('L2 按钮在标题里（保留三级标题语义）', !!cardA11y.insideHeading)

      // 派发真按键：浏览器对 <button> 的默认行为就是 Enter 触发 click。
      // ⚠️ keyDown 必须带 text:'\r'，否则 CDP 发出去的是「无字符的原始按键」，
      //    Chrome 不会执行按钮的默认激活 —— 会误判成组件不支持键盘。
      //    这一点与 Puppeteer 的 keyboard.press('Enter') 实现一致。
      for (const type of ['keyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', {
          type,
          key: 'Enter',
          code: 'Enter',
          text: type === 'keyDown' ? '\r' : undefined,
          unmodifiedText: type === 'keyDown' ? '\r' : undefined,
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
        })
      }
      await sleep(900)

      const postState = await evaluate(
        cdp,
        `(() => {
          const sr = document.querySelector('forge-notes').shadowRoot
          const post = sr.querySelector('.fn-post')
          return {
            hasPost: !!post,
            title: sr.querySelector('.fn-post-title')?.innerText || '',
            contentLen: (sr.querySelector('.fn-content')?.innerHTML || '').length,
            hasBack: !!sr.querySelector('.fn-back'),
          }
        })()`,
      )
      check('L2 点击卡片进入详情视图', postState.hasPost, postState.title)
      check('L2 详情渲染出正文内容', postState.contentLen > 500, `htmlLen=${postState.contentLen}`)
      check('L2 详情有返回按钮', postState.hasBack)

      // 换视图后焦点要跟过去：详情是把列表整个替换掉的，
      // 不管焦点的话它会掉回 <body>，键盘用户得从页首重新 Tab。
      const focusAfterOpen = await evaluate(
        cdp,
        `(() => {
          const sr = document.querySelector('forge-notes').shadowRoot
          return {
            isBack: sr.activeElement === sr.querySelector('.fn-back'),
            active: sr.activeElement ? sr.activeElement.className : '(无)',
          }
        })()`,
      )
      check('L2 进入详情后焦点移到「返回列表」', focusAfterOpen.isBack, focusAfterOpen.active)

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l2-post.png`), Buffer.from(s.data, 'base64')))

      // 交互：返回列表。
      // 用可选链 —— 上一步若失败这里会是 null，早期写法直接抛 TypeError，
      // 把整轮验证打断在中间，看不到后面还有多少问题。
      await evaluate(
        cdp,
        `(() => {
          const b = document.querySelector('forge-notes').shadowRoot.querySelector('.fn-back')
          if (!b) return false
          b.click()
          return true
        })()`,
      )
      await sleep(800)
      const backToList = await evaluate(
        cdp,
        `!!document.querySelector('forge-notes').shadowRoot.querySelector('.fn-list')`,
      )
      check('L2 返回列表成功', backToList)

      // 焦点要还给「刚才打开的那张卡」——从哪来回哪去
      const focusAfterBack = await evaluate(
        cdp,
        `(() => {
          const sr = document.querySelector('forge-notes').shadowRoot
          const a = sr.activeElement
          return {
            isCardBtn: !!(a && a.classList && a.classList.contains('fn-card-btn')),
            slug: a && a.dataset ? a.dataset.slug : '',
          }
        })()`,
      )
      check(
        'L2 返回列表后焦点回到原卡片',
        focusAfterBack.isCardBtn,
        `active=${focusAfterBack.slug || '(不是卡片按钮)'}`,
      )

      // 交互：搜索过滤
      const beforeSearch = shadowInfo.cards
      await evaluate(
        cdp,
        `(() => {
          const inp = document.querySelector('forge-notes').shadowRoot.querySelector('.fn-search')
          inp.value = 'AdSense'
          inp.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        })()`,
      )
      await sleep(600)
      const afterSearch = await evaluate(
        cdp,
        `document.querySelector('forge-notes').shadowRoot.querySelectorAll('.fn-card').length`,
      )
      check(
        'L2 搜索过滤生效',
        afterSearch > 0 && afterSearch < beforeSearch,
        `${beforeSearch} -> ${afterSearch}`,
      )

      // 交互：标签筛选
      await evaluate(
        cdp,
        `(() => {
          const inp = document.querySelector('forge-notes').shadowRoot.querySelector('.fn-search')
          inp.value = ''
          inp.dispatchEvent(new Event('input', { bubbles: true }))
          const chips = document.querySelector('forge-notes').shadowRoot.querySelectorAll('.fn-chip')
          chips[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
          return true
        })()`,
      )
      await sleep(600)
      const afterTag = await evaluate(
        cdp,
        `document.querySelector('forge-notes').shadowRoot.querySelectorAll('.fn-card').length`,
      )
      check('L2 标签筛选生效', afterTag >= 1 && afterTag < beforeSearch, `cards=${afterTag}`)

      // 筛选栏要有分组语义，读屏才知道这一排按钮是干什么的
      const tagbarA11y = await evaluate(
        cdp,
        `(() => {
          const tb = document.querySelector('forge-notes').shadowRoot.querySelector('.fn-tagbar')
          return { role: tb ? tb.getAttribute('role') : '', label: tb ? tb.getAttribute('aria-label') : '' }
        })()`,
      )
      check(
        'L2 标签栏有分组语义',
        tagbarA11y.role === 'group' && !!tagbarA11y.label,
        `role=${tagbarA11y.role} label=${tagbarA11y.label}`,
      )

      // 筛选结果播报区（只给读屏用，视觉上 1px 隐藏）
      const liveRegion = await evaluate(
        cdp,
        `(() => {
          const el = document.querySelector('forge-notes').shadowRoot.querySelector('.fn-vh')
          return { exists: !!el, role: el ? el.getAttribute('role') : '', text: el ? el.innerText : '' }
        })()`,
      )
      check(
        'L2 有筛选结果播报区',
        liveRegion.exists && liveRegion.role === 'status' && /筛选后共 \d+ 篇/.test(liveRegion.text),
        `role=${liveRegion.role} text="${liveRegion.text}"`,
      )

      /*
       * 属性映射：Web Component 的 kebab-case 属性要能落到 camelCase props 上。
       *
       * README 承诺了 `per-page` / `show-tags` 这种写法，但 Vue 对自定义元素
       * 的属性→props 映射（含 Number / Boolean 的类型转换）是运行时行为，
       * 不是文档保证。这里新建一个实例量真实结果，把这条承诺钉住。
       */
      const attrMapping = await evaluate(
        cdp,
        `(async () => {
          const el = document.createElement('forge-notes')
          el.setAttribute('per-page', '3')
          el.setAttribute('show-tags', 'false')
          document.body.appendChild(el)
          await new Promise((r) => setTimeout(r, 1000))
          const sr = el.shadowRoot
          const res = {
            hasShadow: !!sr,
            cards: sr ? sr.querySelectorAll('.fn-card').length : -1,
            tagbar: sr ? !!sr.querySelector('.fn-tagbar') : null,
            moreText: sr && sr.querySelector('.fn-more') ? sr.querySelector('.fn-more').innerText : '',
          }
          el.remove()
          return res
        })()`,
      )
      check('L2 新建实例渲染成功', attrMapping.hasShadow && attrMapping.cards > 0, `cards=${attrMapping.cards}`)
      check(
        'L2 kebab-case 属性 + Number 转换生效（per-page="3"）',
        attrMapping.cards === 3,
        `cards=${attrMapping.cards}`,
      )
      check(
        'L2 kebab-case 属性 + Boolean 转换生效（show-tags="false"）',
        attrMapping.tagbar === false,
        `tagbar=${attrMapping.tagbar}`,
      )
      check(
        'L2 per-page 生效后出现「加载更多」',
        /加载更多/.test(attrMapping.moreText || ''),
        attrMapping.moreText.slice(0, 40),
      )

      /* ---------------- 控制台错误 ---------------- */
      console.log('\n[控制台]')
      const jsErrors = consoleErrors.filter((e) => e.startsWith('exception:'))
      const logErrors = consoleErrors.filter((e) => e.startsWith('log:'))
      check('无 JS 运行时异常', jsErrors.length === 0, jsErrors.join(' ; '))

      // 排除 L1-5 故意触发的那个 404：它是被测行为，不是缺陷。
      // 剩下的任何一条都算失败 —— 这样这条断言才真的在看东西。
      const unexpectedLogs = logErrors.filter((e) => !e.includes(EXPECTED_404_PATH))
      check(
        `无预期外的控制台 error 级日志（已排除 L1-5 故意访问的 ${EXPECTED_404_PATH}）`,
        unexpectedLogs.length === 0,
        unexpectedLogs.join(' ; ').slice(0, 300),
      )
      if (logErrors.length !== unexpectedLogs.length) {
        console.log(`        （另有 ${logErrors.length - unexpectedLogs.length} 条来自 L1-5 的预期 404，已排除）`)
      }
    }

    /* ---------------- 汇总 ---------------- */
    const failed = allChecks.filter((c) => !c.pass)
    const totalByRound = ROUNDS
    console.log('\n\n================ 汇总 ================')
    console.log(`断言总数: ${allChecks.length}（${totalByRound} 轮）`)
    console.log(`通过: ${allChecks.length - failed.length}`)
    console.log(`失败: ${failed.length}`)

    if (failed.length) {
      console.log('\n失败明细:')
      for (const f of failed) {
        console.log(`  [R${f.round}] ${f.name}  ${f.detail}`)
      }
    }

    // 稳定性：同名断言在每轮的结果是否一致
    const byName = new Map()
    for (const c of allChecks) {
      if (!byName.has(c.name)) byName.set(c.name, [])
      byName.get(c.name).push(c.pass)
    }
    const unstable = [...byName.entries()].filter(([, arr]) => new Set(arr).size > 1)
    if (unstable.length) {
      console.log('\n不稳定断言（多轮结果不一致）:')
      for (const [name, arr] of unstable) console.log(`  ${name}: ${arr.map((x) => (x ? 'P' : 'F')).join('')}`)
    } else {
      console.log('\n稳定性：所有断言在每轮结果一致，无非确定性失败')
    }

    console.log(`\n截图已保存到: ${OUT_DIR}`)
    console.log(failed.length === 0 ? '\n结果: 全部通过' : '\n结果: 存在失败')

    process.exitCode = failed.length === 0 ? 0 : 1
  } catch (err) {
    console.error('\n验证脚本异常:', err)
    process.exitCode = 2
  } finally {
    try {
      cdp?.close()
    } catch {}
    try {
      chrome.kill()
    } catch {}
    siteServer.close()
    hostServer.close()
    await sleep(300)
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {}
  }
}

main()

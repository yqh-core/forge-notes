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

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

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

    // 控制台错误收集
    let consoleErrors = []
    cdp.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('exception: ' + (msg.params.exceptionDetails?.text || 'unknown'))
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        consoleErrors.push('log: ' + msg.params.entry.text)
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

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l1-post.png`), Buffer.from(s.data, 'base64')))

      /* ---------------- L1-4 关于页 ---------------- */
      console.log('\n[L1] 关于页')
      await cdp.send('Page.navigate', { url: `${BASE_SITE}/about.html` })
      await waitReady(cdp)
      await sleep(900)

      const aboutText = await evaluate(cdp, `document.querySelector('.VPDoc')?.innerText || document.body.innerText`)
      check('关于页含 yqh-core', /yqh-core/.test(aboutText))
      check('关于页无原作者联系方式', !/geeeeeeeek|java1024|kefu308@gmail/.test(aboutText))

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

      // 交互：点击卡片进详情
      await evaluate(
        cdp,
        `(() => {
          const card = document.querySelector('forge-notes').shadowRoot.querySelector('.fn-card')
          card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
          return true
        })()`,
      )
      await sleep(800)

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

      await cdp.send('Page.captureScreenshot', { format: 'png' })
        .then((s) => fs.writeFileSync(path.join(OUT_DIR, `r${round}-l2-post.png`), Buffer.from(s.data, 'base64')))

      // 交互：返回列表
      await evaluate(
        cdp,
        `(() => {
          const b = document.querySelector('forge-notes').shadowRoot.querySelector('.fn-back')
          b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
          return true
        })()`,
      )
      await sleep(800)
      const backToList = await evaluate(
        cdp,
        `!!document.querySelector('forge-notes').shadowRoot.querySelector('.fn-list')`,
      )
      check('L2 返回列表成功', backToList)

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

      /* ---------------- 控制台错误 ---------------- */
      console.log('\n[控制台]')
      const jsErrors = consoleErrors.filter((e) => e.startsWith('exception:'))
      const logErrors = consoleErrors.filter((e) => e.startsWith('log:'))
      check('无 JS 运行时异常', jsErrors.length === 0, jsErrors.join(' ; '))
      check('无控制台 error 级日志', logErrors.length === 0, logErrors.join(' ; ').slice(0, 300))
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

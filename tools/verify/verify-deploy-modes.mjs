#!/usr/bin/env node
/**
 * tools/verify/verify-deploy-modes.mjs —— 部署形态（base 取值）的真实浏览器验证
 *
 * 背景：
 *   本项目支持两种「挂到子路径」的做法，但它们的可用性差别很大，
 *   而只检查产物 HTML 字符串（路径前缀对不对）是分不出好坏的 ——
 *   必须真的把产物挂到子路径下、用浏览器打开深层页面，看网络请求和渲染结果。
 *
 *   本脚本自己构建两种产物、分别真实挂载、用 Chrome 逐页取证。
 *
 * 验证的两种形态：
 *   A. base = '/blog/'  固定子路径部署 —— 这是推荐形态
 *   B. base = './'      可重定位构建（relocatable build）
 *
 * 关于形态 B（重要）：
 *   VitePress 官方文档称 './' 产出的「同一份产物在任意子路径都能用」。
 *   实测（Chrome，见下方取证）**不成立**：
 *     - 产物中**所有**页面（含 posts/ 子目录下的）都写 './assets/...'，
 *       没有按目录深度补 '../'；
 *     - 于是根级页面侥幸正确，而 posts/welcome.html 这类页面会把
 *       './assets/' 解析成 '/posts/assets/' → CSS/JS/字体全部 404，
 *       页面无样式、无交互。
 *   本站有 posts/ 子目录，因此形态 B **不适用**。
 *
 *   本脚本把这一点固化成断言：如果将来 VitePress 修好了，
 *   「B 形态深层页面会 404」这条断言会失败，从而提醒我们回来更新文档。
 *
 * 用法：node tools/verify/verify-deploy-modes.mjs
 * 退出码：全部通过为 0。
 */

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const OUT_ROOT = path.join(ROOT, 'tools/verify/.out/deploy')
const PORT = 4311
const PORT_CDP = 9445

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ============================ 断言收集 ============================ */

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  -> ' + detail : ''}`)
}

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

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })

/* ============================ 构建 ============================ */

function build(env, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n... 构建：${label}`)
    const child = spawn('npm', ['run', 'build:site'], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', () => {
      // VitePress 收尾清理 .temp 时，在某些受限环境会被批量删除拦截而退出码非 0，
      // 但此时产物已完整写出。因此以「日志里出现构建完成」为准。
      resolve({ ok: /build complete|rendering pages/.test(out), log: out })
    })
  })
}

/* ============================ CDP ============================ */

function findChrome() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p))
}

async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true })
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
      listeners.forEach((fn) => fn(msg))
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
          reject(new Error('CDP 超时: ' + method))
        }
      }, 30000)
    })
  return {
    send,
    // 返回一个取消订阅函数 —— 必须用，否则上一个探针的监听器会继续
    // 把后续导航的请求记进它自己的结果里，污染已完成的取证。
    on: (fn) => {
      listeners.push(fn)
      return () => {
        const i = listeners.indexOf(fn)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
    close: () => ws.close(),
  }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('页面内异常: ' + (r.exceptionDetails.text || ''))
  return r.result?.value
}

/**
 * 用浏览器打开一个 URL，收集网络失败项与渲染状态。
 * 这是本脚本的核心取证动作 —— 页面是否「真的能用」由它说了算。
 */
async function probeInBrowser(cdp, url, label) {
  const responses = []
  const consoleErrors = []
  const off = cdp.on((m) => {
    if (m.method === 'Network.responseReceived') {
      responses.push({ url: m.params.response.url, status: m.params.response.status })
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('exception: ' + (m.params.exceptionDetails?.text || ''))
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push('log: ' + m.params.entry.text)
    }
  })

  try {
    await cdp.send('Page.navigate', { url })
    await sleep(2600)

    const state = await evaluate(
      cdp,
      `(() => {
        const h1 = document.querySelector('h1')
        return {
          h1: h1 ? h1.innerText.trim().slice(0, 40) : '(无 h1)',
          bodyLen: document.body ? document.body.innerText.trim().length : 0,
          themeCssLoaded: [...document.styleSheets].some((s) => (s.href || '').includes('style.')),
        }
      })()`,
    )

    const bad = responses.filter((r) => r.status >= 400)
    return { url, label, state, bad, ok: responses.length - bad.length, consoleErrors }
  } finally {
    off()
  }
}

/** 打印一次取证结果（人可读） */
function reportProbe(p) {
  console.log(`\n  ${p.label}`)
  console.log(`    页面: h1="${p.state.h1}"  正文 ${p.state.bodyLen} 字  主题CSS=${p.state.themeCssLoaded}`)
  console.log(`    网络: ${p.ok} 个 2xx / ${p.bad.length} 个 4xx+`)
  if (p.bad.length) {
    const byStatus = {}
    for (const b of p.bad) byStatus[b.status] = (byStatus[b.status] || 0) + 1
    console.log(`      失败分布 ${JSON.stringify(byStatus)}`)
    console.log(`      例: ${p.bad[0].url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '')}`)
  }
}

/* ============================ 主流程 ============================ */

let chrome = null
let cdp = null

async function startBrowser() {
  const chromePath = findChrome()
  if (!chromePath) throw new Error('未找到 Chrome / Edge')
  console.log(`浏览器: ${chromePath}`)

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-deploy-'))
  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=1280,900',
      `--remote-debugging-port=${PORT_CDP}`,
      `--user-data-dir=${userDataDir}`,
      '--no-proxy-server',
      '--proxy-bypass-list=<-loopback>',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let wsUrl = null
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`).then((r) => r.json())
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null
    } catch {
      /* 还没起来 */
    }
    if (!wsUrl) await sleep(300)
  }
  if (!wsUrl) throw new Error('无法连接 Chrome 调试端口')

  cdp = await connectCDP(wsUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Log.enable')
}

async function main() {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true })
  fs.mkdirSync(OUT_ROOT, { recursive: true })

  await startBrowser()

  /* ================= 形态 A：固定子路径 /blog/ ================= */
  console.log('\n################ 形态 A：base=/blog/（推荐） ################')
  const relA = 'tools/verify/.out/deploy/blog'
  const bA = await build({ VITE_BASE: '/blog/', VITE_OUT_DIR: relA }, 'VITE_BASE=/blog/')
  if (!bA.ok) {
    console.log(bA.log.slice(-1000))
    check('形态 A 构建成功', false)
  } else {
    const server = await listen(createServer(OUT_ROOT), PORT)
    try {
      const base = `http://127.0.0.1:${PORT}/blog`
      const probes = [
        await probeInBrowser(cdp, `${base}/`, 'A[首页]'),
        await probeInBrowser(cdp, `${base}/posts/welcome.html`, 'A[文章页]'),
        await probeInBrowser(cdp, `${base}/posts/`, 'A[列表页]'),
      ]
      for (const p of probes) reportProbe(p)

      check('A[首页] 渲染出品牌名', /Forge Notes/.test(probes[0].state.h1), probes[0].state.h1)
      check('A[首页] 零失败请求', probes[0].bad.length === 0, `${probes[0].ok} 个 2xx`)
      check('A[首页] 主题样式已加载', probes[0].state.themeCssLoaded)

      check('A[文章页] 渲染出正文', probes[1].state.bodyLen > 500, `${probes[1].state.bodyLen} 字`)
      check('A[文章页] 零失败请求', probes[1].bad.length === 0, `${probes[1].ok} 个 2xx`)
      check('A[文章页] 主题样式已加载（样式隔离住子路径）', probes[1].state.themeCssLoaded)
      check('A[文章页] 无控制台 error', probes[1].consoleErrors.length === 0)

      check('A[列表页] 渲染出正文', probes[2].state.bodyLen > 300, `${probes[2].state.bodyLen} 字`)
      check('A[列表页] 零失败请求', probes[2].bad.length === 0, `${probes[2].ok} 个 2xx`)
      check('A[列表页] 主题样式已加载', probes[2].state.themeCssLoaded)
    } finally {
      server.close()
      await sleep(200)
    }
  }

  /* ============ 形态 B：base=./ 挂到深层路径（记录限制） ============ */
  console.log('\n################ 形态 B：base=./（记录已知限制） ################')
  const relB = 'tools/verify/.out/deploy/relocatable'
  const bB = await build({ VITE_BASE: './', VITE_OUT_DIR: relB }, 'VITE_BASE=./')
  if (!bB.ok) {
    console.log(bB.log.slice(-1000))
    check('形态 B 构建成功', false)
  } else {
    // 把产物整个搬到任意深层路径，模拟「挂到主站某个子目录」
    const deep = path.join(OUT_ROOT, 'deep/nested/some-blog')
    fs.mkdirSync(path.dirname(deep), { recursive: true })
    fs.cpSync(path.join(ROOT, relB), deep, { recursive: true })

    // 先看产物本身：深层页面的资源前缀到底写的是什么
    const postHtml = fs.readFileSync(path.join(deep, 'posts/welcome.html'), 'utf-8')
    const assetRefs = [...new Set(postHtml.match(/(?:href|src)="([^"]*assets\/[^"]*)"/g) || [])]
    const prefix = assetRefs.length ? assetRefs[0].replace(/^[^"]*"/, '').replace(/".*$/, '') : ''
    console.log(`\n  产物取证：posts/welcome.html 的资源前缀 = "${prefix}"`)
    console.log(`  （页面位于 /posts/ 目录下，而资源在站点根 —— 前缀应为 ../assets/ 才正确）`)

    const server = await listen(createServer(OUT_ROOT), PORT)
    try {
      const base = `http://127.0.0.1:${PORT}/deep/nested/some-blog`
      const deepPost = await probeInBrowser(cdp, `${base}/posts/welcome.html`, 'B[深层文章页]')
      const deepList = await probeInBrowser(cdp, `${base}/posts/`, 'B[深层列表页]')
      reportProbe(deepPost)
      reportProbe(deepList)

      // 这两条是「钉住已知限制」的断言：限制若被 VitePress 修好，它们会失败，
      // 提醒我们回来更新 README 与本脚本。
      check(
        'B[深层文章页] 资源确实 404（= 已知限制，未被修复）',
        deepPost.bad.length > 0,
        deepPost.bad.length ? `${deepPost.bad.length} 个失败` : '已全部 200 —— 限制可能已修复，请更新文档',
      )
      check(
        'B[深层文章页] 子目录页面丢失主题样式（实证限制后果）',
        deepPost.state.themeCssLoaded === false,
        `themeCssLoaded=${deepPost.state.themeCssLoaded}`,
      )
    } finally {
      server.close()
      await sleep(200)
    }

    console.log('\n  结论：形态 B 产物的资源前缀不随目录深度调整，')
    console.log('        本站有 posts/ 子目录，因此必须用形态 A（VITE_BASE=/blog/）。')
  }

  /* ========================= 汇总 ========================= */
  const failed = results.filter((r) => !r.pass)
  console.log('\n================ 汇总 ================')
  console.log(`断言总数: ${results.length}`)
  console.log(`通过: ${results.length - failed.length}`)
  console.log(`失败: ${failed.length}`)
  if (failed.length) {
    console.log('\n失败明细:')
    for (const f of failed) console.log(`  [FAIL] ${f.name}  ${f.detail}`)
  }
  console.log(failed.length === 0 ? '\n结果: 全部通过' : '\n结果: 存在失败')
  process.exitCode = failed.length === 0 ? 0 : 1
}

main()
  .catch((e) => {
    console.error('验证脚本异常:', e)
    process.exitCode = 2
  })
  .finally(async () => {
    try {
      cdp?.close()
    } catch {}
    try {
      chrome?.kill()
    } catch {}
  })

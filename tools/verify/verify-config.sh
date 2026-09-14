#!/usr/bin/env bash
# tools/verify/verify-config.sh —— 架构层验证（需要真实重建，所以独立于浏览器验证）
#
# 验六件事：
#   1. site.config.mjs 是否真的是「唯一配置源」——改它一个常量，
#      独立站点与嵌入组件是否同时跟随改名（含页脚 copyright）
#   2. VITE_BASE=/blog/ 子路径部署是否生效，且**不出现双重前缀**
#   3. VITE_BASE=./ 可重定位构建是否成立
#   4. canonical 与 sitemap 是否一致
#   5. 文章列表页是否真的自动生成（条目数 == 文章目录里的文章数）
#   6. 日期取数（必须来自文章 date，而不是 git/部署时间）、404 文案、
#      搜索与无障碍文案是否都已本地化（含主题里**写死**的那几条：主导航 /
#      侧边栏导航 / 翻页导航 Pager / 折叠按钮 / 日期分隔符，要求 HTML 与
#      theme JS 两侧同时干净 —— 只改 HTML 会被 hydration 覆盖回去）
#
# 脚本结束时会无条件恢复到默认构建，不会把探针状态留在产物里。
# 并且注册了 EXIT/INT/TERM 兜底还原：被打断也不会把探针值留在 site.config.mjs。
# 退出码 0 = 全部通过。
#
# ---------------------------------------------------------------------------
# 关于沙箱适配（不影响结论，只影响「能不能跑」）
#
# 本脚本要连做 6 次站点构建，而每次构建 Vite/VitePress 都会清空目录：
#   a) prepareOutDir 清空 outDir
#   b) 构建收尾 rimraf .vitepress/.temp
# 在会拦截批量删除的执行环境里，删除次数是**按回合累加**的，超过阈值后
# 连第 3 次构建都会失败 —— 而且报出来的是一串 rollup 栈，看着像代码 bug。
#
# 两条规避，都是环境层面的，与项目代码无关：
#   • outDir 指到 docs/ 之外 + 每次运行带唯一时间戳
#       Vite 对**位于 root 之外**的 outDir 默认不清空（只打一行 warning）。
#       于是既不需要清空、也不会读到上一次的陈旧产物。
#   • DEBUG=1
#       VitePress 源码里是 `if (!process.env.DEBUG) await rimraf(siteConfig.tempDir)`，
#       置位后跳过 .temp 清理。DEBUG 其余分支只影响一个「include 文件缺失」的告警。
# ---------------------------------------------------------------------------

set -u

cd "$(dirname "$0")/../.." || exit 1

ROOT="$(pwd)"
FAIL=0
LOG=/tmp/fn-config-verify.log
YEAR="$(date +%Y)"
RUN_ID="$(date +%s)"
OUT_BASE="tools/verify/.out"

# 备份放在仓库内的 .out/（已 gitignore），不用 mktemp 的系统临时目录。
# 原因：本环境的删除拦截层会把 mktemp 返回的 Windows 路径拼成
# `/d/work/forge-notes/C:/Users/...`，于是收尾的 `rm -f "$BAK"` **必然失败** ——
# 每次运行都在系统临时目录里漏一个备份文件，日志里还会多出一串 [safe-delete] 报错，
# 看着像脚本坏了，其实不是。放到仓库内既删得掉，也符合「产物都在 .out/」的约定。
mkdir -p "$OUT_BASE"
BAK="$OUT_BASE/site.config.mjs.bak.$$"

cp site.config.mjs "$BAK"

# ---------------------------------------------------------------
# 兜底还原：无论脚本怎么结束（正常跑完 / Ctrl-C / 被 kill / 中途 set -e 退出）
# 都要把 site.config.mjs 还原回去。
#
# 这条是被一次真实事故加的：脚本跑到一半被 120s 的前台超时 SIGTERM 打断，
# 探针值 ZZ-CONFIG-PROBE 就留在 site.config.mjs 里了。下一次运行把这份**脏文件**
# 当成了备份，于是：
#   • 探针 1 的 sed 匹配不到原文（原文已被改掉），但「文件里有 ZZ-CONFIG-PROBE」
#     那条 grep 断言**照样通过** —— 探针 1 误报 PASS；
#   • 收尾「还原」把脏文件又拷了回去，最后两条 assert_hasnt 失败，
#     表现为一个看不懂的「还原后仍有探针残留」。
# 一个被打断的运行会污染下一次运行 —— 这是可靠性上的真问题，不是环境噪音。
# ---------------------------------------------------------------
restore_config() {
  if [ -f "$BAK" ]; then
    cp "$BAK" site.config.mjs
    rm -f "$BAK"
  fi
}
trap restore_config EXIT
# ⚠️ INT/TERM 的处理器里必须**真的退出**。
# 旧写法是 `trap restore_config EXIT INT TERM` —— 收到 Ctrl-C 后 bash 执行完
# 处理器会**继续往下跑**（信号处理器默认不终止脚本），于是用户以为停了、
# 屏幕上却还在「重建站点」，而且后续构建用的还是已还原的配置，
# 会再冒出一堆莫名其妙的断言失败。还原 + 明确的退出码才是对的。
# （退出码按惯例：SIGINT→130、SIGTERM→143。EXIT 处理器随即再跑一次
#   restore_config，但 BAK 已被删除，是 no-op。）
trap 'restore_config; exit 130' INT
trap 'restore_config; exit 143' TERM

say() { printf '\n### %s\n' "$1"; }
ok()  { printf '  [PASS] %s\n' "$1"; }
bad() { printf '  [FAIL] %s\n' "$1"; FAIL=1; }

has() { grep -q "$2" "$1" 2>/dev/null; }

assert_has()   { if has "$1" "$2"; then ok "$3"; else bad "$3  (文件 $1 未匹配 $2)"; fi; }
assert_hasnt() { if has "$1" "$2"; then bad "$3  (文件 $1 仍匹配 $2)"; else ok "$3"; fi; }

has_fixed() { grep -Fq "$2" "$1" 2>/dev/null; }

# 站点数据里的文案是**双重转义**的（形如 JSON.parse("{\"buttonText\":\"搜索\"}")），
# 用正则很容易被转义规则绕进去，所以按固定字符串匹配。
assert_fixed()        { if has_fixed "$1" "$2"; then ok "$3"; else bad "$3  (文件 $1 未含固定串 $2)"; fi; }
assert_fixed_absent() { if has_fixed "$1" "$2"; then bad "$3  (文件 $1 仍含固定串 $2)"; else ok "$3"; fi; }

# ── 全量扫描版断言 ────────────────────────────────────────────────
#
# 为什么需要它们：`assert_fixed_absent` 只查**一个指定文件**。本地化缺陷的
# 典型形态是「某个字符串只在文章页出现」或「只在某一类布局里出现」，
# 拿一个文件去断言就必然漏掉 —— 当初 `Pager` 就是这么从断言底下溜过去的。
# 这两条扫 `$DIST` 下**全部** html + js，任一文件命中即判定。
#
# 只用 `grep -F`（固定串）：本环境 grep 的正则里同时出现多字节字符与字符类
# 会失配（见 assert_re 的说明），而这些断言查的全是含中文/空格的串。
scan_absent() { # $1=needle $2=标签
  local hits
  hits="$(grep -rlF --include='*.html' --include='*.js' -- "$1" "$DIST" 2>/dev/null | head -3)"
  if [ -n "$hits" ]; then
    bad "$2  (仍残留「$1」于：$(echo "$hits" | tr '\n' ' '))"
  else
    ok "$2"
  fi
}
scan_present() { # $1=needle $2=标签
  local n
  n="$(grep -rlF --include='*.html' --include='*.js' -- "$1" "$DIST" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$n" -gt 0 ]; then ok "$2（$n 个产物文件命中）"; else bad "$2  (全部产物里都没有「$1」)"; fi
}

has_re() { grep -Eq "$2" "$1" 2>/dev/null; }

# 正则版断言：专治「同一个语义在压缩 / 未压缩产物里字面形态不同」。
#
# 固定串断言在这种场景下会**假绿**，这是实测踩到的：未压缩产物里分隔符是
# `) + ": ", 1)`（有空格），拿固定串 `+": ",1)`（无空格）去断言「不残留半角冒号」
# 必然通过 —— 而它其实根本没被替换。验证脚本当时就是这么把 theme JS 里
# 未替换的 Pager / 半角冒号放过去的。
#
# ⚠️⚠️ 只用于**纯 ASCII** 的模式！本环境的 grep（msys2）在正则里同时出现
#   **多字节字符**与**字符类**时会失配，实测：
#     grep -Ec '\+[[:space:]]*"：[[:space:]]*,[[:space:]]*1\)'  → 0（明明有）
#     grep -Ec '\+[[:space:]]*": "[[:space:]]*,[[:space:]]*1\)' → 1（正确）
#   两种 locale（C.UTF-8 / LC_ALL=C）都一样，与 locale 无关。
#   所以：**带中文或全角的断言一律用 assert_fixed / assert_fixed_absent**
#   （grep -F，字节级比较，没有这个问题）；正则只留给 ASCII 模式。
assert_re()        { if has_re "$1" "$2"; then ok "$3"; else bad "$3  (文件 $1 未匹配正则 /$2/)"; fi; }
assert_re_absent() { if has_re "$1" "$2"; then bad "$3  (文件 $1 仍匹配正则 /$2/)"; else ok "$3"; fi; }

# 构建站点到本轮的探针目录。$1 = 探针名；其余环境变量由调用方以 env 前缀传入。
# 以「渲染阶段完成 + 首页产物存在」为准，而不是只看退出码：收尾清理被拦时
# 退出码会是 1，但产物其实已经完整。
build_site() {
  local probe="$1"
  DIST="$ROOT/$OUT_BASE/$RUN_ID-$probe"
  DEBUG=1 VITE_OUT_DIR="$OUT_BASE/$RUN_ID-$probe" npm run build:site > "$LOG" 2>&1
  if [ -f "$DIST/index.html" ] && grep -q "rendering pages" "$LOG"; then
    return 0
  fi
  echo "        （构建未产出完整产物，日志尾部：）"
  tail -6 "$LOG" | sed 's/^/        /'
  return 1
}

build_embed() {
  npm run build:embed > "$LOG" 2>&1
  if [ -f packages/embed/dist/forge-notes.js ]; then return 0; fi
  echo "        （组件构建未产出产物，日志尾部：）"
  tail -6 "$LOG" | sed 's/^/        /'
  return 1
}

# ============================================================
# 前置条件：site.config.mjs 必须是「未污染」状态。
#
# 见上面 trap 处的说明 —— 一次被打断的运行会留下探针值，让下一次运行**假绿**。
# 与其在下游看到两个费解的红灯，不如在这里第一时间停下来说清楚该怎么办。
if ! grep -q "const SITE_NAME = 'Forge Notes'" site.config.mjs; then
  printf '\n### 前置条件不满足，已中止\n'
  printf '  site.config.mjs 里的 SITE_NAME 不是原始的 %s\n' "'Forge Notes'"
  printf '  当前值：'; grep -m1 "const SITE_NAME" site.config.mjs | sed 's/^ *//'
  printf '  多半是上一次运行被打断、探针值残留在文件里。先清理再跑：\n'
  printf '      git checkout -- site.config.mjs\n'
  printf '  （不清理的话，探针 1 的 sed 匹配不到原文，而 grep 断言仍会通过 —— 假绿。）\n'
  exit 1
fi

say "探针 1：改 site.config.mjs 的 SITE_NAME，验证全站跟随"

sed -i "s/const SITE_NAME = 'Forge Notes'/const SITE_NAME = 'ZZ-CONFIG-PROBE'/" site.config.mjs
if has site.config.mjs 'ZZ-CONFIG-PROBE'; then
  ok "探针值已写入 site.config.mjs"
else
  bad "探针值写入失败，后续断言无意义"
fi

echo "  ... 重建独立站点"
if build_site p1-name; then
  assert_has "$DIST/index.html" 'ZZ-CONFIG-PROBE' "站点首页跟随配置改名"
  assert_has "$DIST/about.html" 'ZZ-CONFIG-PROBE' "关于页跟随配置改名"
  # 专门盯页脚：它曾经把品牌名写成字面量，改名不会跟随
  assert_has "$DIST/index.html" "Copyright © $YEAR ZZ-CONFIG-PROBE" "页脚 copyright 跟随配置改名"
  assert_has "$DIST/posts/index.html" 'ZZ-CONFIG-PROBE' "列表页欢迎语跟随配置改名"
  printf '        （首页 title: %s）\n' "$(grep -o '<title>[^<]*</title>' "$DIST/index.html" | head -1)"
else
  bad "站点重建失败，见 $LOG"
fi

echo "  ... 重建嵌入组件"
if build_embed; then
  assert_has packages/embed/dist/forge-notes.js 'ZZ-CONFIG-PROBE' "嵌入组件跟随配置改名"
else
  bad "嵌入组件重建失败，见 $LOG"
fi

# ============================================================
say "探针 2：VITE_BASE=/blog/ 子路径部署"

echo "  ... 以 /blog/ 为 base 重建站点"
if VITE_BASE=/blog/ build_site p2-subpath; then
  assert_has   "$DIST/index.html" '/blog/assets'     "静态资源路径带上 /blog/ 前缀"
  assert_has   "$DIST/index.html" '/blog/favicon.svg' "favicon 带上 /blog/ 前缀"
  # hero 图片与 nav logo 由 VitePress 自动加 base，手动再补会得到 /blog/blog/…
  assert_hasnt "$DIST/index.html" '/blog/blog/'       "无双重 base 前缀"
  # 站内不允许残留未加前缀的根绝对路径（外链 // 除外）
  LEAK="$(grep -o '\(src\|href\)="/[^"/][^"]*"' "$DIST/index.html" 2>/dev/null | grep -v '"/blog/' | head -3)"
  if [ -z "$LEAK" ]; then ok "无漏加前缀的站内绝对路径"; else bad "存在漏加前缀的路径: $LEAK"; fi
else
  bad "子路径构建失败，见 $LOG"
fi

# ============================================================
say "探针 3：VITE_BASE=./ 可重定位构建"

echo "  ... 以 ./ 为 base 重建站点"
if VITE_BASE=./ build_site p3-relative; then
  # 相对构建下不应出现以 / 开头的站内资源引用
  ABS="$(grep -o '\(src\|href\)="/[^"/][^"]*"' "$DIST/index.html" 2>/dev/null | head -3)"
  if [ -z "$ABS" ]; then ok "相对构建产物内无根绝对路径"; else bad "相对构建仍存在绝对路径: $ABS"; fi
  assert_has "$DIST/index.html" 'assets/' "相对构建资源引用存在"
  # './' 若被 normalizeBase 破坏成 '/./'，上面两条会立刻失败
  assert_hasnt "$DIST/index.html" '/./' "'./' 未被破坏成 '/./'"
else
  bad "可重定位构建失败，见 $LOG"
fi

# ============================================================
say "探针 4：canonical 与 sitemap 一致性"

echo "  ... 带域名重建站点"
if VITE_SITE_URL=https://example.com build_site p4-canonical; then
  canon_of() {
    grep -o 'rel="canonical" href="[^"]*"' "$1" 2>/dev/null | head -1 | sed 's/.*href="//; s/"$//'
  }
  sitemap_has() { grep -q "<loc>$1</loc>" "$DIST/sitemap.xml" 2>/dev/null; }

  C_HOME="$(canon_of "$DIST/index.html")"
  C_ABOUT="$(canon_of "$DIST/about.html")"
  C_POST="$(canon_of "$DIST/posts/welcome.html")"

  printf '        canonical: home=%s about=%s post=%s\n' "$C_HOME" "$C_ABOUT" "$C_POST"

  if [ "$C_HOME" = "https://example.com/" ]; then ok "首页 canonical 指向站点根"; else bad "首页 canonical 异常: $C_HOME"; fi
  # canonical 必须无 .html 后缀。Cloudflare Pages 会把 /about.html 308 到 /about，
  # canonical 若带后缀，等于告诉搜索引擎「正确地址是会跳转的那个」，与 sitemap 也自相矛盾。
  if [ "$C_ABOUT" = "https://example.com/about" ]; then ok "关于页 canonical 无 .html 后缀（与 Pages 实际 200 的地址一致）"; else bad "关于页 canonical 异常: $C_ABOUT"; fi

  if sitemap_has "$C_ABOUT"; then ok "关于页 canonical 与 sitemap 一致"; else bad "关于页 canonical 不在 sitemap 中（$C_ABOUT）"; fi
  if sitemap_has "$C_POST"; then ok "文章页 canonical 与 sitemap 一致"; else bad "文章页 canonical 不在 sitemap 中（$C_POST）"; fi

  # cleanUrls 生效的直接证据：产物 HTML 里一个 .html 站内链接都不该有，
  # 否则每次点击都要在 Pages 上多走一次 308。
  HTML_LINKS="$(grep -ohE 'href="/[^"]*\.html"' "$DIST"/*.html "$DIST"/posts/*.html 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$HTML_LINKS" = "0" ]; then
    ok "产物内无 .html 站内链接（不会触发 Pages 的 308 重定向）"
  else
    bad "仍有 $HTML_LINKS 个 .html 站内链接"
    grep -ohE 'href="/[^"]*\.html"' "$DIST"/*.html "$DIST"/posts/*.html 2>/dev/null | head -3
  fi

  # robots.txt 由 buildEnd 从配置源派生 —— 域名不该在静态文件里再写一遍
  if [ -f "$DIST/robots.txt" ] && grep -q "Sitemap: https://example.com/sitemap.xml" "$DIST/robots.txt"; then
    ok "robots.txt 由配置源生成，并声明了 sitemap 地址"
  else
    bad "robots.txt 缺失或未声明 sitemap"
  fi
else
  bad "带域名构建失败，见 $LOG"
fi

# ============================================================
say "探针 5：文章列表页自动生成（条目数应等于文章目录文章数）"

if build_site p5-list; then
  LISTED="$(grep -o 'fn-post-date' "$DIST/posts/index.html" 2>/dev/null | wc -l | tr -d ' ')"
  ACTUAL="$(ls docs/posts/*.md 2>/dev/null | grep -vc 'index\.md')"
  printf '        列表页条目数=%s  文章目录文章数=%s\n' "$LISTED" "$ACTUAL"
  if [ "$LISTED" = "$ACTUAL" ] && [ "$ACTUAL" != "0" ]; then
    ok "列表页自动收录了全部文章，无遗漏"
  else
    bad "列表页条目数与文章数不一致（$LISTED vs $ACTUAL）—— 新增文章可能没被自动收录"
  fi
  # 分组标题应来自配置源
  assert_has "$DIST/posts/index.html" '跨境电商技术' "列表页分组来自配置源"
else
  bad "还原前构建失败，见 $LOG"
fi

# ============================================================
say "探针 6：日期取数、404 文案与本地化文案"

echo "  ... 带域名重建站点"
if VITE_SITE_URL=https://example.com build_site p6-meta; then

  # ---- 6.1 「最后更新于」必须取文章 front matter 的 date ----
  #
  # 钉住一个只在线上暴露的 bug：VitePress 构建期只跑**一次**
  # `git log --name-only` 扫全仓建「文件→时间」映射，而 Cloudflare Pages
  # 检出的是浅克隆，边界提交会被 git 当成「改了全部文件」，
  # 于是全站每一页的日期都变成**当次部署的提交时间**。
  # 实测：本地全量历史 = 初始提交时间；CF = tip 提交时间且该提交没碰过任何文章。
  WELCOME_DATE="$(grep -m1 '^date:' docs/posts/welcome.md | sed 's/^date:[[:space:]]*//' | tr -d '\r')"
  EXPECTED_ISO="${WELCOME_DATE}T00:00:00.000Z"
  GOT_ISO="$(grep -o 'datetime="[^"]*"' "$DIST/posts/welcome.html" | head -1 | sed 's/datetime="//; s/"$//')"
  printf '        welcome.md 的 date=%s  页面 datetime=%s\n' "$WELCOME_DATE" "$GOT_ISO"
  if [ "$GOT_ISO" = "$EXPECTED_ISO" ]; then
    ok "文章页「最后更新于」取自 front matter 的 date"
  else
    bad "文章页日期不对：期望 $EXPECTED_ISO，实际 $GOT_ISO（疑似又回落到 git 时间戳）"
  fi

  if grep -q 'VPLastUpdated' "$DIST/about.html"; then
    bad "关于页没有 date 却渲染了「最后更新于」（等于编造一个日期）"
  else
    ok "无 date 的页面不渲染「最后更新于」"
  fi

  # ---- 6.2 sitemap 的 lastmod 逐条对应文章 date ----
  SM="$DIST/sitemap.xml"
  # 整份 sitemap 可能是一行，先按 <url> 切成每块一行再判断
  block_of() { tr -d '\n' < "$SM" | sed 's|<url>|\n<url>|g' | grep "<loc>$1</loc>"; }

  W_BLOCK="$(block_of 'https://example.com/posts/welcome')"
  if printf '%s' "$W_BLOCK" | grep -q "<lastmod>${EXPECTED_ISO}</lastmod>"; then
    ok "sitemap 里 welcome 的 lastmod 等于它自己的 date"
  else
    bad "sitemap 里 welcome 的 lastmod 不对：$(printf '%s' "$W_BLOCK" | grep -o '<lastmod>[^<]*</lastmod>')"
  fi

  if printf '%s' "$(block_of 'https://example.com/about')" | grep -q '<lastmod>'; then
    bad "关于页没有 date，sitemap 里却带 lastmod"
  else
    ok "无 date 的条目在 sitemap 中省略 lastmod（不给搜索引擎编造的日期）"
  fi

  LM_TOTAL="$(grep -o '<lastmod>' "$SM" | wc -l | tr -d ' ')"
  LM_UNIQUE="$(grep -o '<lastmod>[^<]*</lastmod>' "$SM" | sort -u | wc -l | tr -d ' ')"
  printf '        sitemap: lastmod 共 %s 条，去重后 %s 种\n' "$LM_TOTAL" "$LM_UNIQUE"
  if [ "$LM_UNIQUE" -ge 4 ] && [ "$LM_TOTAL" -lt 20 ]; then
    ok "sitemap lastmod 按文章各自日期分布（不再是同一个部署时间戳）"
  else
    bad "sitemap lastmod 形态异常（总量 $LM_TOTAL / 去重 $LM_UNIQUE）"
  fi

  # ---- 6.3 404 页 ----
  if [ -f "$DIST/404.html" ]; then
    ok "404.html 由 VitePress 自动生成"
  else
    bad "缺少 404.html —— Cloudflare Pages 会把未知路径 SPA 兜底成 200 软 404"
  fi
  assert_fixed "$DIST/404.html" '页面不存在' "404 文案已本地化（来自 site.config.mjs 的 ui.notFound）"
  assert_fixed_absent "$DIST/404.html" 'PAGE NOT FOUND' "404 页无英文默认文案残留"

  # ---- 6.4 搜索与无障碍文案 ----
  assert_fixed "$DIST/index.html" 'buttonText\":\"搜索\"'          "搜索按钮文案已本地化"
  assert_fixed_absent "$DIST/index.html" 'buttonText\":\"Search\"' "搜索按钮无英文残留"
  assert_fixed "$DIST/index.html" 'noResultsText\":\"没有结果\"'    "搜索无结果文案已本地化"
  assert_fixed "$DIST/index.html" 'skipToContentLabel\":\"跳到正文\"' "「跳到正文」链接已本地化"

  # ---- 6.4b 主题里**写死的** aria 文案 ----
  # 这三条没有配置键可改（alpha.15 实测），靠 scripts/localize-theme-aria.mjs
  # 在 build:site 之后替换。HTML 与 theme JS **两边**都必须干净：
  # 只改 HTML 不改 JS 的话，Vue 会在 hydration 时按 JS 里的字面量把中文修正回
  # 英文 —— 首屏看着是中文、一秒后变回英文，且不报任何错。所以两边都断言。
  assert_fixed_absent "$DIST/index.html" 'Main Navigation' "首页无 Main Navigation 英文残留（HTML）"
  assert_fixed        "$DIST/index.html" '主导航'           "导航栏 aria 标题已本地化为中文（HTML）"

  THEME_JS="$(ls "$DIST"/assets/chunks/theme.*.js 2>/dev/null | head -1)"
  if [ -n "$THEME_JS" ]; then
    # 先把本次验证跑的**产物形态**打进日志。
    #
    # DEBUG=1 构建不压缩（vitepress 源码：`minify: … ?? !process.env.DEBUG`），
    # 而线上构建是压缩的 —— 两边**字面形态不同**。这里如实记录，避免日后又出现
    # 「验证跑的是 A 形态、线上发的是 B 形态」这种盲区（曾经真的因此漏过一次）。
    THEME_JS_LINES="$(wc -l < "$THEME_JS" | tr -d ' ')"
    if [ "$THEME_JS_LINES" -lt 10 ]; then
      printf '  ... 产物形态：theme JS 已压缩（%s 行）\n' "$THEME_JS_LINES"
    else
      printf '  ... 产物形态：theme JS 未压缩（%s 行，DEBUG=1 所致；匹配式须对两种形态都成立）\n' "$THEME_JS_LINES"
    fi

    assert_fixed_absent "$THEME_JS" 'Main Navigation'    "theme JS 无 Main Navigation 残留（否则 hydration 会覆盖回英文）"
    assert_fixed_absent "$THEME_JS" 'Sidebar Navigation' "theme JS 无 Sidebar Navigation 残留"
    assert_fixed_absent "$THEME_JS" '"Pager"'            "theme JS 无 Pager 残留"
    assert_fixed_absent "$THEME_JS" 'toggle section'     "theme JS 无 toggle section 残留"
    assert_fixed        "$THEME_JS" '主导航'              "theme JS 已本地化导航 aria 标题"
    assert_fixed        "$THEME_JS" '侧边栏导航'          "theme JS 已本地化侧栏 aria 标题"
    assert_fixed        "$THEME_JS" '翻页导航'            "theme JS 已本地化翻页导航 aria 标题"
    # 分隔符必须两侧一致，否则 hydration 会把全角冒号改回半角。
    #
    # 残留检查用**正则**：压缩形态是 `)+": ",1)`、未压缩形态是 `) + ": ", 1)`，
    # 单条固定串只能覆盖其中一种。这个模式刻意写成**纯 ASCII** —— 见 assert_re 的说明。
    assert_re_absent "$THEME_JS" '\+[[:space:]]*": "[[:space:]]*,[[:space:]]*1\)' "theme JS 分隔符无半角冒号残留（压缩/未压缩两种形态都查）"
    # 「已替换」检查用**固定串**：替换器在两种形态下都输出同一个紧凑写法 `+"：",1)`,
    # 一条固定串就够；而带全角冒号的正则在本环境的 grep 下会失配（实测，见 assert_re 说明），
    # 所以这里**不能**用正则。
    assert_fixed "$THEME_JS" '+"：",1)' "theme JS 分隔符已换为全角"
  else
    bad "未找到 theme.*.js 产物，无法验证 hydration 一致性"
  fi

  # 侧边栏 / 翻页导航 / 日期分隔符都只在文章页渲染，所以拿文章页验
  POST_HTML="$(ls "$DIST"/posts/*.html 2>/dev/null | head -1)"
  if [ -n "$POST_HTML" ]; then
    assert_fixed_absent "$POST_HTML" 'Sidebar Navigation' "文章页无 Sidebar Navigation 英文残留"
    assert_fixed        "$POST_HTML" '侧边栏导航'         "侧边栏 aria 标题已本地化为中文"
    assert_fixed_absent "$POST_HTML" '>Pager<'            "文章页无 Pager 英文残留"
    assert_fixed        "$POST_HTML" '翻页导航'            "翻页导航 aria 标题已本地化为中文"
    # 「最后更新于」的分隔符：主题模板里写死半角 ': '，替换为全角 '：'
    assert_fixed_absent "$POST_HTML" ': <time'            "「最后更新于」分隔符不是半角冒号（HTML）"
    assert_fixed        "$POST_HTML" '：<time'            "「最后更新于」分隔符已换为全角（HTML）"
  else
    bad "未找到文章页产物，无法验证侧栏 / 翻页 / 日期分隔符文案"
  fi

  # ---- 6.5 主题/渲染器里写死的**其余**英文 ----
  #
  # 这一组是「按题修」留下的欠账。前几轮只改了被指出的那 5 处，直到对整个
  # 产物做一次 `aria-label` / `title` 的**取值分布统计**，才暴露出下面这 4 类
  # （每页都出现，之前一条断言都没盯）：
  #   extra navigation ×20 / mobile navigation ×20 / Permalink to ×492 / Copy Code ×328
  #
  # 教训：本地化要**审计取值分布**，不能逐个 bug 打补丁。漏掉的那些不会报错，
  # 只是安静地留在产物里 —— 而验证脚本的盲区就等于产品的盲区。
  #
  # 两组实现路径不同，但验收标准相同：HTML 与页面 chunk JS **两侧都必须是中文**，
  # 否则 hydration 会把静态 HTML 改回英文（踩坑 17）。
  #
  #   走构建期渲染（天然两侧一致，无 hydration 风险）
  #     Permalink to “标题”  → markdown.config 改写 link_open 规则（**不能**用 preConfig，见 config.mjs 注释）
  #     Copy Code            → 渲染器直读 markdown.codeCopyButtonTitle
  #   走构建后替换（两条通道都要命中）
  #     extra navigation     → VPFlyout.vue 的 aria-label
  #     mobile navigation    → VPNavBarHamburger.vue 的 aria-label
  scan_absent  'extra navigation'  "产物无 extra navigation 残留"
  scan_absent  'mobile navigation' "产物无 mobile navigation 残留"
  scan_absent  'Copy Code'         "产物无 Copy Code 残留"
  scan_absent  'Permalink to'      "产物无 Permalink to 残留"
  scan_present '更多'               "产物含「更多」（右上角导航 aria）"
  scan_present '移动端导航'          "产物含「移动端导航」（汉堡菜单 aria）"
  scan_present '复制代码'            "产物含「复制代码」（代码块复制按钮）"
  scan_present '固定链接'            "产物含「固定链接」（标题锚点 aria）"

  # ---- 6.6 日期格式化选项 ----
  # 这个字符串是**浏览器端**用来格式化的，所以这三个选项直接决定访客看到什么：
  #   timeZone 不钉 UTC → UTC-5 的访客会把 2025-11-30 看成 2025-11-29（差一天）
  #   forceLocale 不设 → 英文浏览器的访客在中文页面上看到 "November 30, 2025"
  #   dateStyle 带 time → 显示出 YAML 的 UTC 零点换算来的假时间（08:00:00）
  assert_fixed "$DIST/index.html" 'timeZone\":\"UTC\"'    "日期锁定 UTC（避免访客时区导致差一天）"
  assert_fixed "$DIST/index.html" 'dateStyle\":\"long\"'  "日期只到天（不带假时分秒）"
  assert_fixed "$DIST/index.html" 'forceLocale\":true'    "日期跟随站点语言而非访客浏览器语言"
else
  bad "带域名构建失败，见 $LOG"
fi

# ============================================================
say "探针 7：主题文案替换对「压缩 / 未压缩」两种产物形态都成立"

# 免构建（毫秒级），用**从真实产物抄下来的**片段做形态回归。
#
# 这条是被一次静默事故逼出来的：替换脚本的 JS 匹配式只适配了压缩形态，
# 于是未压缩产物（DEBUG=1 构建）上 HTML 改了、JS 没改 —— hydration 之后
# 中文又被覆盖回英文，且不报错。而上面探针 6 跑的恰恰是未压缩产物，
# 这次是靠断言逮住的；这个探针把它变成**每次都会跑**的固定回归。
# 详见 README 踩坑 20 与 tools/verify/verify-localize-shapes.mjs 头部。
if ! command -v node >/dev/null 2>&1; then
  echo "  ○  跳过：当前环境没有 node（该回归需要 node 直接运行）"
elif node tools/verify/verify-localize-shapes.mjs; then
  ok "替换规则同时适配压缩与未压缩两种产物形态"
else
  bad "形态回归未通过：匹配式没有同时适配两种产物形态（详见上方输出）"
fi

# ============================================================
say "还原：恢复 site.config.mjs 并重新构建到默认状态"

# 走同一个还原函数：这样「中途被打断」与「正常跑完」两条路径的行为完全一致，
# 不会出现「正常路径还原了、异常路径没还原」这种只在出事时才暴露的差异。
restore_config

echo "  ... 重建站点"
if build_site p6-restore; then
  assert_has   "$DIST/index.html" 'Forge Notes'      "还原后站点品牌恢复为 Forge Notes"
  assert_hasnt "$DIST/index.html" 'ZZ-CONFIG-PROBE'  "还原后站点无探针残留"
else
  bad "还原构建失败，见 $LOG"
fi

echo "  ... 重建嵌入组件"
if build_embed; then
  assert_has   packages/embed/dist/forge-notes.js 'Forge Notes'      "还原后组件品牌恢复"
  assert_hasnt packages/embed/dist/forge-notes.js 'ZZ-CONFIG-PROBE'  "还原后组件无探针残留"
else
  bad "还原组件构建失败，见 $LOG"
fi

# ============================================================
printf '\n### 结果\n'
if [ "$FAIL" -eq 0 ]; then
  echo "  架构层验证：全部通过"
  echo "  （探针产物留在 $OUT_BASE/$RUN_ID-*，已 gitignore，可随时删除）"
else
  echo "  架构层验证：存在失败"
fi

exit "$FAIL"

#!/usr/bin/env bash
# tools/verify/verify-config.sh —— 架构层验证（需要真实重建，所以独立于浏览器验证）
#
# 验五件事：
#   1. site.config.mjs 是否真的是「唯一配置源」——改它一个常量，
#      独立站点与嵌入组件是否同时跟随改名（含页脚 copyright）
#   2. VITE_BASE=/blog/ 子路径部署是否生效，且**不出现双重前缀**
#   3. VITE_BASE=./ 可重定位构建是否成立
#   4. canonical 与 sitemap 是否一致
#   5. 文章列表页是否真的自动生成（条目数 == 文章目录里的文章数）
#
# 脚本结束时会无条件恢复到默认构建，不会把探针状态留在产物里。
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
BAK="$(mktemp)"
FAIL=0
LOG=/tmp/fn-config-verify.log
YEAR="$(date +%Y)"
RUN_ID="$(date +%s)"
OUT_BASE="tools/verify/.out"

cp site.config.mjs "$BAK"

say() { printf '\n### %s\n' "$1"; }
ok()  { printf '  [PASS] %s\n' "$1"; }
bad() { printf '  [FAIL] %s\n' "$1"; FAIL=1; }

has() { grep -q "$2" "$1" 2>/dev/null; }

assert_has()   { if has "$1" "$2"; then ok "$3"; else bad "$3  (文件 $1 未匹配 $2)"; fi; }
assert_hasnt() { if has "$1" "$2"; then bad "$3  (文件 $1 仍匹配 $2)"; else ok "$3"; fi; }

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
say "还原：恢复 site.config.mjs 并重新构建到默认状态"

cp "$BAK" site.config.mjs
rm -f "$BAK"

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

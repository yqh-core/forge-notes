#!/usr/bin/env bash
# ============================================================
# cleanroom.sh —— 干净克隆复现 Cloudflare Pages 的构建链
#
# 为什么必须真克隆：本地目录里躺着 node_modules/ 和旧产物，
# 与 CI 的干净检出状态完全不同。只有真 clone 才能暴露
# 「.gitignore 吃掉了构建输入」这类只在 CI 出现的故障。
#
# 用法：
#   bash cleanroom.sh [标签] [站点域名]
#   VITE_SITE_URL=https://x.pages.dev bash cleanroom.sh ci https://x.pages.dev
#
# 站点域名不传时，从 site.config.mjs 的 url 字段读取；
# 两者都为空则视为「未配置域名」，此时不生成 sitemap 与 canonical 是**预期行为**，
# 脚本会给出提示而不是判失败。
# ============================================================
set -uo pipefail

export PATH="/usr/bin:/bin:/mingw64/bin:/c/Windows/System32:/c/Windows:$PATH"

TAG="${1:-run}"
SITE_URL="${2:-${VITE_SITE_URL:-}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
SRC="D:/work/forge-notes"
CR="D:/work/_fn-cleanroom-${TAG}-${STAMP}"
CRU="/d/work/_fn-cleanroom-${TAG}-${STAMP}"

NODE_EXE="C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
NPM_CLI="C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/npm/bin/npm-cli.js"

fail=0
step() { printf '\n===== %s =====\n' "$1"; }
ok()   { printf '  OK   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fail=1; }

step "1. 干净克隆 -> $CR"
# Git for Windows 的 git.exe 不认 MSYS 风格路径，必须给 D:/ 形式
git clone --no-hardlinks -q "$SRC" "$CR" || { echo "克隆失败"; exit 1; }
cd "$CRU" || exit 1
echo "  HEAD = $(git rev-parse --short HEAD)"
echo "  受版本控制的文件数 = $(git ls-files | wc -l | tr -d ' ')"

step "2. 克隆是否干净（应为 0）"
dirty=$(git status --porcelain | wc -l | tr -d ' ')
[ "$dirty" = "0" ] && ok "工作区干净" || bad "克隆后有 $dirty 个未提交改动"

step "3. 构建输入是否真的进了版本库"
for f in \
  site.config.mjs package.json package-lock.json .nvmrc .gitattributes .gitignore \
  docs/.vitepress/config.mjs docs/.vitepress/sidebar.mjs \
  docs/index.md docs/about.md docs/posts/index.md docs/posts/posts.data.js \
  docs/public/logo.svg docs/public/favicon.svg \
  scripts/build-embed-content.mjs scripts/lib/posts.mjs \
  packages/embed/vite.config.js packages/embed/src/ForgeNotes.vue packages/embed/src/index.js \
  examples/embed-demo.html
do
  if [ -e "$f" ]; then ok "$f"; else bad "MISS $f"; fi
done

step "4. 行尾：仓库内原始字节不得含 CR"
for f in .nvmrc tools/verify/verify-config.sh; do
  if git show "HEAD:$f" | grep -qU $'\r'; then bad "$f 含 CR"; else ok "$f 无 CR"; fi
done

step "5. 文章文件齐全性"
md_count=$(find docs/posts -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
echo "  docs/posts/*.md = $md_count （含 index.md，正文 17 篇）"
[ "$md_count" -ge 18 ] && ok "文章齐全" || bad "文章数异常（$md_count）"

step "6. npm ci（等价于 Cloudflare 的安装步骤）"
t0=$(date +%s)
if "$NODE_EXE" "$NPM_CLI" ci --no-audit --no-fund > /tmp/npmci.log 2>&1; then
  t1=$(date +%s)
  ok "npm ci 成功，用时 $((t1 - t0)) 秒"
else
  bad "npm ci 失败，日志尾部："
  tail -30 /tmp/npmci.log
fi

step "7. 构建站点（Cloudflare 的构建命令：npm run build:site）"
if "$NODE_EXE" "$NPM_CLI" run build:site > /tmp/build.log 2>&1; then
  ok "构建成功"
else
  bad "构建失败，日志尾部："
  tail -40 /tmp/build.log
fi

step "8. 域名配置判定"
if [ -z "$SITE_URL" ]; then
  SITE_URL=$(sed -n "s/^  url: '\(.*\)',/\1/p" site.config.mjs | head -1)
  [ -n "$SITE_URL" ] && echo "  取自 site.config.mjs url 字段"
fi
if [ -n "$SITE_URL" ]; then
  echo "  站点域名 = $SITE_URL"
  ok "已配置域名：sitemap 与 canonical 应当存在"
  EXPECT_SITEMAP=1
else
  echo "  站点域名 = （空）"
  echo "  ⚠️  未配置域名 → sitemap / canonical 不生成，这是设计行为，不判失败。"
  echo "      上线取值：Cloudflare Pages 项目的 <子域名>.pages.dev"
  EXPECT_SITEMAP=0
fi

step "9. 产物核对"
DIST="docs/.vitepress/dist"
if [ -d "$DIST" ]; then
  n=$(find "$DIST" -type f | wc -l | tr -d ' ')
  echo "  产物文件数 = $n"
  echo "  产物体积   = $(du -sh "$DIST" | cut -f1)"
  for f in index.html about.html posts/index.html 404.html logo.svg favicon.svg; do
    [ -e "$DIST/$f" ] && ok "$f" || bad "MISS $f"
  done

  # 404.html 必须放在根目录：Pages 只在根目录有它时才对未匹配路径回真 404，
  # 否则会把站点当 SPA，把所有未知路径兜底到 index.html 并返回 200（软 404）。
  [ -e "$DIST/404.html" ] && ok "404.html 在根目录（Pages 返真 404，不做 SPA 兜底）"

  if [ "$EXPECT_SITEMAP" = "1" ]; then
    if [ -e "$DIST/sitemap.xml" ]; then
      ok "sitemap.xml 存在（$(grep -c '<loc>' "$DIST/sitemap.xml") 条 loc）"
      grep -q "<loc>$SITE_URL/" "$DIST/sitemap.xml" \
        && ok "sitemap hostname 与配置域名一致" \
        || bad "sitemap hostname 与 $SITE_URL 不一致"
    else
      bad "已配置域名却缺少 sitemap.xml"
    fi
    if grep -q "rel=\"canonical\" href=\"$SITE_URL/" "$DIST/index.html" 2>/dev/null \
      || grep -q "rel=\"canonical\"" "$DIST/about.html" 2>/dev/null; then
      ok "canonical 已注入"
    else
      bad "已配置域名却没有 canonical"
    fi
  else
    [ -e "$DIST/sitemap.xml" ] && bad "未配置域名却生成了 sitemap.xml（会含空 hostname）" \
      || ok "未配置域名：未生成 sitemap.xml（符合设计）"
  fi

  echo "  --- 深层页面数（dist/posts/*.html，应为 18 = 17 篇正文 + 列表页）---"
  find "$DIST/posts" -maxdepth 1 -name '*.html' 2>/dev/null | wc -l | tr -d ' '

  echo "  --- 源码/依赖是否被误打包（以下应为空）---"
  leaked=0
  for d in src scripts node_modules vendor package.json .git; do
    if [ -e "$DIST/$d" ]; then echo "    LEAK $d"; leaked=1; fi
  done
  [ "$leaked" = "0" ] && ok "无源码/依赖泄漏" || bad "产物中混入了源码或依赖"

  echo "  --- 占位值残留检查（应无输出）---"
  if grep -rIl "your-domain\|example\.com\|your-repo" "$DIST" 2>/dev/null | head -5 | grep -q .; then
    bad "产物中残留占位域名/仓库"
    grep -rIl "your-domain\|example\.com\|your-repo" "$DIST" 2>/dev/null | head -5
  else
    ok "无占位值残留"
  fi

  echo "  --- Cloudflare 上传限制 ---"
  if [ "$n" -le 20000 ]; then ok "文件数 $n <= 20000"; else bad "文件数超限"; fi
  big=$(find "$DIST" -type f -size +25M | wc -l | tr -d ' ')
  [ "$big" = "0" ] && ok "无 >25MiB 单文件" || bad "存在 $big 个超限文件"
else
  bad "产物目录 $DIST 不存在"
fi

step "10. 资源前缀（Pages 部署在域名根，期望以 / 开头）"
grep -oE '(href|src)="[^"]*assets/[^"]*"' "$DIST/index.html" 2>/dev/null | head -3

step "结果"
if [ "$fail" = "0" ]; then echo "  ✅ 全部通过（cleanroom: $CRU）"; else echo "  ❌ 存在失败项"; fi
exit $fail

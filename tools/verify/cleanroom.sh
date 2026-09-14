#!/usr/bin/env bash
# ============================================================
# cleanroom.sh —— 干净克隆复现 Cloudflare Pages 的构建链
#
# 为什么必须真克隆：本地目录里躺着 node_modules/ 和旧产物，
# 与 CI 的干净检出状态完全不同。只有真 clone 才能暴露
# 「.gitignore 吃掉了构建输入」这类只在 CI 出现的故障。
#
# 用法： bash cleanroom.sh <标签>
# ============================================================
set -uo pipefail

export PATH="/usr/bin:/bin:/mingw64/bin:/c/Windows/System32:/c/Windows:$PATH"

TAG="${1:-run}"
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
n_committed=$(git ls-files | wc -l | tr -d ' ')
echo "  受版本控制的文件数 = $n_committed"

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

step "5. 文章文件数与磁盘一致（17 篇正文）"
md_count=$(find docs/posts -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
echo "  docs/posts/*.md = $md_count"
[ "$md_count" -ge 18 ] && ok "文章齐全" || bad "文章数异常（$md_count）"

step "6. npm ci（等价于 Cloudflare 的安装步骤）"
t0=$(date +%s)
if "$NODE_EXE" "$NPM_CLI" ci --no-audit --no-fund > /tmp/npmci.log 2>&1; then
  t1=$(date +%s)
  ok "npm ci 成功，用时 $((t1 - t0)) 秒"
  echo "  已安装包数 = $(find node_modules -maxdepth 3 -name package.json 2>/dev/null | wc -l | tr -d ' ')"
else
  bad "npm ci 失败，日志尾部："
  tail -30 /tmp/npmci.log
fi

step "7. 构建站点（Cloudflare 的构建命令）"
if "$NODE_EXE" "$NPM_CLI" run build:site > /tmp/build.log 2>&1; then
  ok "npm run build:site 成功"
else
  bad "构建失败，日志尾部："
  tail -40 /tmp/build.log
fi

step "8. 产物核对"
DIST="docs/.vitepress/dist"
if [ -d "$DIST" ]; then
  n=$(find "$DIST" -type f | wc -l | tr -d ' ')
  echo "  产物文件数 = $n"
  echo "  产物体积   = $(du -sh "$DIST" | cut -f1)"
  for f in index.html about.html posts/index.html 404.html sitemap.xml logo.svg favicon.svg; do
    [ -e "$DIST/$f" ] && ok "$f" || bad "MISS $f"
  done
  echo "  --- 深层页面数（posts/*.html）---"
  find "$DIST/posts" -maxdepth 1 -name '*.html' 2>/dev/null | wc -l | tr -d ' '

  echo "  --- 源码/依赖是否被误打包（以下应为空）---"
  leaked=0
  for d in src scripts node_modules vendor package.json .git; do
    if [ -e "$DIST/$d" ]; then echo "    LEAK $d"; leaked=1; fi
  done
  [ "$leaked" = "0" ] && ok "无源码/依赖泄漏" || bad "产物中混入了源码或依赖"

  echo "  --- Cloudflare 上传限制 ---"
  if [ "$n" -le 20000 ]; then ok "文件数 $n <= 20000"; else bad "文件数超限"; fi
  big=$(find "$DIST" -type f -size +25M | wc -l | tr -d ' ')
  [ "$big" = "0" ] && ok "无 >25MiB 单文件" || bad "存在 $big 个超限文件"
else
  bad "产物目录 $DIST 不存在"
fi

step "9. 本地与 CI 的 base / url 差异核对"
echo "  产物内资源前缀（期望 / 开头，因为 Pages 部署在域名根）："
grep -oE 'href="[^"]*assets/[^"]*"' "$DIST/index.html" 2>/dev/null | head -3

step "结果"
if [ "$fail" = "0" ]; then echo "  ✅ 全部通过（cleanroom: $CRU）"; else echo "  ❌ 存在失败项"; fi
exit $fail

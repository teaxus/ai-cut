#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
cd "${AICUT_ROOT}"

UPSTREAM_URL="https://github.com/0xsline/OpenChatCut.git"

show_help() {
  cat <<'HELP'
用法 / Usage:
  ./tools/setup-repo.sh [--install] [--no-fetch] [-h]

做什么 / What it does:
  给 ai-cut 的检出补齐 git 本地配置（这些配置不进版本库，每个新克隆都要跑一次）：
  Configures the local git settings an ai-cut checkout needs (not versioned; run once per clone):
    - remote `upstream` = 0xsline/OpenChatCut（没有才加 / added if missing）
    - rerere.enabled / rerere.autoupdate = true（记住解过的冲突 / remember resolved conflicts）
    - merge.ours.driver = true（让 .gitattributes 里的 merge=ours 生效 / enables merge=ours）
    - core.quotepath = false（中文路径正常显示 / readable non-ASCII paths）
    - 拉取上游 tag / fetch upstream tags

选项 / Options:
  --install    配置完后运行 npm ci（需要 Node.js 24）/ also run `npm ci`（默认不装 / default: off）
  --no-fetch   不联网拉取上游 tag / skip `git fetch upstream --tags`（默认拉取 / default: fetch）
  -h, --help   显示本帮助 / show this help

示例 / Example:
  ./tools/setup-repo.sh --install
HELP
}

DO_INSTALL=0
DO_FETCH=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --install) DO_INSTALL=1; shift ;;
    --no-fetch) DO_FETCH=0; shift ;;
    *) die "未知参数 / unknown option: $1（见 -h）" ;;
  esac
done

need_cmd git "请安装 git / install git"
[[ -d .git ]] || die "${AICUT_ROOT} 不是 git 仓库 / not a git checkout"

if git remote get-url upstream >/dev/null 2>&1; then
  say "remote upstream 已存在 / exists: $(git remote get-url upstream)"
else
  git remote add upstream "${UPSTREAM_URL}"
  say "已添加 remote upstream / added: ${UPSTREAM_URL}"
fi
git config rerere.enabled true
git config rerere.autoupdate true
git config merge.ours.driver true
git config core.quotepath false
say "git 本地配置完成 / local git config set（rerere、merge=ours、quotepath）"

if [[ ${DO_FETCH} -eq 1 ]]; then
  say "拉取上游 tag / fetching upstream tags"
  git fetch upstream --tags --quiet
  say "上游最新 tag / latest upstream tag: $(git tag --list 'v*' --sort=-v:refname | head -1)"
fi

if [[ ${DO_INSTALL} -eq 1 ]]; then
  need_node24
  say "npm ci（首次较慢 / slow the first time）"
  npm ci --no-audit --no-fund
fi
say "完成 / done"

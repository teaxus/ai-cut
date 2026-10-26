# shellcheck shell=bash
# ai-cut 入口脚本的公共函数。由 tools/*.sh 用 `source "$(dirname "$0")/lib/common.sh"` 引入。
# Shared helpers for the tools/*.sh entry points.

AICUT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export AICUT_ROOT

say()  { printf '>>> %s\n' "$*"; }
warn() { printf '!!! %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

need_cmd() {
  # need_cmd <命令> <缺失时的提示>
  command -v "$1" >/dev/null 2>&1 || die "缺少 ${1} / missing ${1}：${2}"
}

need_node24() {
  need_cmd node "请安装 Node.js 24（nvm install 24 && nvm use 24）/ install Node.js 24"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "${major}" == "24" ]] || die "需要 Node.js 24.x，当前是 $(node -v) / Node.js 24.x required（nvm use 24）"
}

need_deps() {
  [[ -d "${AICUT_ROOT}/node_modules/electron" ]] \
    || die "依赖没装 / dependencies missing：先跑 ./tools/setup-repo.sh --install"
}

# 本机钥匙串里可能有别的组织的签名证书：一律关掉 electron-builder 的证书自动发现（见 docs/decisions.md D-07）。
no_autosign() { export CSC_IDENTITY_AUTO_DISCOVERY=false; }

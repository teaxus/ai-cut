#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
cd "${AICUT_ROOT}"

show_help() {
  cat <<'HELP'
用法 / Usage:
  ./tools/doctor.sh [--pkghost <主机名>] [-h]

做什么 / What it does:
  检查本机能不能开发、测试、打包 ai-cut，逐项打印 OK / 缺失 / 警告，不改任何东西。
  Checks whether this machine can develop, test and package ai-cut. Read-only.

  检查项 / Checks: Node.js 24、npm、git、cmake（macOS 编 whisper.cpp 要用）、ffmpeg（上游测试要用）、
  依赖是否已装、磁盘余量、端口 5199 / 5299、代理变量、钥匙串里的签名证书（会被自动关掉）。

选项 / Options:
  --pkghost NAME  另外检查 ~/.pkghost.yaml 里这台 Windows 打包主机的连通性与工具链
                  also probe this packaging host（默认不查 / default: skip）
  -h, --help      显示本帮助 / show this help

示例 / Example:
  ./tools/doctor.sh --pkghost g1
HELP
}

PKGHOST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --pkghost) PKGHOST="${2:-}"; [[ -n "${PKGHOST}" ]] || die "--pkghost 需要主机名 / needs a host name"; shift 2 ;;
    *) die "未知参数 / unknown option: $1（见 -h）" ;;
  esac
done

FAIL=0
ok()   { printf '  OK    %s\n' "$*"; }
bad()  { printf '  缺失  %s\n' "$*"; FAIL=1; }
note() { printf '  警告  %s\n' "$*"; }

echo "工具链 / toolchain"
if command -v node >/dev/null 2>&1; then
  v="$(node -v)"; [[ "${v}" == v24.* ]] && ok "node ${v}" || bad "node ${v}（需要 24.x / need 24.x：nvm use 24）"
else bad "node（需要 24.x）"; fi
command -v npm >/dev/null 2>&1 && ok "npm $(npm -v)" || bad "npm"
command -v git >/dev/null 2>&1 && ok "$(git --version)" || bad "git"
if [[ "$(uname)" == "Darwin" ]]; then
  command -v cmake >/dev/null 2>&1 && ok "$(cmake --version | head -1)" || bad "cmake（macOS 构建要从源码编 whisper.cpp：brew install cmake）"
fi
command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg（上游测试用 / for upstream tests）" || note "没有系统 ffmpeg，上游部分测试会失败（brew install ffmpeg）"

echo "仓库 / repository"
[[ -d node_modules/electron ]] && ok "依赖已装 / deps installed（electron $(node -p 'require("./node_modules/electron/package.json").version' 2>/dev/null)）" \
  || bad "依赖没装 / deps missing：./tools/setup-repo.sh --install"
git remote get-url upstream >/dev/null 2>&1 && ok "remote upstream" || bad "remote upstream：./tools/setup-repo.sh"
[[ "$(git config --get merge.ours.driver || true)" == "true" ]] && ok "merge=ours 驱动 / driver" || bad "merge=ours 驱动没配：./tools/setup-repo.sh"
avail_gb="$(df -g . | awk 'NR==2{print $4}')"
[[ "${avail_gb}" -ge 20 ]] && ok "磁盘余量 / free disk ${avail_gb} GB" || note "磁盘余量 ${avail_gb} GB，一次打包要 5–10 GB"

echo "运行环境 / runtime"
if lsof -nP -iTCP:5199 -sTCP:LISTEN >/dev/null 2>&1; then
  note "5199 被占用（多半是上游 OpenChatCut 开发服务，ai-cut 用 5299，不冲突）"
else ok "5199 空闲"; fi
if lsof -nP -iTCP:5299 -sTCP:LISTEN >/dev/null 2>&1; then
  note "5299 被占用：$(lsof -nP -iTCP:5299 -sTCP:LISTEN | awk 'NR==2{print $1" pid "$2}')（ai-cut 会退到随机端口）"
else ok "5299 空闲"; fi
[[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]] && ok "代理 / proxy 已设置（构建要访问 npm、googleapis、github）" \
  || note "没有代理变量；国内网络下载 Chrome for Testing / whisper.cpp 可能失败"
if [[ "$(uname)" == "Darwin" ]]; then
  n="$(security find-identity -v -p codesigning 2>/dev/null | grep -c '"' || true)"
  [[ "${n}" -gt 0 ]] && note "钥匙串里有 ${n} 个签名证书：tools/build.sh 会关掉自动签名，不会误用" || ok "钥匙串里没有签名证书"
fi

if [[ -n "${PKGHOST}" ]]; then
  echo "打包主机 / packaging host: ${PKGHOST}"
  if [[ -x tools/pkghost-build.sh ]]; then
    ./tools/pkghost-build.sh --doctor "${PKGHOST}" || FAIL=1
  else
    bad "tools/pkghost-build.sh 不存在（P2 加入）"
  fi
fi

if [[ ${FAIL} -eq 0 ]]; then echo "结论 / verdict: 可以开发 / ready"; else echo "结论 / verdict: 有缺失项，按上面的提示补齐 / fix the items above"; exit 1; fi

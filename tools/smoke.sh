#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
cd "${AICUT_ROOT}"

show_help() {
  cat <<'HELP'
用法 / Usage:
  ./tools/smoke.sh [--app "<路径>/AI Cut.app"] [--no-render] [--hw] [-h]

做什么 / What it does:
  用上游自带的无窗口冒烟模式（CC_SMOKE=1）启动打包好的 AI Cut，等它打印 SMOKE-OK：
  内嵌服务起来、/api/keys 可读、外部 MCP 端点能握手、preload 的目录选择与更新器在、
  （默认还有）一次真实渲染导出。另外检查派生版的数据隔离：MCP 令牌写进 ~/.ai-cut，没有写进上游的 ~/.openchatcut。
  Launches the packaged app in upstream's windowless smoke mode and checks the fork's data isolation.
  Windows 的冒烟在打包主机上做：./tools/build.sh --win --pkg <主机> --smoke

选项 / Options:
  --app PATH    要测的 .app（默认 release-aicut/mac-<本机架构>/AI Cut.app）/ app bundle to test
  --no-render   跳过渲染探测（更快）/ skip the render probe
  --hw          渲染探测允许用硬件编码器（默认关：本机 M4 曾在硬件编码时内核崩溃，见项目记忆）/ allow HW encoder
  -h, --help    显示本帮助 / show this help

示例 / Example:
  ./tools/build.sh --mac --dir && ./tools/smoke.sh
HELP
}

APP=""; RENDER=1; HW=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --app) APP="${2:-}"; shift 2 ;;
    --no-render) RENDER=0; shift ;;
    --hw) HW=1; shift ;;
    *) die "未知参数 / unknown option: $1（见 -h）" ;;
  esac
done
[[ "$(uname)" == "Darwin" ]] || die "本脚本只测 macOS 包；Windows 用 ./tools/build.sh --win --pkg <主机> --smoke"
arch="$(uname -m)"; [[ "${arch}" == "x86_64" ]] && arch="x64"
[[ -n "${APP}" ]] || APP="release-aicut/mac-${arch}/AI Cut.app"
BIN="${APP}/Contents/MacOS/AI Cut"
[[ -x "${BIN}" ]] || die "找不到 ${BIN}：先 ./tools/build.sh --mac --dir"

LOG_DIR="release-aicut"; mkdir -p "${LOG_DIR}"
LOG="${LOG_DIR}/smoke-mac.log"
upstream_token_before=0; [[ -f "${HOME}/.openchatcut/mcp-token" ]] && upstream_token_before=1

say "冒烟启动 / smoke launch: ${APP}（最长 300 秒）"
env_args=(CC_SMOKE=1)
[[ ${RENDER} -eq 1 ]] && env_args+=(CC_SMOKE_RENDER=1)
[[ ${HW} -eq 0 ]] && env_args+=(OPENCHATCUT_DISABLE_HARDWARE_ENCODING=1)
set +e
env "${env_args[@]}" "${BIN}" > "${LOG}" 2>&1 &
pid=$!
for _ in $(seq 1 300); do kill -0 "${pid}" 2>/dev/null || break; sleep 1; done
if kill -0 "${pid}" 2>/dev/null; then kill "${pid}"; fi
wait "${pid}"; code=$?
set -e

grep -E '^\[smoke\]|SMOKE-OK|smoke timed out|Error' "${LOG}" | head -30 || true
fail=0
grep -q 'SMOKE-OK' "${LOG}" && say "SMOKE-OK（退出码 ${code}）" || { warn "没有 SMOKE-OK（退出码 ${code}），完整日志：${LOG}"; fail=1; }
if [[ -f "${HOME}/.ai-cut/mcp-token" ]]; then say "数据隔离 / isolation: ~/.ai-cut/mcp-token 存在"; else warn "~/.ai-cut/mcp-token 不存在：派生入口的 AICUT_HOME 没生效"; fail=1; fi
if [[ ${upstream_token_before} -eq 0 && -f "${HOME}/.openchatcut/mcp-token" ]]; then warn "派生版写进了上游的 ~/.openchatcut/mcp-token"; fail=1; fi
[[ -f "${HOME}/.ai-cut/mcp-port" ]] && say "端口记忆 / port memory: $(cat "${HOME}/.ai-cut/mcp-port")"
[[ ${fail} -eq 0 ]] && say "冒烟通过 / smoke passed（日志 ${LOG}）" || die "冒烟失败 / smoke failed（日志 ${LOG}）"

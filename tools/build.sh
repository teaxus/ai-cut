#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
cd "${AICUT_ROOT}"

show_help() {
  cat <<'HELP'
用法 / Usage:
  ./tools/build.sh --mac [--arch arm64|x64|both] [--dir] [--targets "dmg zip"] [--pristine] [--skip-web]
  ./tools/build.sh --win --pkg <主机名> [--dir] [--targets "nsis"] [--pristine] [--keep-remote]
  ./tools/build.sh --list-pkg
  ./tools/build.sh -h

做什么 / What it does:
  打 ai-cut 桌面安装包。步骤与上游 desktop:dist:* 相同（vite build → 主进程 esbuild → 派生入口 →
  Remotion 预打包 → 目标平台二进制 → electron-builder），由 tools/lib/dist.mjs 编排；
  最后一步用派生版的 config/aicut-electron-builder.config.mjs（产物在 release-aicut/）。
  Builds the ai-cut desktop installers with upstream's pipeline and the fork's builder config.

  - macOS 在本机打；Windows 必须在 Windows 上打（Remotion compositor、whisper、ffmpeg 都是平台二进制），
    走 ~/.pkghost.yaml 里配置的打包主机（SSH）。Windows packages are built on a Windows host over SSH.
  - 本机钥匙串里的证书不会被用来签名（已设置 CSC_IDENTITY_AUTO_DISCOVERY=false）；
    macOS 包是 ad-hoc 签名，首次打开需在「隐私与安全性」里允许。

选项 / Options:
  --mac              本机打 macOS 包 / build macOS locally
  --arch A           arm64（Apple Silicon）| x64（Intel）| both（各出一个独立包，不做 universal）
                     默认 = 本机架构 / default: this Mac's architecture
  --win              打 Windows 包（需配合 --pkg）/ build Windows (needs --pkg)
  --pkg NAME         Windows 打包主机名（~/.pkghost.yaml 的 hosts 下）/ packaging host label
  --list-pkg         列出可用的打包主机 / list packaging hosts
  --dir              只出目录形式（.app / win-unpacked），不出安装包，快 / unpacked only, faster
  --targets "..."    覆盖 electron-builder 目标（mac 默认 "dmg zip"，win 默认 "nsis"）/ override targets
  --pristine         用上游原样的打包配置（产物在 release/，基线验证用）/ upstream config, baseline check
  --skip-web         复用已有的 dist/，跳过 vite build（仅本机）/ reuse dist/ (local only)
  --keep-remote      保留远端中间物便于排查 / keep remote intermediates
  --proxy URL        远端构建用的 HTTP 代理（默认远端自动探测 127.0.0.1:7897 / 7890）/ remote build proxy
  --smoke            （Windows）打完在打包主机上静默安装 → 冒烟启动（含真实渲染）→ 卸载 / install+smoke+uninstall
  -n, --dry-run      只打印步骤，不执行 / print steps only
  -h, --help         显示本帮助 / show this help

示例 / Examples:
  ./tools/build.sh --mac --dir                      # 本机快速出一个 .app 自测
  ./tools/build.sh --mac --arch both                # Intel + Apple Silicon 各一个 dmg/zip
  ./tools/build.sh --win --pkg g1                   # 在 g1 上打 Windows 安装包，拉回 release-aicut/windows
  ./tools/build.sh --mac --dir --pristine           # 上游原样打包，验证构建链路
HELP
}

[[ $# -eq 0 ]] && { show_help; exit 0; }

DO_MAC=0; DO_WIN=0; ARCH=""; PKG=""; DIR=0; TARGETS=""; PRISTINE=0; SKIP_WEB=0; KEEP_REMOTE=0; DRY=0; LIST=0; PROXY=""; SMOKE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --mac) DO_MAC=1; shift ;;
    --win) DO_WIN=1; shift ;;
    --arch) ARCH="${2:-}"; shift 2 ;;
    --pkg) PKG="${2:-}"; shift 2 ;;
    --list-pkg) LIST=1; shift ;;
    --dir) DIR=1; shift ;;
    --targets) TARGETS="${2:-}"; shift 2 ;;
    --pristine) PRISTINE=1; shift ;;
    --skip-web) SKIP_WEB=1; shift ;;
    --keep-remote) KEEP_REMOTE=1; shift ;;
    --proxy) PROXY="${2:-}"; shift 2 ;;
    --smoke) SMOKE=1; shift ;;
    -n|--dry-run) DRY=1; shift ;;
    *) die "未知参数 / unknown option: $1（见 -h）" ;;
  esac
done

if [[ ${LIST} -eq 1 ]]; then exec ./tools/pkghost-build.sh --list; fi
[[ ${DO_MAC} -eq 1 || ${DO_WIN} -eq 1 ]] || die "要指定 --mac 或 --win / pass --mac or --win"

if [[ ${DO_WIN} -eq 1 ]]; then
  [[ -n "${PKG}" ]] || die "Windows 包要在 Windows 主机上打：加 --pkg <主机名>（./tools/build.sh --list-pkg 查看）"
  args=("${PKG}" --platform windows)
  [[ -n "${TARGETS}" ]] && args+=(--win-targets "${TARGETS}")
  [[ ${PRISTINE} -eq 1 ]] && args+=(--pristine) && args+=(--out-dir "${AICUT_ROOT}/release/windows")
  [[ ${DIR} -eq 1 ]] && args+=(--dir)
  [[ ${KEEP_REMOTE} -eq 1 ]] && args+=(--keep-remote)
  [[ -n "${PROXY}" ]] && args+=(--proxy "${PROXY}")
  [[ ${SMOKE} -eq 1 ]] && args+=(--smoke)
  [[ ${DRY} -eq 1 ]] && args+=(--dry-run)
  say "远端打包 / remote build: ./tools/pkghost-build.sh ${args[*]}"
  ./tools/pkghost-build.sh "${args[@]}"
fi

if [[ ${DO_MAC} -eq 1 ]]; then
  [[ "$(uname)" == "Darwin" ]] || die "--mac 只能在 macOS 上打 / --mac needs macOS"
  need_node24
  need_deps
  native="$(uname -m)"; [[ "${native}" == "x86_64" ]] && native="x64"
  case "${ARCH:-${native}}" in
    arm64) archs=(arm64) ;;
    x64) archs=(x64) ;;
    both) archs=(arm64 x64) ;;
    *) die "--arch 只能是 arm64 / x64 / both（收到 ${ARCH}）" ;;
  esac
  no_autosign
  first=1
  for a in "${archs[@]}"; do
    dist_args=("darwin-${a}")
    [[ ${DIR} -eq 1 ]] && dist_args+=(--dir)
    [[ -n "${TARGETS}" ]] && dist_args+=(--targets "${TARGETS// /,}")
    [[ ${PRISTINE} -eq 1 ]] && dist_args+=(--pristine)
    # 同一次调用里第二个架构复用第一个架构的前端构建（与架构无关）
    [[ ${SKIP_WEB} -eq 1 || ${first} -eq 0 ]] && dist_args+=(--skip-web)
    if [[ ${DRY} -eq 1 ]]; then
      say "(dry-run) node tools/lib/dist.mjs ${dist_args[*]}"
    else
      say "本机打包 / local build: darwin-${a}"
      node tools/lib/dist.mjs "${dist_args[@]}"
    fi
    first=0
  done
  out="release-aicut"; [[ ${PRISTINE} -eq 1 ]] && out="release"
  [[ ${DRY} -eq 1 ]] || { say "产物 / artifacts（${out}/）:"; ls -1 "${out}" 2>/dev/null | sed 's/^/    /'; }
fi

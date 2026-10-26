#!/usr/bin/env bash
# 在一台远程主机（通过 SSH）上打 Windows 安装包，产物拉回本地。
# Build the Windows installer on a remote host over SSH and pull the artifacts back.
#
# 传输方式：把当前工作树打成 zip → scp 上去 → 远端 Expand-Archive 后 npm/electron-builder
# 构建 → 产物再打成 out.zip 回传。私有仓库因此无需在远端配 GitHub 凭据，且能打包
# 未提交的本地改动（这点与 GitHub Actions 路线相反，后者只打已 push 的 commit）。
#
# Transport: zip the working tree -> scp -> Expand-Archive + npm/electron-builder on the
# remote -> zip the installers back. No GitHub creds needed on the remote for a private
# repo, and it packages your UNCOMMITTED working tree (unlike the GitHub Actions path,
# which only builds the pushed commit).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# A packaging host is a machine you own, not a property of one project — so the
# registry lives in your HOME by default and every project reuses it. The
# project-local file stays supported and wins per attribute, for the rare case
# where one project needs a different workdir/host than your usual box.
CONF_HOME="${PKGHOST_CONFIG:-$HOME/.pkghost.yaml}"
CONF_PROJECT="$ROOT/.pkghost.yaml"
REMOTE_PS1="$HERE/pkghost-remote-build.ps1"
APP_SLUG="ai-cut"

show_help() {
  cat <<'EOF'
用法 / Usage:
  ./tools/pkghost-build.sh <主机名>  [--platform windows] [--out-dir DIR]
                                     [--dry-run] [--keep-remote]
  ./tools/pkghost-build.sh --list                列出所有可用打包目标（含 github）与配置文件位置
  ./tools/pkghost-build.sh --doctor <主机名>     测试 SSH 连通性与远端工具链
  ./tools/pkghost-build.sh --print-key <主机名>  打印该主机用的 SSH 公钥（配置 Windows 时用）
  ./tools/pkghost-build.sh -h | --help

做什么 / What it does:
  在 .pkghost.yaml 里配置好的远程主机上，通过 SSH 原生打 Windows exe 安装包，
  产物拉回本地（默认 release-aicut/windows）。适合有一台常开的 Windows 机器时，
  绕开 GitHub Actions 的构建额度 / 排队 / 只能打已 push commit 的限制。

  Builds the Windows installer natively on a remote host configured in
  .pkghost.yaml, over SSH, and downloads the artifacts (default release-aicut/windows).

参数 / Options:
  <主机名>              .pkghost.yaml 里 hosts 下的名字 / a host label under `hosts:`
  --platform P         目前仅支持 windows / only `windows` for now（默认 default: windows）
  --win-targets "..."  覆盖 electron-builder 的 win target / override win targets
                       默认（不传）= nsis 安装包（tools/lib/dist.mjs 的默认值）
                       例 --win-targets "nsis zip"（会以逗号形式传给远端）
  --pristine           用上游原样的打包配置（基线验证）/ build with upstream's own config (baseline)
  --dir                只出 win-unpacked 目录、不出安装包（仍回传整个目录的 zip）/ unpacked only
  --proxy URL          远端构建用的 HTTP 代理（默认自动探测远端 127.0.0.1:7897 / 7890）/ remote build proxy
  --smoke              打完后在远端静默安装 → 冒烟启动（含真实渲染）→ 卸载；smoke.log 随产物拉回 / install+smoke+uninstall
  --out-dir DIR        产物落盘目录 / where to save artifacts（默认 default: release-aicut/windows）
  --dry-run            只打印将执行的步骤，不实际连接 / print steps, do not connect
  --keep-remote        保留远端所有中间物：src.zip / out.zip / 构建目录（约 1GB），便于排查。
                       默认全部删除 / keep ALL remote intermediates (incl. the ~1GB build dir)
  --cn-mirror          远端依赖走 npmmirror 镜像（electron / electron-builder / npm registry）
                       兜底开关，默认不要加：挂了境外代理的机器加了反而更慢，
                       先量实测速率再决定（见 PACKAGING.md）
                       Fallback only — measure first; slower on hosts behind a foreign proxy
  --list               列出所有可用打包目标后退出（含内置的 github）/ list all targets and exit
  --doctor <主机名>    连上去打印 OS / Node / npm / Python 版本，验证可构建
  --print-key <主机名> 打印该主机 key 对应的 .pub 内容 / print the host key's public half
  -h, --help           显示本帮助 / show this help

配置文件 / Config（按此顺序读取，样例见 .pkghost.yaml.example）:
  1. ~/.pkghost.yaml        ← 推荐放这里：打包主机是「你的机器」，不是某个项目的属性，
                              配一次所有项目共用。可用 $PKGHOST_CONFIG 覆盖路径。
  2. ./.pkghost.yaml        ← 可选，仅本项目；同名主机按【属性】覆盖家目录那份，
                              所以项目里通常只需要写一行 workdir，不必重复 host/user/key。

  hosts:
    g1:
      host: win-builder.local
      user: builder
      key: ~/.ssh/pkghost_g1_key
      port: 22
      platform: windows
      # workdir 不填 -> 自动用 C:/pkgbuild/<本项目名>，所以共用一份配置也不会
      # 让多个项目在远端撞进同一个目录。要显式写就用 {project} 占位符：
      #   workdir: C:/pkgbuild/{project}

首次使用某主机前 / First-time host setup:
  远端 Windows 需先装好 OpenSSH Server 并放行本机公钥。用仓库里的
  tools/setup-pkghost-windows.ps1（在 Windows 上以管理员 PowerShell 运行一次）。
  The remote Windows box needs OpenSSH Server enabled and this machine's public key
  authorised — run tools/setup-pkghost-windows.ps1 once (elevated) on Windows.

退出码 / Exit status:
  0 = 成功 / success      1 = 构建或传输失败 / build or transfer failed
  2 = 用法或环境问题 / usage or environment problem

示例 / Examples:
  ./tools/pkghost-build.sh --list
  ./tools/pkghost-build.sh --doctor g1
  ./tools/pkghost-build.sh g1
  ./tools/pkghost-build.sh g1 --out-dir release/win --keep-remote
EOF
}

die()  { echo "错误 / error: $*" >&2; exit 2; }
fail() { echo "失败 / failed: $*" >&2; exit 1; }

# 连不上时【当场】抓网络现场并落盘。
# 起因：本机排查这个故障时反复踩坑——等人工去看的时候网络早恢复了，于是连着得出三个
# 错误结论（IPv6、网卡省电、对端 Wi-Fi 掉线），都是拿"恢复后的状态"去证伪"故障时的假设"。
# 唯一可靠的办法是在失败的那一秒把现场存下来。
DIAG_LOG="${TMPDIR:-/tmp}/pkghost-netdiag.log"
capture_netdiag() {
  local ip="" host="$1"
  {
    echo "================ $(date '+%F %T') 连接失败现场 ================"
    echo "--- 目标 ---"; echo "host=$host"
    ip="$(python3 -c "
import socket,sys
try: print(socket.getaddrinfo(sys.argv[1],22,type=socket.SOCK_STREAM)[0][4][0])
except Exception as e: print('RESOLVE_FAIL:',e)
" "$host" 2>/dev/null)"
    echo "resolved=$ip"
    # ICMP 与 TCP 分开测：这是分辨"真不可达" vs "TCP 被代理劫持"的关键判据。
    # 代理 TUN（Clash/Mihomo 等）接管 TCP 但通常不接管 ICMP，于是表现为
    # ping 通、TCP 却报 No route to host —— 此时问题在本机代理，不在网络。
    echo "--- ICMP ping (2 包) ---";   ping -c 2 -t 3 "$host" 2>&1 | tail -3
    echo "--- TCP 连接测试 (port $PKGH_PORT) ---"
    if nc -z -G 4 -w 4 "${ip%%:*}" "$PKGH_PORT" 2>&1; then
      echo "TCPTEST OK   — TCP 可达（那么失败可能是 ssh 认证/主机密钥层面，不是网络）"
    else
      echo "TCPTEST FAIL — TCP 不可达"
    fi
    echo "--- ARP ---";               arp -an 2>/dev/null | grep -F "${ip%%:*}" || echo "(无 ARP 条目 = 对端不应答/路由不通)"
    echo "--- route get ---";         route -n get "${ip%%:*}" 2>&1 | grep -E 'route to|interface|gateway|flags'
    # 只看网段路由本身（3 段的那条）和会抢路由的 0/1、128.0/1，不要整张 ARP 表
    echo "--- LAN 网段路由是否存在（缺了就是路由被抢/被删）---"
    netstat -rn -f inet 2>/dev/null |
      awk '$1=="default" || $1 ~ /^(0|128\.0)\/1$/ || $1 ~ /^[0-9]+\.[0-9]+\.[0-9]+$/ {printf "ROUTE %-18s %-18s %-8s %s\n",$1,$2,$3,$4}'
    echo "--- 本机接口 ---";          ifconfig en0 2>/dev/null | grep -E 'status|inet '
    echo "--- 代理 TUN 进程（Clash/Mihomo 重载路由会短暂打断局域网）---"
    ps aux | grep -iE 'mihomo|clash|sing-box|surge' | grep -v grep | awk '{print $11}' | sort -u
    echo "--- ssh -vv 最后几行 ---"
    timeout 20 ssh -vv -o BatchMode=yes -o ConnectTimeout=8 -o "AddressFamily=$PKGH_FAMILY" \
      -i "$PKGH_KEY" -p "$PKGH_PORT" "$PKGH_USER@$host" exit 2>&1 |
      grep -vE 'post-quantum|store now|may need to be upgraded|openssh.com/pq' | tail -8
    echo
  } >> "$DIAG_LOG" 2>&1
  return 0        # 抓取本身失败也不能影响主流程（set -e 会让非零返回直接终止脚本）
}

# 把现场里的关键几行 + 判定打到终端。
print_diag_verdict() {
  echo "  已存到 / saved: $DIAG_LOG" >&2
  echo "  关键判据 / key signals:" >&2
  tail -60 "$DIAG_LOG" | grep -E 'resolved=|无 ARP 条目|route to:|interface:|packet loss|^TCPTEST|^ROUTE ' | sed 's/^/    /' >&2 || true
  local ping_ok=0 tcp_bad=0
  tail -60 "$DIAG_LOG" | grep -q '0.0% packet loss' && ping_ok=1
  tail -60 "$DIAG_LOG" | grep -q 'TCPTEST FAIL'    && tcp_bad=1
  # ICMP 通但 TCP 不通 = 本机侧在拦 TCP，不是网络问题。排查这个故障时曾在网络层
  # 反复走弯路（IPv6 / 网卡省电 / 对端 Wi-Fi），所以这里把结论直接打出来。
  if (( ping_ok == 1 && tcp_bad == 1 )); then
    echo "" >&2
    echo "  >>> 判定：ping 通但 TCP 不通 —— 网络和对端都没问题，是【本机这一侧】拦了 TCP。" >&2
    echo "      按可能性排序，逐个试：" >&2
    echo "      1) macOS「本地网络」权限（macOS 15+ 按 App 强制，最常见）" >&2
    echo "         系统设置 → 隐私与安全性 → 本地网络 → 打开你的终端 App，然后 Cmd+Q 完全退出再重开。" >&2
    echo "         直达： open \"x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork\"" >&2
    echo "         判据：换一个 App（如 VS Code 内置终端）跑同样命令若能通，就是这个。" >&2
    echo "      2) 代理 TUN（Clash/Mihomo 等）接管了 TCP 但不接管 ICMP" >&2
    echo "         开启「绕过局域网 / Bypass LAN」，或把 192.168.0.0/16 加入直连(DIRECT)，或临时关掉 TUN。" >&2
  fi
}

# ---- 解析 .pkghost.yaml（优先 pyyaml，缺失时回退内置极简解析器）-----------------
# Parse .pkghost.yaml (prefers pyyaml, falls back to a tiny built-in parser).
PY="$(command -v python3 || true)"
[[ -n "$PY" ]] || die "未找到 python3（用于解析 .pkghost.yaml）/ python3 not found"

conf_py() {
  # 用法: conf_py <mode> [host]  ;  mode ∈ {list, default, resolve}
  "$PY" - "$CONF_HOME" "$CONF_PROJECT" "$APP_SLUG" "$@" <<'PY'
import sys, shlex, os

home_path, proj_path, slug, mode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
host = sys.argv[5] if len(sys.argv) > 5 else None

def load(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    try:
        import yaml
        return yaml.safe_load(text) or {}
    except ImportError:
        pass
    # 极简回退解析器：只认本项目 schema（default: 标量；hosts: 两层映射，2 空格缩进）。
    # Minimal fallback: our schema only (top-level `default:` scalar, `hosts:` two-level map).
    data, cur = {"hosts": {}}, None
    for raw in text.splitlines():
        line = raw.split(" #", 1)[0].rstrip()          # strip trailing " # comment"
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        key, _, val = line.strip().partition(":")
        val = val.strip().strip('"').strip("'")
        if indent == 0:
            if key == "hosts":
                cur = None
            elif key == "default":
                data["default"] = val
        elif indent == 2:                               # host label
            cur = key
            data["hosts"][cur] = {}
        elif indent >= 4 and cur is not None:           # host attribute
            data["hosts"][cur][key] = val
    return data

def load_or_empty(path):
    try:
        return load(path) or {}
    except FileNotFoundError:
        return {}

home, proj = load_or_empty(home_path), load_or_empty(proj_path)
if not home and not proj:
    sys.stderr.write("no-config\n"); sys.exit(3)

# Merge home under project, PER ATTRIBUTE: configure the box once in ~ and let a
# project override just the bits it needs (usually only `workdir`) without
# restating host/user/key. `origin` records where each host came from so --list
# can show it — otherwise "why is it using that key" is unanswerable.
hosts, origin = {}, {}
for label, src in (("home", home), ("project", proj)):
    for name, h in (src.get("hosts") or {}).items():
        merged = dict(hosts.get(name) or {})
        merged.update(h or {})
        hosts[name] = merged
        origin[name] = "both" if name in origin else label

default = proj.get("default") or home.get("default") or "github"

def workdir_for(h):
    # No workdir configured -> per-project default, so one shared ~/.pkghost.yaml
    # does not make every project build into the SAME directory on the remote and
    # clobber each other. `{project}` lets the shared file say it explicitly.
    wd = str(h.get("workdir") or "").strip()
    if not wd:
        return f"C:/pkgbuild/{slug}"
    return wd.replace("{project}", slug)

if mode == "list":
    for name, h in hosts.items():
        h = h or {}
        print(f"{name}\t{h.get('user','?')}@{h.get('host','?')}\t{h.get('platform','?')}"
              f"\t{workdir_for(h)}\t{origin.get(name,'?')}")
    sys.exit(0)

if mode == "default":
    print(default); sys.exit(0)

if mode == "paths":
    print(f"{home_path}\t{'yes' if home else 'no'}")
    print(f"{proj_path}\t{'yes' if proj else 'no'}")
    sys.exit(0)

if mode == "resolve":
    if host not in hosts:
        sys.stderr.write(f"unknown-host:{host}\n"); sys.exit(4)
    h = hosts[host] or {}
    key = os.path.expanduser(str(h.get("key", "")))
    out = {
        "PKGH_HOST": str(h.get("host", "")),
        "PKGH_USER": str(h.get("user", "")),
        "PKGH_KEY": key,
        "PKGH_PORT": str(h.get("port", 22)),
        "PKGH_WORKDIR": workdir_for(h),
        "PKGH_PLATFORM": str(h.get("platform", "windows")),
        "PKGH_FAMILY": str(h.get("family", "inet")),
        "PKGH_RETRY_BUDGET": str(h.get("retry_budget", 180)),
        "PKGH_ORIGIN": origin.get(host, "?"),
    }
    for k, v in out.items():
        print(f"{k}={shlex.quote(v)}")
    sys.exit(0)

sys.stderr.write(f"bad-mode:{mode}\n"); sys.exit(5)
PY
}

require_conf() {
  [[ -f "$CONF_HOME" || -f "$CONF_PROJECT" ]] && return 0
  die "找不到打包主机配置 / no packaging-host config found:
    $CONF_HOME        （推荐：配一次，所有项目共用 / configure once, shared by every project）
    $CONF_PROJECT     （可选：仅本项目 / optional, this project only）
  用 ./tools/pkghost-init.sh 引导配置，或 cp .pkghost.yaml.example \"$CONF_HOME\" 手动填。"
}

# ---- 子命令 / sub-commands ------------------------------------------------------
if [[ $# -eq 0 ]]; then show_help; exit 0; fi

case "${1:-}" in
  -h|--help) show_help; exit 0 ;;
  --list)
    echo "配置文件 / config files（家目录优先，项目按属性覆盖 / home first, project overrides per attribute）:"
    if [[ -f "$CONF_HOME" || -f "$CONF_PROJECT" ]]; then
      # Don't %-pad a cell holding "✓": printf pads by BYTES and ✓ is 3 of them,
      # so the checked and unchecked rows would not line up.
      conf_py paths | while IFS=$'\t' read -r p present; do
        printf '  %s %s\n' "$([[ $present == yes ]] && echo '[✓]' || echo '[·]')" "$p"
      done
    else
      printf '  [·] %s\n  [·] %s\n' "$CONF_HOME" "$CONF_PROJECT"
    fi
    echo
    echo "可用的打包目标 / available packaging targets:"
    printf '  %-10s %-24s %-9s %-26s %s\n' NAME USER@HOST PLATFORM WORKDIR FROM
    # `github` is a reserved target handled by build.sh, not an entry in the config
    # — list it anyway, or it is impossible to discover that it exists.
    printf '  %-10s %-24s %-9s %-26s %s\n' github 'GitHub Actions' 'mac/win' '(runner)' 'built-in'
    if [[ -f "$CONF_HOME" || -f "$CONF_PROJECT" ]]; then
      conf_py list | while IFS=$'\t' read -r n uh pf wd src; do
        printf '  %-10s %-24s %-9s %-26s %s\n' "$n" "$uh" "$pf" "$wd" "$src"
      done
      echo
      echo "默认 / default: $(conf_py default)"
    else
      echo
      echo "  （还没配置任何 SSH 打包主机 / no SSH hosts configured yet —— ./tools/pkghost-init.sh）"
      echo "默认 / default: github"
    fi
    exit 0
    ;;
esac

# 需要主机名的模式先取出来 / pull out the host argument for host-scoped modes
MODE="build"
HOST_ARG=""
PLATFORM="windows"
OUT_DIR="$ROOT/release-aicut/windows"
DRY_RUN=0
KEEP_REMOTE=0
CN_MIRROR=0
PRISTINE=0             # --pristine: 用上游原样的 electron-builder 配置
DIST_DIR=0             # --dir: 只出 win-unpacked
REMOTE_PROXY=""        # --proxy: 远端构建用的代理（空 = 远端自动探测）
REMOTE_SMOKE=0         # --smoke: 远端安装后冒烟
WIN_TARGETS=""         # 覆盖 electron-builder 的 win target（空 = 用 package.json 的 build.win.target）

while [[ $# -gt 0 ]]; do
  case "$1" in
    --doctor)    MODE="doctor"; HOST_ARG="${2:-}"; shift 2 ;;
    --print-key) MODE="printkey"; HOST_ARG="${2:-}"; shift 2 ;;
    --platform)  PLATFORM="${2:-}"; shift 2 ;;
    --win-targets) WIN_TARGETS="${2:-}"; shift 2 ;;
    --pristine)  PRISTINE=1; shift ;;
    --dir)       DIST_DIR=1; shift ;;
    --proxy)     REMOTE_PROXY="${2:-}"; shift 2 ;;
    --smoke)     REMOTE_SMOKE=1; shift ;;
    --out-dir)   OUT_DIR="${2:-}"; shift 2 ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --keep-remote) KEEP_REMOTE=1; shift ;;
    --cn-mirror) CN_MIRROR=1; shift ;;
    -h|--help)   show_help; exit 0 ;;
    --*)         die "未知参数 / unknown option: $1" ;;
    *)           [[ -z "$HOST_ARG" ]] && HOST_ARG="$1" || die "多余参数 / unexpected arg: $1"; shift ;;
  esac
done

[[ -n "$HOST_ARG" ]] || die "缺少主机名 / missing host name（见 --list）"
require_conf

# 解析该主机 / resolve host config
if ! RESOLVED="$(conf_py resolve "$HOST_ARG" 2>/tmp/pkgh_err)"; then
  case "$(cat /tmp/pkgh_err 2>/dev/null)" in
    unknown-host:*) die "主机 '$HOST_ARG' 不在 .pkghost.yaml 里 / not configured（见 --list）" ;;
    no-config)      die "找不到 $CONF" ;;
    *)              die "解析 .pkghost.yaml 失败 / failed to parse config" ;;
  esac
fi
eval "$RESOLVED"
[[ -n "${PKGH_HOST:-}" && -n "${PKGH_USER:-}" ]] || die "主机 '$HOST_ARG' 配置不完整（缺 host/user）/ incomplete config"

# 校验环境 / validate local environment
for t in ssh scp zip; do command -v "$t" >/dev/null || die "本机缺少 $t / missing local tool: $t"; done
[[ -n "${PKGH_KEY:-}" && -f "$PKGH_KEY" ]] || die "私钥不存在 / key not found: ${PKGH_KEY:-<空>}（见 setup-pkghost-windows.ps1）"

# AddressFamily 默认 inet（只走 IPv4）。原因：局域网主机常同时广播 A 和 AAAA 记录，
# 而 Mac 这边往往只有链路本地 IPv6（fe80::），没有可路由的全局 IPv6。ssh 会【优先试 IPv6】，
# 于是直接 "No route to host"，根本轮不到 IPv4 —— 而且 AAAA 广播时有时无，故障是间歇性的，
# 极难排查。IPv6-only 的主机在 .pkghost.yaml 里写 family: inet6（或 any 恢复默认行为）。
case "$PKGH_FAMILY" in
  inet|inet6|any) ;;
  *) die "family 只能是 inet | inet6 | any，收到: ${PKGH_FAMILY}" ;;
esac
# ConnectionAttempts：连不上时 ssh 自己先重试几次。对端是 Wi-Fi 时，网卡省电会让它
#   短暂不应答 ARP，单次连接就报 "No route to host"——重试一下往往就过去了。
# ServerAlive*：远端构建要占着这条 SSH 好几分钟，中途一次网络抖动就会把会话打断、
#   让整次构建白跑。保活让它扛得住短暂中断。
SSH_BASE=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 -o BatchMode=yes
          -o ConnectionAttempts=3 -o ServerAliveInterval=15 -o ServerAliveCountMax=6
          -o "AddressFamily=$PKGH_FAMILY" -i "$PKGH_KEY")

# 按【时间预算】重试，不是按次数。
#
# 为什么这很关键：对端是 Wi-Fi 时，链路会周期性整段掉线——实测 g1 的 WLAN 日志，
# 单次掉线 27~34 秒（断开与重连之间）。如果重试窗口比掉线还短（比如 3s+6s=9s），
# 那么所有重试都落在同一个掉线窗口里，等于没重试，必然失败。
# 所以窗口必须显著长于一次掉线，默认 180s。可在 .pkghost.yaml 里用 retry_budget 调整。
retry_until() {
  local budget="$1"; shift
  local start now delay=5 n=1
  start="$(date +%s)"
  while true; do
    if "$@"; then
      (( n > 1 )) && echo "         第 $n 次尝试成功 / succeeded on attempt $n" >&2
      return 0
    fi
    now="$(date +%s)"
    local left=$(( budget - (now - start) ))
    (( left <= 0 )) && return 1
    (( delay > left )) && delay=$left
    echo "         第 $n 次失败，${delay}s 后重试（剩余预算 ${left}s）/ retry in ${delay}s, ${left}s left" >&2
    sleep "$delay"
    n=$(( n + 1 ))
    (( delay < 20 )) && delay=$(( delay + 5 ))   # 5,10,15,20,20,... 覆盖一次 30s 掉线绰绰有余
  done
}
TARGET="$PKGH_USER@$PKGH_HOST"

rssh() { ssh "${SSH_BASE[@]}" -p "$PKGH_PORT" "$TARGET" "$@"; }

# ---- --print-key ---------------------------------------------------------------
if [[ "$MODE" == "printkey" ]]; then
  pub="$PKGH_KEY.pub"
  [[ -f "$pub" ]] || die "找不到公钥 / public key not found: $pub"
  cat "$pub"; exit 0
fi

# ---- --doctor ------------------------------------------------------------------
if [[ "$MODE" == "doctor" ]]; then
  echo ">>> 测试 SSH 到 $TARGET (port $PKGH_PORT, key $PKGH_KEY)"
  if ! rssh "echo __pkgh_ok__" 2>/tmp/pkgh_ssh_err | grep -q __pkgh_ok__; then
    echo "SSH 连接失败 / SSH failed:" >&2; sed 's/^/    /' /tmp/pkgh_ssh_err >&2
    echo "  → 远端是否已装 OpenSSH Server 并放行本机公钥？见 tools/setup-pkghost-windows.ps1" >&2
    exit 1
  fi
  echo ">>> SSH OK。检查远端工具链 / checking remote toolchain:"
  # 用 -EncodedCommand（base64 UTF-16LE）发送探针，绕开 ssh→cmd→powershell 的多层引号。
  PROBE="$(cat <<'PS'
foreach ($t in 'node','npm','python') {
  $g = Get-Command $t -ErrorAction SilentlyContinue
  if ($g) { try { $v = (& $t --version 2>&1 | Select-Object -First 1) } catch { $v = '' }; ('{0,-7}= {1}  {2}' -f $t, $g.Source, $v) }
  else    { ('{0,-7}= MISSING (不在 PATH，远程打包会失败)' -f $t) }
}
('pwsh   = ' + $PSVersionTable.PSVersion.ToString())
if (Get-Command Expand-Archive -ErrorAction SilentlyContinue) { 'Expand = OK' } else { 'Expand = MISSING' }
PS
)"
  ENC="$("$PY" -c 'import sys,base64; print(base64.b64encode(sys.argv[1].encode("utf-16-le")).decode())' "$PROBE")"
  rssh "powershell -NoProfile -EncodedCommand $ENC" 2>/dev/null | sed 's/^/    /' || echo "    （探针失败 / probe failed）"
  echo ">>> doctor 完成 / done。node/npm/python 三行都有路径即可远程打包。"
  exit 0
fi

# ---- build ---------------------------------------------------------------------
[[ "$PLATFORM" == "windows" ]] || die "--platform 目前仅支持 windows（本主机 platform=${PKGH_PLATFORM}）/ only windows supported"
case "$PKGH_PLATFORM" in *windows*) ;; *) die "主机 '$HOST_ARG' 的 platform=${PKGH_PLATFORM}，不支持 windows / host cannot build windows" ;; esac
[[ -f "$REMOTE_PS1" ]] || die "缺少远端构建脚本 / missing $REMOTE_PS1"

# 连接预检：先确认能连上再花时间打包上传。失败时给出可执行的排查步骤，
# 而不是让用户对着一句 "scp failed" 猜。
if [[ $DRY_RUN -eq 0 ]]; then
  echo ">>> [0/5] 预检连接 / pre-flight: $TARGET (AddressFamily=$PKGH_FAMILY, 连不上会自动重试)"
  probe_once() { rssh "echo __pkgh_up__" 2>/tmp/pkgh_pre_err | grep -q __pkgh_up__; }

  # 第一次就失败时【立刻】抓现场并给判定，不要等满整个重试预算。
  # 起因：预算放宽到 180s 后，用户看到的只有"重试中"，往往等不及就 Ctrl+C，
  # 于是永远看不到诊断结论 —— 诊断来得太晚等于没有。
  if ! probe_once; then
    echo "" >&2
    echo "  首次连接失败，立即诊断 / first attempt failed, diagnosing now ..." >&2
    capture_netdiag "$PKGH_HOST" || true
    print_diag_verdict
    echo "" >&2
    echo "  ↑ 以上是判定。仍会继续重试至多 ${PKGH_RETRY_BUDGET}s（Ctrl+C 可随时中断）" >&2
  fi

  if ! retry_until "$PKGH_RETRY_BUDGET" probe_once; then
    echo "错误：连不上打包主机 $TARGET / cannot reach the packaging host" >&2
    grep -vE 'post-quantum|store now|may need to be upgraded|openssh.com/pq' /tmp/pkgh_pre_err 2>/dev/null | sed 's/^/    /' >&2
    print_diag_verdict
    echo "" >&2
    echo "  排查顺序 / triage:" >&2
    echo "    1. 主机开着吗、在同一网段吗：  ping ${PKGH_HOST}" >&2
    echo "    2. sshd 起来了吗（端口 ${PKGH_PORT}）：  nc -z -G 4 ${PKGH_HOST} ${PKGH_PORT}" >&2
    echo "       没起就在 Windows 上（管理员 PowerShell）：Start-Service sshd" >&2
    echo "    3. 详细握手日志：  ssh -vv -i ${PKGH_KEY} ${TARGET}" >&2
    echo "    4. 工具链自检：    ./tools/pkghost-build.sh --doctor ${HOST_ARG}" >&2
    exit 1
  fi
  echo "         连接正常 / reachable"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
LOCAL_ZIP="${TMPDIR:-/tmp}/pkgh-src-$STAMP.zip"
REMOTE_ZIP="pkgh-src-$STAMP.zip"       # 落在远端用户主目录 / lands in remote home
REMOTE_OUT="pkgh-out-$STAMP.zip"
REMOTE_PS1_NAME="pkghost-remote-build.ps1"

echo ">>> [1/5] 打包工作树 / zipping working tree -> $LOCAL_ZIP"
echo "         (只含 git 跟踪的文件和未被忽略的新文件 / tracked + unignored files only)"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "    (dry-run) 跳过 / skipped"
else
  # out/ 是 electron-vite 的默认构建输出（与 dist//build/ 同理）：远端 `npm run build`
  # 会重新生成，传过去纯属浪费带宽。项目若还有别的大目录（示例工作区、运行产物等），
  # 在这里按同样理由补 -x —— 但 extraResources 的来源目录【绝不能排】。
  # ai-cut：只打 git 跟踪的文件 + 未被 .gitignore 忽略的新文件，与 .gitignore 精确一致
  # （上游有 desktop-dist/、public/whisper-cli/ 等本机构建产物，按目录名排除容易漏）。
  ( cd "$ROOT" && git ls-files -co --exclude-standard -z \
      | grep -z -v -E '(^|/)\.DS_Store$|^\.pkghost\.yaml$' \
      | xargs -0 zip -q "$LOCAL_ZIP" ) \
    || fail "打包失败 / zip failed"

  # ---- 修正非 ASCII 文件名的 UTF-8 标志位（2026-08-03 实测事故）----------------
  # macOS 上 Apple 改过的 Info-ZIP 把非 ASCII 名字（中文/日文/emoji…）按原始 UTF-8 字节存进去，
  # 但【不设 EFS 标志位】（通用位标记 bit 11），而且它不支持能打开这个开关的 -UN=UTF8
  # （会报 "short option 'N' not supported"）。后果：中文/日文 locale 的 Windows 上，
  # Expand-Archive / .NET ZipArchive 对没有该标志的条目按【系统 ANSI 代码页】解码那串 UTF-8 字节
  # → 得到 "ΘÇÜτƒÑσñûΘâ¿Agent" 这类乱码名，其中往往含 Windows 非法字符 → 建文件失败 →
  # Expand-Archive 回滚，回滚时再抛一句 "找不到路径 ...\某个文件"，看着像别的问题，其实根因在这儿。
  # 🔴 若项目里有非 ASCII 名字的【资源目录】（会被 extraResources 打进包），名字解错就等于
  #    打出一个静默缺资源的包 —— 不报错，装上才发现少东西。
  #
  # 修法：整包过一遍 python zipfile 重写。读的时候把没标志的条目名从 cp437 反解回原始字节
  # 再按 UTF-8 解（cp437 是全 256 值的单字节映射，能无损往返）；写的时候 python 的
  # ZipInfo.FileHeader 对非 ASCII 名字【自动置 bit 11】。排除规则仍由上面的 zip 决定，
  # 这一步只碰名字与标志位，不改包含关系。解压侧（.ps1）也显式指定了 UTF-8，两侧都修。
  "$PY" - "$LOCAL_ZIP" <<'PY' || fail "修正文件名编码失败 / filename encoding fix failed"
import os, sys, zipfile
src = sys.argv[1]
tmp = src + ".utf8.tmp"
fixed = []
with zipfile.ZipFile(src) as zin:
    items = []
    for info in zin.infolist():
        name = info.filename
        if not (info.flag_bits & 0x800) and not name.isascii():
            # python 对无 EFS 标志的条目按 cp437 解码 → 先原样编回字节，再按 UTF-8 解
            try:
                name = name.encode("cp437").decode("utf-8")
                fixed.append(name)
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass          # 解不动就保持原样，至少不比现在更糟
        items.append((info, name, zin.read(info.filename)))
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for info, name, data in items:
            ni = zipfile.ZipInfo(name, date_time=info.date_time)
            ni.compress_type = info.compress_type
            ni.external_attr = info.external_attr      # 保住目录位与 unix 权限
            ni.internal_attr = info.internal_attr
            ni.create_system = info.create_system
            zout.writestr(ni, data)
os.replace(tmp, src)
print(f"         已修正 {len(fixed)} 个非 ASCII 文件名的 UTF-8 标志位" if fixed
      else "         无非 ASCII 文件名，无需修正")
for n in fixed:
    print(f"           · {n}")
PY
  echo "         大小 / size: $(du -h "$LOCAL_ZIP" | cut -f1)"
fi

echo ">>> [2/5] 上传到 $TARGET 主目录 / uploading to remote home"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "    (dry-run) scp $LOCAL_ZIP $TARGET:$REMOTE_ZIP"
  echo "    (dry-run) scp $REMOTE_PS1 $TARGET:$REMOTE_PS1_NAME"
else
  up_zip() { scp "${SSH_BASE[@]}" -P "$PKGH_PORT" "$LOCAL_ZIP" "$TARGET:$REMOTE_ZIP" >/dev/null; }
  retry_until "$PKGH_RETRY_BUDGET" up_zip || fail "上传 zip 失败 / scp src failed"
  # 上传前确保 .ps1 带 UTF-8 BOM：否则中文注释在【中文 locale 的 Windows PowerShell 5.1】
  # 下会被当 GBK 解码 → 吞掉引号 → 解析报错。这里保证上传的副本一定有 BOM，
  # 就算仓库里的 .ps1 被某个编辑器另存丢了 BOM 也不受影响。
  PS1_TMP="${TMPDIR:-/tmp}/pkghost-remote-build.bom.ps1"
  "$PY" - "$REMOTE_PS1" "$PS1_TMP" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
if not data.startswith(b"\xef\xbb\xbf"):
    data = b"\xef\xbb\xbf" + data
open(sys.argv[2], "wb").write(data)
PY
  up_ps1() { scp "${SSH_BASE[@]}" -P "$PKGH_PORT" "$PS1_TMP" "$TARGET:$REMOTE_PS1_NAME" >/dev/null; }
  retry_until "$PKGH_RETRY_BUDGET" up_ps1 || fail "上传脚本失败 / scp ps1 failed"
  rm -f "$PS1_TMP"
fi

echo ">>> [3/5] 远端构建 / building on remote（npm ci + node tools/lib/dist.mjs win32-x64${WIN_TARGETS:+ --targets $WIN_TARGETS}$( [[ $PRISTINE -eq 1 ]] && echo " --pristine" )$( [[ $DIST_DIR -eq 1 ]] && echo " --dir" )）"
echo "         workdir=$PKGH_WORKDIR —— 这一步耗时最久，实时日志如下："
REMOTE_CMD="powershell -NoProfile -ExecutionPolicy Bypass -File $REMOTE_PS1_NAME -Zip $REMOTE_ZIP -Out $REMOTE_OUT -Platform $PLATFORM -WorkDir $PKGH_WORKDIR"
# 目标以【逗号】传，绝不能带空格或引号（2026-08-03 实测）：这条命令要穿过 ssh → cmd.exe →
# powershell 三层，cmd.exe 不认单引号，'portable nsis' 会被拆成 'portable 和 nsis' 两个参数，
# $WinTargets 只拿到 "'portable"，最后报 ⨯ Unknown target: 'portable。逗号形式无空格 = 无歧义。
[[ -n "$WIN_TARGETS" ]] && REMOTE_CMD="$REMOTE_CMD -WinTargets ${WIN_TARGETS// /,}"
[[ $CN_MIRROR -eq 1 ]] && REMOTE_CMD="$REMOTE_CMD -CnMirror"
[[ $PRISTINE -eq 1 ]] && REMOTE_CMD="$REMOTE_CMD -Pristine"
[[ $DIST_DIR -eq 1 ]] && REMOTE_CMD="$REMOTE_CMD -DirOnly"
[[ -n "$REMOTE_PROXY" ]] && REMOTE_CMD="$REMOTE_CMD -Proxy $REMOTE_PROXY"
[[ $REMOTE_SMOKE -eq 1 ]] && REMOTE_CMD="$REMOTE_CMD -Smoke"
[[ $KEEP_REMOTE -eq 1 ]] && REMOTE_CMD="$REMOTE_CMD -KeepWork"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "    (dry-run) ssh $TARGET \"$REMOTE_CMD\""
else
  if ! rssh "$REMOTE_CMD"; then
    echo ">>> 远端构建失败 / remote build failed。" >&2
    [[ $KEEP_REMOTE -eq 0 ]] && rssh "powershell -NoProfile -Command \"Remove-Item -Force -EA SilentlyContinue $REMOTE_ZIP,$REMOTE_PS1_NAME\"" >/dev/null 2>&1 || true
    rm -f "$LOCAL_ZIP"
    exit 1
  fi
fi

echo ">>> [4/5] 拉回产物 / downloading artifacts -> $OUT_DIR"
mkdir -p "$OUT_DIR"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "    (dry-run) scp $TARGET:$REMOTE_OUT <tmp> ; unzip -> $OUT_DIR"
else
  DL="${TMPDIR:-/tmp}/$REMOTE_OUT"
  # 这一步失败最亏——包已经在远端打好了，只是没传回来。多试几次。
  dl_out() { scp "${SSH_BASE[@]}" -P "$PKGH_PORT" "$TARGET:$REMOTE_OUT" "$DL" >/dev/null; }
  retry_until "$PKGH_RETRY_BUDGET" dl_out || fail "下载产物失败 / scp out failed（远端产物仍在，可加 --keep-artifact 后手动取）"
  unzip -o -q "$DL" -d "$OUT_DIR" || fail "解压产物失败 / unzip failed"
  rm -f "$DL"
  echo "         产物 / artifacts:"
  ls -1 "$OUT_DIR" | sed 's/^/           /'
fi

echo ">>> [5/5] 清理远端临时文件 / cleaning up remote"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "    (dry-run) 跳过 / skipped"
elif [[ $KEEP_REMOTE -eq 1 ]]; then
  echo "    --keep-remote：保留 $REMOTE_ZIP / $REMOTE_OUT / $REMOTE_PS1_NAME"
else
  rssh "powershell -NoProfile -Command \"Remove-Item -Force -EA SilentlyContinue $REMOTE_ZIP,$REMOTE_OUT,$REMOTE_PS1_NAME\"" >/dev/null 2>&1 || \
    echo "    警告：远端清理失败（可忽略）/ remote cleanup failed (ignorable)" >&2
fi

rm -f "$LOCAL_ZIP"
[[ $DRY_RUN -eq 1 ]] && { echo ">>> dry-run 完成，未实际连接 / done, nothing executed."; exit 0; }
echo ">>> 完成 / done. 产物在 $OUT_DIR"

#!/usr/bin/env bash
# 引导把一台 Windows PC 配成远程打包主机（首次部署）。
# Guided first-time setup of a Windows PC as a remote packaging host.
#
# 为什么单独有这个脚本：setup-pkghost-windows.ps1 待在【本机仓库】里，而目标 Windows
# 上既没有仓库副本、又还没有 SSH 可以传过去 —— 鸡生蛋。所以这里【生成一段自包含的
# PowerShell】，用户复制粘贴一次即可，不依赖 Windows 上有任何本项目文件。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# Register the host in HOME by default: a packaging box is yours, not the
# project's, and writing it per project means re-doing this setup for every new
# repo. --project opts into the project-local file instead.
CONF_HOME="${PKGHOST_CONFIG:-$HOME/.pkghost.yaml}"
CONF_PROJECT="$ROOT/.pkghost.yaml"
CONF="$CONF_HOME"

show_help() {
  cat <<'EOF'
用法 / Usage:
  ./tools/pkghost-init.sh --name <标签> --host <主机名或IP> --user <Windows用户> [选项]
  ./tools/pkghost-init.sh -h | --help

做什么 / What it does:
  一步步把一台 Windows PC 配成远程打包主机，并把它写进 .pkghost.yaml：
    1. 生成本机专用 SSH 密钥（已存在则复用）
    2. 打印一段【自包含的 PowerShell】—— 复制到目标 Windows 的管理员 PowerShell 里粘贴执行
       （装 OpenSSH Server、开机自启、放行防火墙、写入公钥、关网卡省电、预检工具链）
    3. 等你执行完，自动验证 SSH 连通性与远端 node/npm/python
    4. 把这台主机写进 .pkghost.yaml，之后就能 ./build.sh --pkg <标签>

  Walks a Windows PC through becoming a packaging host and registers it in
  .pkghost.yaml. Step 2 emits a SELF-CONTAINED PowerShell block because the target
  has no copy of this repo yet and no SSH to receive one.

必填 / Required:
  --name LABEL       主机标签，用于 --pkg <标签> / host label used as `--pkg <label>`
  --host ADDR        主机名或 IP / hostname or IP（如 my-box.local 或 192.168.1.20）
  --user NAME        Windows 登录用户名 / Windows account name

可选 / Options:
  --port N           SSH 端口 / ssh port（默认 default: 22）
  --workdir PATH     远端构建目录 / remote build dir（默认 default: C:/pkgbuild/<项目名>）
  --key PATH         私钥路径 / identity file（默认 default: ~/.ssh/pkghost_<标签>_key）
  --print-only       只打印要粘贴的 PowerShell 就退出，不等待、不验证
  --verify-only      跳过打印，直接验证连通性与工具链（配好之后复查用）
  --project          写进【本项目】的 ./.pkghost.yaml，而不是家目录
                     Register in the PROJECT config instead of the home one
  -h, --help         显示本帮助 / show this help

前提 / Prerequisites（目标 Windows 上）:
  - Windows 10/11，你有该机的【管理员】权限
  - 装好 Node.js 18+ 与 Python 3（脚本会检测，缺了会给出 winget 安装命令）
  - 该机与本机在同一局域网，且开机不休眠（建议插网线，见 PACKAGING.md）

退出码 / Exit status:
  0 = 配置完成并验证通过 / done and verified
  1 = 验证失败（连不上或远端缺工具）/ verification failed
  2 = 用法或环境问题 / usage or environment problem

示例 / Examples:
  ./tools/pkghost-init.sh --name g1 --host my-box.local --user builder
  ./tools/pkghost-init.sh --name g1 --host 192.168.1.20 --user builder --print-only
  ./tools/pkghost-init.sh --name g1 --host my-box.local --user builder --verify-only
EOF
}

die() { echo "错误 / error: $*" >&2; exit 2; }

[[ $# -eq 0 ]] && { show_help; exit 0; }

NAME="" HOST="" USER_NAME="" PORT="22" WORKDIR="" KEY=""
PRINT_ONLY=0 VERIFY_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)     show_help; exit 0 ;;
    --name)        NAME="${2:-}"; shift 2 ;;
    --host)        HOST="${2:-}"; shift 2 ;;
    --user)        USER_NAME="${2:-}"; shift 2 ;;
    --port)        PORT="${2:-}"; shift 2 ;;
    --workdir)     WORKDIR="${2:-}"; shift 2 ;;
    --key)         KEY="${2:-}"; shift 2 ;;
    --print-only)  PRINT_ONLY=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --project)     CONF="$CONF_PROJECT"; shift ;;
    *)             die "未知参数 / unknown option: $1（见 -h）" ;;
  esac
done

[[ -n "$NAME" ]]      || die "缺少 --name / missing --name"
[[ -n "$HOST" ]]      || die "缺少 --host / missing --host"
[[ -n "$USER_NAME" ]] || die "缺少 --user / missing --user"
[[ "$NAME" =~ ^[A-Za-z0-9_-]+$ ]] || die "--name 只能是字母数字和 _ - / invalid label: $NAME"

for t in ssh ssh-keygen; do command -v "$t" >/dev/null || die "本机缺少 $t / missing: $t"; done

PROJECT_SLUG="$(basename "$ROOT")"
# Writing to the shared home config: keep the workdir GENERIC ({project} is
# substituted per project at build time). Pinning this project's slug there would
# make every other project build into this project's directory on the remote.
if [[ -n "$WORKDIR" ]]; then
  :
elif [[ "$CONF" == "$CONF_PROJECT" ]]; then
  WORKDIR="C:/pkgbuild/$PROJECT_SLUG"
else
  WORKDIR="C:/pkgbuild/{project}"
fi
KEY="${KEY:-$HOME/.ssh/pkghost_${NAME}_key}"
KEY="${KEY/#\~/$HOME}"

# ---- 1. 密钥 / key -------------------------------------------------------------
if [[ ! -f "$KEY" ]]; then
  echo ">>> [1/4] 生成专用 SSH 密钥 / generating key: $KEY"
  mkdir -p "$(dirname "$KEY")"
  ssh-keygen -t ed25519 -f "$KEY" -N '' -C "pkghost_$NAME" -q
  chmod 600 "$KEY"
else
  echo ">>> [1/4] 复用已有密钥 / reusing key: $KEY"
fi
[[ -f "$KEY.pub" ]] || die "公钥缺失 / public key missing: $KEY.pub"
PUBKEY="$(cat "$KEY.pub")"

# ---- 2. 打印要粘贴的 PowerShell / emit the paste block -------------------------
emit_block() {
  cat <<EOF

╔══════════════════════════════════════════════════════════════════════════════╗
║  请在目标 Windows 上，以【管理员】身份打开 PowerShell，整段粘贴执行           ║
║  Paste this whole block into an ELEVATED PowerShell on the Windows box        ║
╚══════════════════════════════════════════════════════════════════════════════╝

\$PubKey = '$PUBKEY'

# 1) 装 OpenSSH Server
\$c = Get-WindowsCapability -Online | Where-Object { \$_.Name -like 'OpenSSH.Server*' } | Select-Object -First 1
if (\$c -and \$c.State -ne 'Installed') { Add-WindowsCapability -Online -Name \$c.Name | Out-Null }

# 2) 开机自启 + 启动
Set-Service sshd -StartupType Automatic; Start-Service sshd
Set-Service ssh-agent -StartupType Automatic -EA SilentlyContinue; Start-Service ssh-agent -EA SilentlyContinue

# 3) 防火墙放行 $PORT
if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -EA SilentlyContinue)) {
  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' \`
    -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort $PORT | Out-Null
}

# 4) 写公钥。管理员账户【只认】administrators_authorized_keys，per-user 的会被忽略；
#    ACL 必须用 SID 设（中文 Windows 上组名不是 "Administrators"）。
function Add-Key(\$f,\$k){
  \$d=Split-Path \$f; if(-not(Test-Path \$d)){New-Item -ItemType Directory -Force \$d|Out-Null}
  \$ex=@(); if(Test-Path \$f){\$ex=Get-Content \$f}
  if(\$ex -notcontains \$k){ Set-Content \$f (@(\$ex|?{\$_ -and \$_.Trim()})+\$k) -Encoding Ascii }
}
\$adm = "\$env:ProgramData\\ssh\\administrators_authorized_keys"
Add-Key \$adm \$PubKey; Add-Key "\$env:USERPROFILE\\.ssh\\authorized_keys" \$PubKey
icacls \$adm /inheritance:r /grant "*S-1-5-32-544:F" /grant "*S-1-5-18:F" | Out-Null
Restart-Service sshd

# 5) 别让网卡为省电掉线（Wi-Fi 打盹时不应答 ARP，表现为 "No route to host"）
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 0
powercfg /setactive SCHEME_CURRENT
\$base='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e972-e325-11ce-bfc1-08002be10318}'
Get-ChildItem \$base -EA SilentlyContinue | ? { \$_.PSChildName -match '^\\d{4}\$' } | % {
  \$k=Get-ItemProperty \$_.PSPath -EA SilentlyContinue
  if (\$k.DriverDesc -and (Get-NetAdapter -EA SilentlyContinue | ? { \$_.InterfaceDescription -eq \$k.DriverDesc -and \$_.Status -eq 'Up' })) {
    Set-ItemProperty \$_.PSPath -Name PnPCapabilities -Value 24 -Type DWord -EA SilentlyContinue
  }
}

# 6) 自检
Get-Service sshd | Format-Table Name,Status,StartType -Auto
foreach (\$t in 'node','npm','python') {
  \$g = Get-Command \$t -EA SilentlyContinue
  if (\$g) { "\$t = " + \$g.Source } else { "\$t = 【缺失】winget install " + \$(if(\$t -eq 'python'){'Python.Python.3.12'}else{'OpenJS.NodeJS.LTS'}) }
}
"IPv4 = " + ((Get-NetIPAddress -AddressFamily IPv4 | ?{ \$_.IPAddress -notmatch '^(127|169\\.254)' }).IPAddress -join ', ')
"===== 配置完成，回到 Mac 继续 / done, go back to the Mac ====="

──────────────────────────────────────────────────────────────────────────────
执行完检查最后几行 / check the last lines:
  - sshd 是 Running          ← 必须
  - node / npm / python 都有路径 ← 缺了就按提示的 winget 命令装，然后重开 PowerShell
──────────────────────────────────────────────────────────────────────────────
EOF
}

if [[ $VERIFY_ONLY -eq 0 ]]; then
  echo ">>> [2/4] 生成要在 Windows 上执行的配置命令 / emitting the setup block"
  emit_block
  [[ $PRINT_ONLY -eq 1 ]] && { echo ">>> --print-only：到此为止。配好后加 --verify-only 复查。"; exit 0; }
  if [[ -t 0 ]]; then
    printf '\n>>> 在 Windows 上执行完后，按回车继续验证 / press Enter when done: '
    read -r _
  else
    echo ">>> 非交互环境，跳过等待，直接验证 / non-interactive, verifying now"
  fi
else
  echo ">>> [2/4] --verify-only：跳过打印"
fi

# ---- 3. 验证 / verify ----------------------------------------------------------
echo ">>> [3/4] 验证 SSH 连通性 / verifying SSH to $USER_NAME@$HOST:$PORT"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes
          -o AddressFamily=inet -i "$KEY" -p "$PORT")
ok=0
for i in 1 2 3 4 5; do
  if ssh "${SSH_OPTS[@]}" "$USER_NAME@$HOST" "echo __pkgh_up__" 2>/tmp/pkgh_init_err | grep -q __pkgh_up__; then
    ok=1; break
  fi
  echo "    第 $i 次未连上，5s 后重试 / attempt $i failed, retry in 5s"
  sleep 5
done

if [[ $ok -eq 0 ]]; then
  echo "验证失败 / verification failed:" >&2
  grep -vE 'post-quantum|store now|may need to be upgraded|openssh.com/pq' /tmp/pkgh_init_err 2>/dev/null | sed 's/^/    /' >&2
  cat >&2 <<EOF

  排查 / triage（按这个顺序，别跳）：
    1. 先分开测 ICMP 和 TCP —— 这是最关键的判据：
         ping -c 3 $HOST
         nc -vz $HOST $PORT
       ping 通但 nc 不通 = 【本机这一侧】在拦，网络和对端都没问题：
         a) macOS「本地网络」权限（macOS 15+ 最常见）：
            系统设置 → 隐私与安全性 → 本地网络 → 打开你的终端 App，
            然后 Cmd+Q 完全退出终端再重开（关窗口不算）。
            open "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork"
         b) 代理 TUN（Clash/Mihomo 等）：开启「绕过局域网 / Bypass LAN」，
            或把 192.168.0.0/16 加入直连(DIRECT)，或临时关掉 TUN。
    2. 两者都不通 → Windows 那边：sshd 起来了吗、防火墙放行了吗、机器睡眠了吗。
    3. 详细握手日志： ssh -vv -i $KEY -p $PORT $USER_NAME@$HOST
EOF
  exit 1
fi
echo "    ✅ SSH 连通"

echo ">>> 检查远端工具链 / checking remote toolchain"
PROBE="$(cat <<'PS'
foreach ($t in 'node','npm','python') {
  $g = Get-Command $t -ErrorAction SilentlyContinue
  if ($g) { try { $v = (& $t --version 2>&1 | Select-Object -First 1) } catch { $v = '' }; ('{0,-7}= {1}  {2}' -f $t, $g.Source, $v) }
  else    { ('{0,-7}= 【缺失 MISSING】远程打包会失败' -f $t) }
}
('pwsh   = ' + $PSVersionTable.PSVersion.ToString())
PS
)"
ENC="$(python3 -c 'import sys,base64; print(base64.b64encode(sys.argv[1].encode("utf-16-le")).decode())' "$PROBE")"
TOOLS_OUT="$(ssh "${SSH_OPTS[@]}" "$USER_NAME@$HOST" "powershell -NoProfile -EncodedCommand $ENC" 2>/dev/null || true)"
echo "$TOOLS_OUT" | sed 's/^/    /'
if echo "$TOOLS_OUT" | grep -q '缺失'; then
  echo "" >&2
  echo "  远端缺少必要工具，装好后重跑： ./tools/pkghost-init.sh --name $NAME --host $HOST --user $USER_NAME --verify-only" >&2
  exit 1
fi

# ---- 4. 写入 .pkghost.yaml -----------------------------------------------------
echo ">>> [4/4] 写入 $CONF"
if [[ "$CONF" == "$CONF_HOME" ]]; then
  echo "    （家目录配置：所有项目共用，新项目无需再配一次）"
else
  echo "    （项目专属配置：只有本项目会用；同名主机按属性覆盖家目录那份）"
fi
if [[ ! -f "$CONF" ]]; then
  mkdir -p "$(dirname "$CONF")"
  cat > "$CONF" <<EOF
# 打包主机清单 / packaging-host registry
# 本机专属，不要提交进仓库。样例见项目里的 .pkghost.yaml.example
default: $NAME

hosts:
EOF
fi

if grep -qE "^  $NAME:" "$CONF" 2>/dev/null; then
  echo "    主机 '${NAME}' 已在配置里，跳过写入（要改就手动编辑 ${CONF}）"
else
  cat >> "$CONF" <<EOF
  $NAME:
    host: $HOST
    user: $USER_NAME
    key: $KEY
    port: $PORT
    workdir: $WORKDIR
    platform: windows
EOF
  echo "    已追加主机 '$NAME'"
fi

cat <<EOF

>>> 完成 / done. 现在可以直接打包：

    ./build.sh --pkg $NAME --platform windows

其它常用 / also:
    ./build.sh --list-pkg                     # 看所有可用打包目标（含 github）
    ./tools/pkghost-build.sh --doctor $NAME   # 复查这台
EOF

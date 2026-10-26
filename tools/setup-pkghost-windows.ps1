<#
.SYNOPSIS
  一次性把这台 Windows 配成远程打包主机：装 OpenSSH Server、开机自启、放行防火墙、
  写入 Mac 端的 SSH 公钥。之后 Mac 上 `./build.sh --pkg <名字>` 即可远程打 Windows 包。

  One-time setup to turn this Windows box into a remote packaging host: install
  OpenSSH Server, auto-start it, open the firewall, and authorise the Mac's public
  key. Afterwards `./build.sh --pkg <name>` on the Mac builds Windows installers here.

.DESCRIPTION
  必须以【管理员】PowerShell 运行 / MUST run in an ELEVATED PowerShell.
  可重复运行（幂等）/ safe to run repeatedly.

.PARAMETER PubKey
  Mac 端的 SSH 公钥内容（一整行 ssh-ed25519 AAAA... 注释）。
  The Mac's SSH public key line (the whole `ssh-ed25519 AAAA... comment`).

.EXAMPLE
  # 在 Mac 上先取公钥： ./tools/pkghost-build.sh --print-key g1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-pkghost-windows.ps1 -PubKey "ssh-ed25519 AAAA... pkghost_g1"
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$PubKey
)

$ErrorActionPreference = "Stop"
function Say($m) { Write-Host ">>> $m" -ForegroundColor Cyan }
function Ok($m)  { Write-Host "    [OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "    [!]  $m" -ForegroundColor Yellow }

# ---- 0. 前置检查 / preflight ---------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw "请以【管理员】身份打开 PowerShell 再运行本脚本 / open PowerShell as Administrator and re-run."
}

$PubKey = $PubKey.Trim()
if ($PubKey -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-|sk-|ssh-dss)') {
  # 宽松校验：至少像个公钥 / loose sanity check
  if ($PubKey -notmatch '^\S+\s+AAAA') {
    throw "PubKey 看起来不像一行 SSH 公钥：'$PubKey'"
  }
}

Say "配置远程打包主机 / configuring this box as a packaging host"
Write-Host "    主机 / host: $env:COMPUTERNAME    用户 / user: $env:USERNAME"

# ---- 1. 装 OpenSSH Server / install OpenSSH Server -----------------------------
Say "检查 / 安装 OpenSSH Server"
$cap = Get-WindowsCapability -Online | Where-Object { $_.Name -like 'OpenSSH.Server*' } | Select-Object -First 1
if (-not $cap) {
  Warn "系统没有 OpenSSH.Server 能力项；尝试直接按标准名安装"
  Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0" | Out-Null
} elseif ($cap.State -ne "Installed") {
  Add-WindowsCapability -Online -Name $cap.Name | Out-Null
  Ok "已安装 $($cap.Name)"
} else {
  Ok "已安装 $($cap.Name)"
}

# ---- 2. 服务自启 / service auto-start ------------------------------------------
Say "设置 sshd 开机自启并启动 / enable + start sshd"
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
# ssh-agent 一并设自启（可选，方便日后）/ ssh-agent too (optional)
try { Set-Service -Name ssh-agent -StartupType Automatic; Start-Service ssh-agent } catch { Warn "ssh-agent 启动跳过（不影响）" }
$svc = Get-Service sshd
Ok "sshd 状态 / status: $($svc.Status), 启动类型 / startup: $((Get-Service sshd).StartType)"

# ---- 3. 防火墙 / firewall ------------------------------------------------------
Say "放行防火墙 22 端口 / open firewall for port 22"
$rule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
if (-not $rule) {
  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
    -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  Ok "已新建防火墙规则 OpenSSH-Server-In-TCP"
} else {
  Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' | Out-Null
  Ok "防火墙规则已存在并启用 / rule present and enabled"
}

# ---- 4. 写入公钥 / authorise the public key ------------------------------------
# Windows OpenSSH 的坑：当登录账户属于管理员组时，sshd 只认
# %ProgramData%\ssh\administrators_authorized_keys（且 ACL 必须只给
# Administrators + SYSTEM），per-user 的 ~/.ssh/authorized_keys 会被【忽略】。
# 这里两处都写，且用【SID】而不是本地化组名设 ACL（中文 Windows 上组名不是 "Administrators"）。
function Add-KeyLine([string]$file, [string]$key) {
  $dir = Split-Path -Parent $file
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $existing = @()
  if (Test-Path -LiteralPath $file) {
    $existing = Get-Content -LiteralPath $file -ErrorAction SilentlyContinue
  }
  if ($existing -contains $key) {
    return $false   # 已存在 / already there
  }
  $lines = @($existing | Where-Object { $_ -and $_.Trim() -ne "" }) + $key
  # ASCII 编码、无 BOM（BOM 会让 sshd 拒绝该文件）/ ASCII, no BOM
  Set-Content -LiteralPath $file -Value $lines -Encoding Ascii
  return $true
}

Say "写入 SSH 公钥 / installing the public key"
# per-user（非管理员账户走这个）
$userAk = Join-Path $env:USERPROFILE ".ssh\authorized_keys"
if (Add-KeyLine $userAk $PubKey) { Ok "写入 $userAk" } else { Ok "$userAk 已含该公钥" }

# administrators_authorized_keys（管理员账户走这个 —— 打包用的账户通常属于管理员组）
$admAk = Join-Path $env:ProgramData "ssh\administrators_authorized_keys"
if (Add-KeyLine $admAk $PubKey) { Ok "写入 $admAk" } else { Ok "$admAk 已含该公钥" }

# 用 SID 设 ACL（S-1-5-32-544=Administrators 组，S-1-5-18=SYSTEM），中文系统也不受影响
Say "收紧 administrators_authorized_keys 权限 / locking down ACL"
& icacls $admAk /inheritance:r | Out-Null
& icacls $admAk /grant "*S-1-5-32-544:F" | Out-Null
& icacls $admAk /grant "*S-1-5-18:F"    | Out-Null
Ok "ACL 设为仅 Administrators + SYSTEM 可读写"

Restart-Service sshd
Ok "sshd 已重启以加载配置 / restarted"

# ---- 5. 预检构建工具链 / pre-flight the build toolchain ------------------------
Say "预检打包需要的工具 / checking build toolchain（缺了下面会标出）"
function Probe($name, $cmd) {
  $g = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($g) {
    try { $v = (& $g.Source --version 2>&1 | Select-Object -First 1) } catch { $v = "" }
    Ok "$name : $($g.Source)  $v"
  } else {
    Warn "$name : 未找到（远程打包会失败，请安装并加入 PATH）/ NOT FOUND"
  }
}
Probe "node  " "node"
Probe "npm   " "npm"
Probe "python" "python"

# ---- 6. 收尾 / done ------------------------------------------------------------
$ips = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -Expand IPAddress) -join ", "
Say "完成 / DONE."
Write-Host ""
Write-Host "  本机 IPv4 / this box: $ips" -ForegroundColor Cyan
Write-Host "  在 Mac 上验证 / verify from the Mac:" -ForegroundColor Cyan
Write-Host "      ./tools/pkghost-build.sh --doctor <名字>" -ForegroundColor White
Write-Host "      ./build.sh --pkg <名字> --platform windows" -ForegroundColor White
Write-Host ""

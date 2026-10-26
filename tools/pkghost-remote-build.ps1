<#
.SYNOPSIS
  在 Windows 上把上传的工作树 zip 构建成 Windows 安装包，再打成一个 zip 供回传。
  Build the uploaded working-tree zip into Windows installers on this machine,
  then pack the installers into one zip for download.

  由 tools/pkghost-build.sh 通过 SSH 调用，一般不用手动运行。
  Invoked over SSH by tools/pkghost-build.sh; not meant to be run by hand.

.PARAMETER Zip       上传到用户主目录的源码 zip 名 / uploaded source zip (in home dir)
.PARAMETER Out       产物 zip 输出名（写到用户主目录）/ artifact zip to produce (in home dir)
.PARAMETER Platform  目前仅 windows / only `windows`
.PARAMETER WorkDir   构建目录 / build directory
.PARAMETER SkipSidecar  （ai-cut 没有侧车，保留参数只为兼容）/ unused in ai-cut
.PARAMETER Pristine  用上游原样的打包配置（基线验证）/ build with upstream's own config
.PARAMETER DirOnly   只出 win-unpacked 目录 / unpacked output only
.PARAMETER Smoke     打完后在本机静默安装 → 冒烟启动（含一次真实渲染）→ 卸载，日志随产物回传
                     silent install, smoke-launch (with a real render), uninstall; log is returned
.PARAMETER Proxy     构建用的 HTTP 代理（如 http://127.0.0.1:7897）；不传时自动探测本机 7897 / 7890 上能通 GitHub 的代理
                     HTTP proxy for the build; auto-detected on 127.0.0.1:7897/7890 when omitted
.PARAMETER KeepWork  构建成功后保留构建目录（约 1GB，便于排查）。默认成功即删——
                     该目录每次构建开头都会重建，留着不会让下次更快。
                     Keep the ~1GB build dir on success (for debugging). Deleted by default.
.PARAMETER CnMirror  依赖改走 npmmirror（阿里云在中国大陆的 npm / electron 镜像）。
                     兜底开关：只有当这台机器到 GitHub 的实测下载速率明显低于镜像时才加。
                     Route deps via npmmirror (Alibaba's China-mainland mirror). Fallback
                     only — use when this host measures slower to GitHub than to the mirror.
#>
param(
  [string]$Zip = "src.zip",
  [string]$Out = "out.zip",
  [string]$Platform = "windows",
  [string]$WorkDir = "C:/pkgbuild/ai-cut",
  # electron-builder 的 win target 覆盖，【逗号分隔、不带空格】（如 portable,nsis）。
  # 为什么不用空格：这个参数要穿过 ssh → cmd.exe → powershell，cmd.exe 不认单引号，
  # 带空格的值会被拆成两个参数（实测报 ⨯ Unknown target: 'portable）。空 = 用 package.json 的
  # build.win.target。见下方构建段。
  [string]$WinTargets = "",
  [switch]$SkipSidecar,
  [switch]$Pristine,
  [string]$Proxy = "",
  [switch]$DirOnly,
  [switch]$Smoke,
  [switch]$CnMirror,
  [switch]$KeepWork
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # 让 Expand/Compress-Archive 不刷进度、更快
# 让中文进度输出以 UTF-8 回传，否则经 ssh 管道到 UTF-8 终端会变 GBK 乱码（纯显示，不影响构建）
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Say($m) { Write-Host ">>> $m" }
function Run($file, [string[]]$argv) {
  Write-Host "    `$ $file $($argv -join ' ')"
  & $file @argv
  if ($LASTEXITCODE -ne 0) {
    throw "命令失败 / command failed (exit $LASTEXITCODE): $file $($argv -join ' ')"
  }
}
function Find-Python {
  foreach ($c in @("python", "python3", "py")) {
    $g = Get-Command $c -ErrorAction SilentlyContinue
    if ($g) {
      try { & $g.Source --version 2>$null 1>$null; if ($LASTEXITCODE -eq 0) { return $g.Source } } catch {}
    }
  }
  return $null
}

$startDir = (Get-Location).Path
Say "pkghost 远端构建开始 / remote build start  ($(Get-Date -Format o))"
Say "主机 / host: $env:COMPUTERNAME   用户 / user: $env:USERNAME   起始目录 / cwd: $startDir"

if ($Platform -ne "windows") { throw "本脚本只打 windows / this script only builds windows (got: $Platform)" }

# ---- 校验工具链 / verify toolchain --------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
$npm  = Get-Command npm  -ErrorAction SilentlyContinue
if (-not $node) { throw "找不到 node —— 请确认 Windows 上已装 Node.js 且在 PATH 里 / node not on PATH" }
if (-not $npm)  { throw "找不到 npm / npm not on PATH" }
Run "node" @("-v")
Run "npm"  @("-v")

# ai-cut：上游 scripts/sync-whisper-cli.mjs 在 Windows 上用 `unzip` 解压 whisper.cpp 的发行包。
# GitHub 的 Windows runner 自带 unzip，SSH 会话的 PATH 里通常没有；Git for Windows 在 usr\bin 下带了一份。
# 追加到 PATH 末尾（不是开头），免得 usr\bin 里的 find / sort / link 盖掉 Windows 自己的同名命令。
if (-not (Get-Command unzip -ErrorAction SilentlyContinue)) {
  $gitExe = Get-Command git -ErrorAction SilentlyContinue
  if ($gitExe) {
    $usrBin = Join-Path (Split-Path (Split-Path $gitExe.Source -Parent) -Parent) "usr\bin"
    if (Test-Path -LiteralPath (Join-Path $usrBin "unzip.exe")) {
      $env:Path = "$env:Path;$usrBin"
      Write-Host "    unzip: $usrBin（Git for Windows 自带 / bundled with Git for Windows）"
    }
  }
}
if (-not (Get-Command unzip -ErrorAction SilentlyContinue)) {
  throw "找不到 unzip（上游 sync-whisper-cli 解压 whisper.cpp 要用）—— 请安装 Git for Windows 或把 unzip.exe 放进 PATH / unzip not found"
}

# ai-cut：构建要从 GitHub / googleapis 下载 ffmpeg、whisper.cpp、Chrome for Testing 等二进制。
# SSH 会话不继承桌面会话里的代理设置，直连经常超时（2026-10-25 实测 ffmpeg-static 下载 ETIMEDOUT）。
# 显式给了 -Proxy 就用它；否则若环境里没有代理变量，探测本机常见代理端口，能通 GitHub 才用。
if (-not $Proxy -and -not $env:HTTPS_PROXY) {
  foreach ($port in 7897, 7890) {
    $candidate = "http://127.0.0.1:$port"
    $code = & curl.exe -s -o NUL -m 8 -x $candidate -w "%{http_code}" https://github.com 2>$null
    if ($LASTEXITCODE -eq 0 -and $code -match '^[23]') { $Proxy = $candidate; break }
  }
}
if ($Proxy) {
  $env:HTTPS_PROXY = $Proxy; $env:HTTP_PROXY = $Proxy
  $env:NO_PROXY = "localhost,127.0.0.1,::1"
  Write-Host "    proxy: $Proxy（构建下载走代理 / downloads go through this proxy）"
} else {
  Write-Host "    proxy: 未使用 / none"
}

# python 只在【真有侧车要打】时才是硬依赖 —— 而「有没有侧车」要等源码解出来才知道（见下方侧车段），
# 所以这里只探测、不因为缺 python 就终止。原来在这儿硬 throw 会让所有【无侧车项目】在还没解压源码时
# 就构建失败，报错还指向一个它根本不需要的东西。
$py = $null
if (-not $SkipSidecar) {
  $py = Find-Python
  if ($py) { Write-Host "    python: $py" } else { Write-Host "    python: 未安装（无侧车项目不需要 / not required without a sidecar）" }
}

# ---- npmmirror 镜像（可选）/ optional npmmirror (China-mainland) ----------------
if ($CnMirror) {
  Say "改走 npmmirror 镜像 / using npmmirror (electron + electron-builder + npm registry)"
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
  $env:npm_config_registry = "https://registry.npmmirror.com"
}

# ---- 解出源码 / unpack the source ---------------------------------------------
if (-not (Test-Path -LiteralPath $Zip)) { throw "找不到上传的源码 zip: ${Zip}（应在 ${startDir}）" }
$zipFull = (Resolve-Path -LiteralPath $Zip).Path
$outFull = Join-Path $startDir $Out
$src = Join-Path $WorkDir "src"

Say "解压源码 / extracting -> $src"
if (Test-Path -LiteralPath $src) { Remove-Item -Recurse -Force -LiteralPath $src }
New-Item -ItemType Directory -Force -Path $src | Out-Null
# 用 .NET 的 ZipFile 并【显式指定 UTF-8】解名字，不用 Expand-Archive（2026-08-03 实测事故）。
# Expand-Archive 底层的 ZipArchive 不传 entryNameEncoding 时，对没有 EFS 标志位(bit 11)的条目
# 按【系统 ANSI 代码页】解码 —— 中文 Windows 上就是 GBK，于是 macOS 存进去的 UTF-8 中文名被解成
# "ΘÇÜτƒÑσñûΘâ¿Agent" 这类含非法字符的乱码，建文件失败后它还会回滚，并抛出一句
# "找不到路径 ...\tools\pkghost-build.sh" 的次生错误，把人往完全错误的方向带。
# 打包侧（pkghost-build.sh）现在会补上标志位，这里再显式指定一次编码 —— 两侧都修，
# 换台机器 / 换个 zip 工具产生的包也不复发。
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipFull, $src, [System.Text.Encoding]::UTF8)
} catch {
  throw "解压失败 / extract failed: $($_.Exception.Message)`n（若报文件名非法，多半是 zip 里的非 ASCII 名字没带 UTF-8 标志位 —— 见 PACKAGING.md）"
}

Set-Location -LiteralPath $src
if (-not (Test-Path "package.json")) { throw "解压后没有 package.json —— 源码 zip 结构不对" }

# ai-cut 没有 Python 侧车（上游的原生能力都在 Node / Electron 里），这里不打 PyInstaller。

# ---- 安装依赖 + 构建 / install + build ----------------------------------------
Say "安装依赖 / npm ci（首次较慢，之后走缓存）"
# 依赖的 postinstall 会联网下载平台二进制，偶发超时就整次失败；失败重试一次（npm ci 每次都从零装，可安全重跑）。
try { Run "npm" @("ci") } catch {
  Say "npm ci 失败，30 秒后重试一次 / npm ci failed, retrying once in 30s: $($_.Exception.Message)"
  Start-Sleep -Seconds 30
  Run "npm" @("ci")
}

# ai-cut：构建步骤由 tools/lib/dist.mjs 统一编排（与本机 tools/build.sh 同一份），
# 依次是 vite build → 主进程 esbuild → 派生入口 → Remotion 预打包 → 目标平台二进制 → electron-builder。
# -WinTargets 以【逗号分隔、不带空格】传入（见参数注释），原样交给 --targets。
$distArgs = @("tools/lib/dist.mjs", "win32-x64")
if ($WinTargets) { $distArgs += @("--targets", (($WinTargets -split '[,\s]+' | Where-Object { $_ }) -join ",")) }
if ($Pristine) { $distArgs += "--pristine" }
if ($DirOnly) { $distArgs += "--dir" }
Say "构建 + 打包 / node $($distArgs -join ' ')"
Run "node" $distArgs

# ---- 收集产物 / collect artifacts ---------------------------------------------
$releaseDir = Join-Path (Get-Location).Path $(if ($Pristine) { "release" } else { "release-aicut" })
if ($DirOnly) {
  $unpacked = Join-Path $releaseDir "win-unpacked"
  if (-not (Test-Path -LiteralPath $unpacked)) { throw "没有 $unpacked —— electron-builder 可能失败了" }
  Say "产物 / built: $unpacked（目录形式 / unpacked）"
  if (Test-Path -LiteralPath $outFull) { Remove-Item -Force -LiteralPath $outFull }
  Compress-Archive -Path $unpacked -DestinationPath $outFull -Force
} else {
  $exes = @(Get-ChildItem -Path $releaseDir -Filter *.exe -File -ErrorAction SilentlyContinue)
  if ($exes.Count -eq 0) { throw "$releaseDir 下没有 .exe —— electron-builder 可能失败了" }
  Say "产物 / built:"
  foreach ($e in $exes) {
    Write-Host ("    " + $e.Name + "  (" + [math]::Round($e.Length / 1MB, 1) + " MB)")
  }
  if (Test-Path -LiteralPath $outFull) { Remove-Item -Force -LiteralPath $outFull }
  Compress-Archive -Path (Join-Path $releaseDir "*.exe") -DestinationPath $outFull -Force
}
# ---- 冒烟测试（可选）/ optional install + smoke --------------------------------
# 照上游 .github/workflows/desktop.yml 的 Windows 冒烟：静默安装到构建目录 → CC_SMOKE=1 启动（应用自检 MCP、
# preload、更新器，并真的渲染一段）→ 看日志里的 SMOKE-OK → 静默卸载。另外检查派生版的数据目录隔离：
# 令牌应写进 %USERPROFILE%\.ai-cut，而不是上游的 .openchatcut。日志放进回传的 zip。
if ($Smoke -and -not $DirOnly) {
  $installer = @(Get-ChildItem -Path $releaseDir -Filter *.exe -File)[0]
  $installDir = Join-Path $WorkDir "smoke-install"
  $smokeLog = Join-Path $releaseDir "smoke.log"
  $aicutHome = Join-Path $env:USERPROFILE ".ai-cut"
  $upstreamToken = Join-Path $env:USERPROFILE ".openchatcut\mcp-token"
  $upstreamTokenBefore = Test-Path -LiteralPath $upstreamToken
  $lines = New-Object System.Collections.Generic.List[string]
  $smokeFailed = $null
  if (Test-Path -LiteralPath $installDir) { Remove-Item -Recurse -Force -LiteralPath $installDir }
  try {
    Say "冒烟：静默安装 / smoke: silent install -> $installDir"
    $p = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "安装器退出码 / installer exit $($p.ExitCode)" }
    $exe = @(Get-ChildItem -LiteralPath $installDir -Filter *.exe -File | Where-Object { $_.Name -notlike 'Uninstall*' })[0]
    if (-not $exe) { throw "安装目录里没有主程序 / no app exe in $installDir" }
    foreach ($rel in @('resources\app.asar', 'resources\dist\index.html', 'resources\remotion-bundle\index.html', 'resources\aicut-skill\SKILL.md', 'resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe')) {
      if (-not (Test-Path -LiteralPath (Join-Path $installDir $rel))) { throw "安装后缺文件 / missing after install: $rel" }
    }
    $lines.Add("installed: $($exe.FullName)")
    $env:CC_SMOKE = '1'; $env:CC_SMOKE_RENDER = '1'
    $out = Join-Path $WorkDir "smoke-stdout.log"; $err = Join-Path $WorkDir "smoke-stderr.log"
    Say "冒烟：启动 / smoke: launching $($exe.Name)（最长 420 秒 / up to 420s）"
    $app = Start-Process -FilePath $exe.FullName -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $app.Handle
    $finished = $app.WaitForExit(420000)
    if (-not $finished) { taskkill /T /F /PID $app.Id 2>$null | Out-Null }
    Remove-Item Env:CC_SMOKE, Env:CC_SMOKE_RENDER -ErrorAction SilentlyContinue
    $lines.Add('--- stdout ---'); if (Test-Path $out) { Get-Content $out | ForEach-Object { $lines.Add($_) } }
    $lines.Add('--- stderr ---'); if (Test-Path $err) { Get-Content $err | Select-Object -Last 80 | ForEach-Object { $lines.Add($_) } }
    if (-not ((Test-Path $out) -and (Select-String -LiteralPath $out -Pattern 'SMOKE-OK' -Quiet))) {
      throw $(if ($finished) { "冒烟失败，退出码 $($app.ExitCode) / smoke failed" } else { "冒烟 420 秒未结束 / smoke timed out" })
    }
    $tokenOk = Test-Path -LiteralPath (Join-Path $aicutHome 'mcp-token')
    $lines.Add("aicut-home token: $tokenOk ($aicutHome)")
    $lines.Add("upstream token before/after: $upstreamTokenBefore / $(Test-Path -LiteralPath $upstreamToken)")
    if (-not $tokenOk) { throw "数据目录没有隔离：$aicutHome\mcp-token 不存在 / data root not isolated" }
    if (-not $upstreamTokenBefore -and (Test-Path -LiteralPath $upstreamToken)) { throw "派生版写进了上游的 .openchatcut / wrote into upstream's .openchatcut" }
    $lines.Add('SMOKE-RESULT: PASS')
    Say "冒烟通过 / smoke passed"
  } catch {
    $smokeFailed = $_.Exception.Message
    $lines.Add("SMOKE-RESULT: FAIL $smokeFailed")
    Say "冒烟失败 / smoke failed: $smokeFailed"
  } finally {
    $un = @(Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue)
    if ($un.Count -ge 1) {
      $u = Start-Process -FilePath $un[0].FullName -ArgumentList '/S' -Wait -PassThru
      $lines.Add("uninstall exit: $($u.ExitCode)")
    }
    Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
    [System.IO.File]::WriteAllLines($smokeLog, $lines, (New-Object System.Text.UTF8Encoding $true))
    Compress-Archive -Path $smokeLog -DestinationPath $outFull -Update
  }
}
Say "已打包回传文件 / packed -> $outFull  ($([math]::Round((Get-Item $outFull).Length / 1MB, 1)) MB)"

# 清掉构建目录。它在每次构建开头本来就会被整个删掉重建，所以留着没有任何加速作用：
# 真正让重建变快的是 electron / electron-builder / npm 三个缓存，都在 %LOCALAPPDATA%
# 和 npm config 的 cache 目录里，不在这儿。不清的话每台主机会长期占着约 1GB
# （node_modules + win-unpacked + 两个安装包）。失败时不清，留着排查——反正下次构建会覆盖。
# Clean the build dir: it is wiped and re-created at the start of every build anyway, so
# keeping it buys nothing (the caches that speed up rebuilds live elsewhere). Left in place
# on failure for debugging.
Set-Location -LiteralPath $startDir
if ($KeepWork) {
  Say "保留构建目录 / build dir kept (-KeepWork): ${src}"
} else {
  $freed = [math]::Round(((Get-ChildItem -Recurse -Force -File -EA SilentlyContinue -LiteralPath $src |
    Measure-Object Length -Sum).Sum) / 1MB, 1)
  Remove-Item -Recurse -Force -EA SilentlyContinue -LiteralPath $src
  Say "已清理构建目录 / build dir cleaned: ${src}  (回收 ${freed} MB, 依赖缓存保留)"
}
Say "远端构建完成 / remote build done."

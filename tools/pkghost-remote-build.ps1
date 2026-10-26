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
  [switch]$DirOnly,
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
Run "npm" @("ci")

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

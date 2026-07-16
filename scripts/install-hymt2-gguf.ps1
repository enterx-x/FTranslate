[CmdletBinding()]
param(
  [string]$InstallRoot = '',
  [ValidateSet('quality', 'fast')]
  [string]$Profile = 'quality',
  [string]$ModelSourcePath = '',
  [string]$RuntimeArchivePath = '',
  [string]$CudaArchivePath = ''
)

$ErrorActionPreference = 'Stop'

if ($Profile -eq 'quality') {
  $ModelFileName = 'Hy-MT2-7B-Q4_K_M.gguf'
  $ModelUrl = 'https://huggingface.co/tencent/Hy-MT2-7B-GGUF/resolve/main/Hy-MT2-7B-Q4_K_M.gguf?download=true'
  $ModelSha256 = '9F96256500F3FC1AB4D64336B58F52A949A95AD7516B0C229476EEF782F9F77B'
  $ModelLabel = 'HY-MT2 7B Q4 质量档（约 4.62 GB）'
} else {
  $ModelFileName = 'Hy-MT2-1.8B-Q4_K_M.gguf'
  $ModelUrl = 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf?download=true'
  $ModelSha256 = 'DC5F44FCF1FA496EE7AD725982C0C8C553A4DE00259B53AF84C4B89FB0C06699'
  $ModelLabel = 'HY-MT2 1.8B Q4 快速档（约 1.13 GB）'
}
$LlamaRelease = 'b10046'
$RuntimeArchiveName = "llama-$LlamaRelease-bin-win-cuda-12.4-x64.zip"
$RuntimeUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaRelease/$RuntimeArchiveName"
$RuntimeSha256 = 'EAEEB109E8855DD312150A30652D548040775A5CBFC4EC8AA46CC516DC1BC4FD'
$CudaArchiveName = 'cudart-llama-bin-win-cuda-12.4-x64.zip'
$CudaRuntimeUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaRelease/$CudaArchiveName"
$CudaRuntimeSha256 = '8C79A9B226DE4B3CACFD1F83D24F962D0773BE79F1E7B75C6AF4DED7E32AE1D6'

function Resolve-DefaultInstallRoot {
  if ($env:FTRANSLATE_HYMT_ROOT) {
    return $env:FTRANSLATE_HYMT_ROOT
  }
  if (Test-Path -LiteralPath 'E:\') {
    return 'E:\FTranslateTools\hy-mt2'
  }
  return (Join-Path $env:LOCALAPPDATA 'FTranslate\hy-mt2')
}

function Assert-Sha256([string]$Path, [string]$Expected) {
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actual -ne $Expected) {
    throw "SHA-256 校验失败：$Path`n期望：$Expected`n实际：$actual"
  }
}

function Download-Resumable([string]$Url, [string]$Destination) {
  $curl = (Get-Command curl.exe -ErrorAction Stop).Source
  & $curl -L --http1.1 --fail --retry 5 --retry-all-errors --connect-timeout 20 --speed-time 30 --speed-limit 1024 -C - -o $Destination $Url
  if ($LASTEXITCODE -ne 0) {
    throw "下载失败：$Url"
  }
}

if (-not $InstallRoot) {
  $InstallRoot = Resolve-DefaultInstallRoot
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$ModelsDir = Join-Path $InstallRoot 'models'
$RuntimeDir = Join-Path $InstallRoot 'runtime'
$DownloadsDir = Join-Path $InstallRoot 'downloads'
$ModelPath = Join-Path $ModelsDir $ModelFileName
$RuntimeArchive = Join-Path $DownloadsDir $RuntimeArchiveName
$CudaArchive = Join-Path $DownloadsDir $CudaArchiveName
$ServerPath = Join-Path $RuntimeDir 'llama-server.exe'

New-Item -ItemType Directory -Force -Path $InstallRoot, $ModelsDir, $RuntimeDir, $DownloadsDir | Out-Null

Write-Host "[1/6] 准备 $ModelLabel..."
if ($ModelSourcePath) {
  $source = [IO.Path]::GetFullPath($ModelSourcePath)
  Assert-Sha256 $source $ModelSha256
  if ($source -ne $ModelPath) {
    Copy-Item -LiteralPath $source -Destination $ModelPath -Force
  }
} elseif (-not (Test-Path -LiteralPath $ModelPath)) {
  Download-Resumable $ModelUrl $ModelPath
}
Assert-Sha256 $ModelPath $ModelSha256

Write-Host "[2/6] 准备 llama.cpp CUDA 主运行时..."
if ($RuntimeArchivePath) {
  $source = [IO.Path]::GetFullPath($RuntimeArchivePath)
  Assert-Sha256 $source $RuntimeSha256
  if ($source -ne $RuntimeArchive) {
    Copy-Item -LiteralPath $source -Destination $RuntimeArchive -Force
  }
} elseif (-not (Test-Path -LiteralPath $RuntimeArchive)) {
  Download-Resumable $RuntimeUrl $RuntimeArchive
}
Assert-Sha256 $RuntimeArchive $RuntimeSha256

Write-Host "[3/6] 准备可随应用运行的 CUDA DLL..."
if ($CudaArchivePath) {
  $source = [IO.Path]::GetFullPath($CudaArchivePath)
  Assert-Sha256 $source $CudaRuntimeSha256
  if ($source -ne $CudaArchive) {
    Copy-Item -LiteralPath $source -Destination $CudaArchive -Force
  }
} elseif (-not (Test-Path -LiteralPath $CudaArchive)) {
  Download-Resumable $CudaRuntimeUrl $CudaArchive
}
Assert-Sha256 $CudaArchive $CudaRuntimeSha256

Write-Host "[4/6] 解压本地推理服务..."
Expand-Archive -LiteralPath $RuntimeArchive -DestinationPath $RuntimeDir -Force
Expand-Archive -LiteralPath $CudaArchive -DestinationPath $RuntimeDir -Force
if (-not (Test-Path -LiteralPath $ServerPath)) {
  throw "运行时不完整，未找到：$ServerPath"
}
if (-not (Get-ChildItem -LiteralPath $RuntimeDir -Filter 'cudart64_*.dll' -File -ErrorAction SilentlyContinue)) {
  throw "CUDA 运行时不完整，未在 $RuntimeDir 找到 cudart64 DLL。"
}

Write-Host "[5/6] 保存开源许可证..."
$licenseTargets = @(
  @('https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/LICENSE.txt', (Join-Path $InstallRoot 'LICENSE-Hy-MT2.txt')),
  @('https://raw.githubusercontent.com/ggml-org/llama.cpp/master/LICENSE', (Join-Path $InstallRoot 'LICENSE-llama.cpp.txt'))
)
foreach ($entry in $licenseTargets) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $entry[0] -OutFile $entry[1] -TimeoutSec 30
  } catch {
    Write-Warning "许可证文本下载失败，可稍后从官方仓库查看：$($entry[0])"
  }
}

Write-Host "[6/6] 写入当前用户环境变量..."
[Environment]::SetEnvironmentVariable('FTRANSLATE_HYMT_SERVER', $ServerPath, 'User')
[Environment]::SetEnvironmentVariable('FTRANSLATE_HYMT_MODEL', $ModelPath, 'User')
[Environment]::SetEnvironmentVariable('FTRANSLATE_HYMT_PROFILE', $Profile, 'User')
[Environment]::SetEnvironmentVariable('FTRANSLATE_LOCAL_TRANSLATION_ENGINE', 'hy-mt-first', 'User')
$env:FTRANSLATE_HYMT_SERVER = $ServerPath
$env:FTRANSLATE_HYMT_MODEL = $ModelPath
$env:FTRANSLATE_HYMT_PROFILE = $Profile
$env:FTRANSLATE_LOCAL_TRANSLATION_ENGINE = 'hy-mt-first'

Write-Host ''
Write-Host 'HY-MT2 本地翻译环境安装完成。' -ForegroundColor Green
Write-Host "配置档：$Profile"
Write-Host "模型：$ModelPath"
Write-Host "运行时：$ServerPath"
Write-Host '请完全退出并重新打开 FTranslate，使 Electron 读取新的用户环境变量。'

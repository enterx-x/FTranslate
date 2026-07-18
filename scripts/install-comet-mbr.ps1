[CmdletBinding()]
param(
  [string]$InstallRoot = 'E:\FTranslateTools\comet-mbr',
  [string]$Python = 'E:\python3.10\python.exe',
  [switch]$ForceModelDownload
)

$ErrorActionPreference = 'Stop'
$ModelId = 'Unbabel/wmt22-comet-da'
$ModelRevision = '2760a223ac957f30acfb18c8aa649b01cf1d75f2'
$EncoderId = 'xlm-roberta-large'
$EncoderRevision = 'c23d21b0620b635a76227c604d44e43a9f0ee389'
$PackageVersion = '2.2.7'
$TransformersVersion = '4.46.3'
$LightningVersion = '2.4.0'
$NumpyVersion = '1.24.4'
$RequiredFreeBytes = 4GB
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$StagingRoot = Join-Path $InstallRoot '.staging'
$VenvRoot = Join-Path $InstallRoot '.venv'
$VenvPython = Join-Path $VenvRoot 'Scripts\python.exe'
$StagedVenvRoot = Join-Path $StagingRoot '.venv'
$StagedVenvPython = Join-Path $StagedVenvRoot 'Scripts\python.exe'
$ModelsRoot = Join-Path $InstallRoot 'models'
$ModelRoot = Join-Path $ModelsRoot 'wmt22-comet-da'
$StagedModelRoot = Join-Path $StagingRoot 'wmt22-comet-da'
$CheckpointPath = Join-Path $ModelRoot 'checkpoints\model.ckpt'
$HfCacheRoot = Join-Path $InstallRoot 'hf-cache'
$StagedHfCacheRoot = Join-Path $StagingRoot 'hf-cache'
$EncoderCacheRepoRoot = Join-Path $HfCacheRoot 'models--xlm-roberta-large'
$EncoderSnapshotRoot = Join-Path $EncoderCacheRepoRoot "snapshots\$EncoderRevision"
$EncoderMainRef = Join-Path $EncoderCacheRepoRoot 'refs\main'
$ManifestPath = Join-Path $InstallRoot 'manifest.json'
$WorkerCandidates = @(
  (Join-Path $PSScriptRoot '..\runtime\comet-mbr\comet_mbr_worker.py'),
  (Join-Path $PSScriptRoot '..\assets\runtime\comet-mbr\comet_mbr_worker.py')
)
$WorkerPath = $WorkerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $WorkerPath) {
  throw "COMET worker 不存在。已检查：$($WorkerCandidates -join '；')"
}
$WorkerPath = [IO.Path]::GetFullPath($WorkerPath)

function Invoke-CheckedPython {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed with exit code ${LASTEXITCODE}: $Executable $($Arguments -join ' ')"
  }
}

function Assert-InstallPreflight {
  if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "未找到基础 Python：$Python"
  }
  $root = [IO.Path]::GetPathRoot($InstallRoot)
  if (-not $root) {
    throw "无法解析安装盘符：$InstallRoot"
  }
  $driveName = $root.Substring(0, 1)
  $drive = Get-PSDrive -Name $driveName -PSProvider FileSystem -ErrorAction Stop
  if ($drive.Free -lt $RequiredFreeBytes -and -not (Test-Path -LiteralPath $CheckpointPath -PathType Leaf)) {
    throw "COMET-MBR 安装至少需要 4 GiB 可用空间；$driveName 盘当前仅剩 $([math]::Round($drive.Free / 1GB, 2)) GiB。"
  }
}

function Test-CometEnvironment {
  param([string]$Executable)
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    return $false
  }
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Executable -c "import importlib.metadata as m, torch; assert m.version('unbabel-comet') == '$PackageVersion'; assert m.version('transformers') == '$TransformersVersion'; assert m.version('pytorch-lightning') == '$LightningVersion'; assert m.version('numpy') == '$NumpyVersion'" *> $null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  return $exitCode -eq 0
}

Assert-InstallPreflight
New-Item -ItemType Directory -Force -Path $InstallRoot, $ModelsRoot | Out-Null

try {
  if (Test-Path -LiteralPath $StagingRoot) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $StagingRoot | Out-Null

  Write-Host '[1/6] 准备隔离 Python 环境（复用现有 CPU Torch）...'
  if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
    Invoke-CheckedPython -Executable $Python -Arguments @('-m', 'venv', '--system-site-packages', $StagedVenvRoot)
    if (Test-Path -LiteralPath $VenvRoot) {
      throw "现有 COMET 环境无效，为避免破坏用户数据未自动覆盖：$VenvRoot"
    }
    Move-Item -LiteralPath $StagedVenvRoot -Destination $VenvRoot
  }
  if (-not (Test-CometEnvironment $VenvPython)) {
    Invoke-CheckedPython -Executable $VenvPython -Arguments @(
      '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir',
      "unbabel-comet==$PackageVersion",
      "transformers==$TransformersVersion",
      "pytorch-lightning==$LightningVersion",
      "numpy==$NumpyVersion"
    )
    Invoke-CheckedPython -Executable $VenvPython -Arguments @('-c', "import importlib.metadata as m, torch; assert m.version('unbabel-comet') == '$PackageVersion'; assert m.version('transformers') == '$TransformersVersion'; assert m.version('pytorch-lightning') == '$LightningVersion'; assert m.version('numpy') == '$NumpyVersion'; print('torch=' + torch.__version__); print('cuda=' + str(torch.cuda.is_available()))")
  } else {
    Write-Host "已复用官方锁定依赖：$VenvPython"
  }

  Write-Host '[2/6] 下载并校验锁定版本的 COMET 模型...'
  if ($ForceModelDownload -and (Test-Path -LiteralPath $ModelRoot)) {
    throw "-ForceModelDownload 不会直接删除现有模型。请先手动备份或移走：$ModelRoot"
  }
  if (-not (Test-Path -LiteralPath $CheckpointPath -PathType Leaf)) {
    $env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
    $env:HF_HUB_DISABLE_TELEMETRY = '1'
    $env:HF_HOME = Join-Path $StagingRoot 'hf-home'
    $downloadScript = @'
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="{MODEL_ID}",
    revision="{REVISION}",
    local_dir=r"{MODEL_DIR}",
)
'@
    $downloadScript = $downloadScript.Replace('{MODEL_ID}', $ModelId)
    $downloadScript = $downloadScript.Replace('{REVISION}', $ModelRevision)
    $downloadScript = $downloadScript.Replace('{MODEL_DIR}', $StagedModelRoot.Replace('\', '\\'))
    $downloadScript | & $VenvPython -
    if ($LASTEXITCODE -ne 0) {
      throw '锁定版本的 COMET 模型下载失败。'
    }
    $stagedCheckpoint = Join-Path $StagedModelRoot 'checkpoints\model.ckpt'
    if (-not (Test-Path -LiteralPath $stagedCheckpoint -PathType Leaf)) {
      throw "下载完成但未找到模型检查点：$stagedCheckpoint"
    }
    if (Test-Path -LiteralPath $ModelRoot) {
      throw "目标模型目录已存在但检查点不完整，为避免覆盖未自动删除：$ModelRoot"
    }
    Move-Item -LiteralPath $StagedModelRoot -Destination $ModelRoot
  } else {
    Write-Host "已复用：$CheckpointPath"
  }

  Write-Host '[3/6] 准备锁定版本的 XLM-R 分词资源（离线评分必需）...'
  if (-not (Test-Path -LiteralPath (Join-Path $EncoderSnapshotRoot 'tokenizer.json') -PathType Leaf)) {
    $encoderScript = @'
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="{ENCODER_ID}",
    revision="{ENCODER_REVISION}",
    cache_dir=r"{CACHE_DIR}",
    allow_patterns=[
        "config.json",
        "sentencepiece.bpe.model",
        "tokenizer.json",
        "tokenizer_config.json",
    ],
)
'@
    $encoderScript = $encoderScript.Replace('{ENCODER_ID}', $EncoderId)
    $encoderScript = $encoderScript.Replace('{ENCODER_REVISION}', $EncoderRevision)
    $encoderScript = $encoderScript.Replace('{CACHE_DIR}', $StagedHfCacheRoot.Replace('\', '\\'))
    $encoderScript | & $VenvPython -
    if ($LASTEXITCODE -ne 0) {
      throw '锁定版本的 XLM-R 分词资源下载失败。'
    }
    if (Test-Path -LiteralPath $HfCacheRoot) {
      throw "目标 Hugging Face 缓存不完整，为避免覆盖未自动删除：$HfCacheRoot"
    }
    Move-Item -LiteralPath $StagedHfCacheRoot -Destination $HfCacheRoot
  } else {
    Write-Host "已复用：$EncoderSnapshotRoot"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $EncoderMainRef -Parent) | Out-Null
  Set-Content -LiteralPath $EncoderMainRef -Value $EncoderRevision -Encoding ascii -NoNewline

  Write-Host '[4/6] 计算检查点哈希并写入安装清单...'
  $checkpoint = Get-Item -LiteralPath $CheckpointPath
  $checkpointHash = (Get-FileHash -LiteralPath $CheckpointPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $versionJson = & $VenvPython -c "import importlib.metadata as m, json, torch; print(json.dumps({'comet': m.version('unbabel-comet'), 'transformers': m.version('transformers'), 'pytorch_lightning': m.version('pytorch-lightning'), 'numpy': m.version('numpy'), 'huggingface_hub': m.version('huggingface-hub'), 'torch': torch.__version__, 'cuda': bool(torch.cuda.is_available())}))"
  if ($LASTEXITCODE -ne 0) {
    throw '无法读取 COMET 运行环境版本。'
  }
  $versions = $versionJson | ConvertFrom-Json
  $manifest = [ordered]@{
    schemaVersion = 1
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
    installRoot = $InstallRoot
    pythonPath = $VenvPython
    packages = [ordered]@{
      comet = $versions.comet
      transformers = $versions.transformers
      pytorchLightning = $versions.pytorch_lightning
      numpy = $versions.numpy
      huggingfaceHub = $versions.huggingface_hub
      torch = $versions.torch
    }
    cudaAvailable = [bool]$versions.cuda
    model = [ordered]@{
      id = $ModelId
      revision = $ModelRevision
      checkpointPath = $CheckpointPath
      checkpointBytes = [int64]$checkpoint.Length
      checkpointSha256 = $checkpointHash
      license = 'Apache-2.0'
      licenseUrl = 'https://huggingface.co/Unbabel/wmt22-comet-da/blob/main/LICENSE'
    }
    encoder = [ordered]@{
      id = $EncoderId
      revision = $EncoderRevision
      cacheRoot = $HfCacheRoot
      offline = $true
    }
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding utf8

  Write-Host '[5/6] 验证锁定模型身份与本机设备...'
  $env:FTRANSLATE_COMET_MBR_MODEL = $CheckpointPath
  $env:FTRANSLATE_COMET_MBR_MODEL_ID = $ModelId
  $env:FTRANSLATE_COMET_MBR_MODEL_REVISION = $ModelRevision
  $env:HF_HOME = $HfCacheRoot
  $env:HF_HUB_CACHE = $HfCacheRoot
  $env:HUGGINGFACE_HUB_CACHE = $HfCacheRoot
  $env:HF_HUB_OFFLINE = '1'
  $env:TRANSFORMERS_OFFLINE = '1'
  Invoke-CheckedPython -Executable $VenvPython -Arguments @($WorkerPath, '--probe')

  Write-Host '[6/6] 写入当前用户运行时位置...'
  [Environment]::SetEnvironmentVariable('FTRANSLATE_COMET_MBR_ROOT', $InstallRoot, 'User')
  [Environment]::SetEnvironmentVariable('FTRANSLATE_COMET_MBR_PYTHON', $VenvPython, 'User')
  [Environment]::SetEnvironmentVariable('FTRANSLATE_COMET_MBR_MODEL', $CheckpointPath, 'User')
  [Environment]::SetEnvironmentVariable('FTRANSLATE_COMET_MBR_HF_HOME', $HfCacheRoot, 'User')
  $env:FTRANSLATE_COMET_MBR_ROOT = $InstallRoot
  $env:FTRANSLATE_COMET_MBR_PYTHON = $VenvPython
  $env:FTRANSLATE_COMET_MBR_HF_HOME = $HfCacheRoot

  Write-Host ''
  Write-Host 'COMET-MBR 本地质量评估环境安装完成。' -ForegroundColor Green
  Write-Host "Python：$VenvPython"
  Write-Host "模型：$CheckpointPath"
  Write-Host "清单：$ManifestPath"
  Write-Host '请完全退出并重新打开 FTranslate，使 Electron 读取新的用户环境变量。'
} finally {
  if (Test-Path -LiteralPath $StagingRoot) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force
  }
}

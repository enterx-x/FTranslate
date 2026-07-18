[CmdletBinding()]
param(
  [string]$InstallRoot = 'E:\FTranslateTools\comet-mbr',
  [int]$Rounds = 3,
  [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
$Python = Join-Path $InstallRoot '.venv\Scripts\python.exe'
$Model = Join-Path $InstallRoot 'models\wmt22-comet-da\checkpoints\model.ckpt'
$HfCache = Join-Path $InstallRoot 'hf-cache'
$Worker = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets\runtime\comet-mbr\comet_mbr_worker.py'))
$ModelId = 'Unbabel/wmt22-comet-da'
$ModelRevision = '2760a223ac957f30acfb18c8aa649b01cf1d75f2'
if (-not $OutputRoot) {
  $OutputRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.tmp-comet-benchmark'))
}

function Get-FreePhysicalMemoryBytes {
  $os = Get-CimInstance Win32_OperatingSystem
  return [int64]$os.FreePhysicalMemory * 1KB
}

function Stop-FTranslateHyMt2 {
  $targets = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^llama-server(\.exe)?$' -and
    $_.CommandLine -and
    $_.CommandLine -match 'FTranslateTools[\\/]hy-mt2'
  }
  foreach ($target in $targets) {
    Write-Host "停止 FTranslate HY-MT2 进程：PID $($target.ProcessId)"
    Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop
  }
  return @($targets).Count
}

function Get-ProcessTreeIds {
  param([int]$RootProcessId)
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $ids = [Collections.Generic.List[int]]::new()
  $ids.Add($RootProcessId)
  for ($index = 0; $index -lt $ids.Count; $index += 1) {
    $parentId = $ids[$index]
    foreach ($child in $all | Where-Object { [int]$_.ParentProcessId -eq $parentId }) {
      $childId = [int]$child.ProcessId
      if (-not $ids.Contains($childId)) {
        $ids.Add($childId)
      }
    }
  }
  return @($ids)
}

function Get-ProcessTreePeakWorkingSet {
  param([int]$RootProcessId)
  $peak = 0L
  foreach ($processId in Get-ProcessTreeIds $RootProcessId) {
    $member = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($member) {
      $member.Refresh()
      $peak = [math]::Max($peak, [int64]$member.PeakWorkingSet64)
    }
  }
  return [int64]$peak
}

function Invoke-WorkerRequest {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][hashtable]$Payload
  )
  $line = $Payload | ConvertTo-Json -Depth 8 -Compress
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $Process.StandardInput.WriteLine($line)
  $Process.StandardInput.Flush()
  $responseLine = $Process.StandardOutput.ReadLine()
  $watch.Stop()
  if (-not $responseLine) {
    throw 'COMET worker 未返回响应，请查看终端中的 worker 错误。'
  }
  $response = $responseLine | ConvertFrom-Json
  if (-not $response.ok) {
    throw "COMET worker 请求失败：$($response.error)"
  }
  return [ordered]@{
    durationMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 2)
    result = $response.result
    peakWorkingSetBytes = Get-ProcessTreePeakWorkingSet $Process.Id
  }
}

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
  throw "未找到 COMET Python：$Python"
}
if (-not (Test-Path -LiteralPath $Model -PathType Leaf)) {
  throw "未找到 COMET 检查点：$Model"
}
if (-not (Test-Path -LiteralPath $Worker -PathType Leaf)) {
  throw "未找到 COMET worker：$Worker"
}
if ($Rounds -lt 1) {
  throw 'Rounds 必须至少为 1。'
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$stoppedHyMt2 = Stop-FTranslateHyMt2
$memoryBefore = Get-FreePhysicalMemoryBytes
$startedAt = (Get-Date).ToUniversalTime()
$process = $null
$results = @()

try {
  $env:FTRANSLATE_COMET_MBR_MODEL = $Model
  $env:FTRANSLATE_COMET_MBR_MODEL_ID = $ModelId
  $env:FTRANSLATE_COMET_MBR_MODEL_REVISION = $ModelRevision
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Python
  $startInfo.Arguments = '"' + $Worker.Replace('"', '\"') + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $false
  $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
  $startInfo.EnvironmentVariables['FTRANSLATE_COMET_MBR_MODEL'] = $Model
  $startInfo.EnvironmentVariables['FTRANSLATE_COMET_MBR_MODEL_ID'] = $ModelId
  $startInfo.EnvironmentVariables['FTRANSLATE_COMET_MBR_MODEL_REVISION'] = $ModelRevision
  $startInfo.EnvironmentVariables['HF_HOME'] = $HfCache
  $startInfo.EnvironmentVariables['HF_HUB_CACHE'] = $HfCache
  $startInfo.EnvironmentVariables['HUGGINGFACE_HUB_CACHE'] = $HfCache
  $startInfo.EnvironmentVariables['HF_HUB_OFFLINE'] = '1'
  $startInfo.EnvironmentVariables['TRANSFORMERS_OFFLINE'] = '1'
  $startInfo.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
  $process = [Diagnostics.Process]::Start($startInfo)

  $probe = Invoke-WorkerRequest $process @{ id = 'probe'; action = 'probe' }
  $pairs = @(
    @{ source = 'Safe reinforcement learning constrains robot motion.'; translation = '安全强化学习约束机器人运动。'; reference = '安全强化学习会限制机器人的运动。' },
    @{ source = 'Safe reinforcement learning constrains robot motion.'; translation = '安全强化学习限制机器人的运动。'; reference = '安全强化学习约束机器人运动。' },
    @{ source = 'Physics-informed models improve data efficiency.'; translation = '物理信息模型提升数据效率。'; reference = '融入物理知识的模型能够提高数据利用效率。' },
    @{ source = 'Physics-informed models improve data efficiency.'; translation = '物理模型让数据更有效。'; reference = '物理信息模型提升数据效率。' },
    @{ source = 'The planner avoids dynamic obstacles.'; translation = '规划器能够避开动态障碍物。'; reference = '规划器会规避运动中的障碍物。' },
    @{ source = 'The planner avoids dynamic obstacles.'; translation = '这个计划不碰移动的东西。'; reference = '规划器能够避开动态障碍物。' }
  )
  for ($round = 1; $round -le $Rounds; $round += 1) {
    $score = Invoke-WorkerRequest $process @{
      id = "score-$round"
      action = 'score'
      pairs = $pairs
    }
    $results += [pscustomobject][ordered]@{
      round = $round
      durationMs = $score.durationMs
      scores = @($score.result.scores)
      peakWorkingSetBytes = $score.peakWorkingSetBytes
    }
  }
  $unload = Invoke-WorkerRequest $process @{ id = 'unload'; action = 'unload' }
  $shutdown = Invoke-WorkerRequest $process @{ id = 'shutdown'; action = 'shutdown' }
  if (-not $process.WaitForExit(10000)) {
    throw 'COMET worker 在 shutdown 后仍未退出。'
  }
  $memoryAfter = Get-FreePhysicalMemoryBytes
  $report = [ordered]@{
    schemaVersion = 1
    startedAt = $startedAt.ToString('o')
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    stoppedHyMt2Processes = $stoppedHyMt2
    runtime = [ordered]@{
      pythonPath = $Python
      workerPath = $Worker
      modelPath = $Model
      modelId = $ModelId
      modelRevision = $ModelRevision
      device = $probe.result.device
    }
    memory = [ordered]@{
      freeBeforeBytes = $memoryBefore
      freeAfterBytes = $memoryAfter
      peakWorkerWorkingSetBytes = [int64](($results | Measure-Object -Property peakWorkingSetBytes -Maximum).Maximum)
    }
    timings = [ordered]@{
      probeMs = $probe.durationMs
      scoreRounds = $results
      unloadMs = $unload.durationMs
      shutdownMs = $shutdown.durationMs
    }
    orphanWorker = -not $process.HasExited
  }
  $fileName = "comet-mbr-$($startedAt.ToString('yyyyMMdd-HHmmss')).json"
  $reportPath = Join-Path $OutputRoot $fileName
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding utf8
  Write-Host "COMET-MBR benchmark complete: $reportPath" -ForegroundColor Green
  $report | ConvertTo-Json -Depth 10
} finally {
  if ($process -and -not $process.HasExited) {
    $process.Kill()
    $process.WaitForExit(5000) | Out-Null
  }
  if ($process) {
    $process.Dispose()
  }
}

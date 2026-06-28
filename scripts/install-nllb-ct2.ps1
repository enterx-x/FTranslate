param(
  [string]$ToolsRoot = "E:\FTranslateTools",
  [string]$ModelName = "facebook/nllb-200-distilled-600M",
  [string]$PythonLauncher = "py -3.11",
  [string]$DownloadProxy = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$venvDir = Join-Path $ToolsRoot "nllb-ctranslate2"
$modelDir = Join-Path $ToolsRoot "models\nllb-200-distilled-600M-ct2-int8"
$hfCacheDir = Join-Path $ToolsRoot "hf-cache"
$pythonExe = Join-Path $venvDir "Scripts\python.exe"
$hfSnapshotDir = Join-Path $ToolsRoot "hf-cache\nllb-200-distilled-600M-snapshot"
$cudaDllCandidates = @(
  "E:\Anaconda\envs\pytorch\Lib\site-packages\torch\lib",
  "E:\Anaconda\envs\SB3_RL\Lib\site-packages\torch\lib",
  "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.7\bin",
  "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\bin",
  "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.5\bin",
  "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin"
)

New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $modelDir -Parent) | Out-Null
New-Item -ItemType Directory -Force -Path $hfCacheDir | Out-Null

# pip/requests may read the Windows system proxy. Some local proxy setups break TLS
# with "check_hostname requires server_hostname", so the installer bypasses proxies.
$env:NO_PROXY = "*"
$env:no_proxy = "*"

if (!(Test-Path $pythonExe)) {
  Write-Host "Creating Python venv at $venvDir"
  $launcherParts = $PythonLauncher -split "\s+"
  $launcherArgs = @()
  if ($launcherParts.Length -gt 1) {
    $launcherArgs = $launcherParts[1..($launcherParts.Length - 1)]
  }
  & $launcherParts[0] @launcherArgs -m venv $venvDir
}

Write-Host "Installing NLLB CTranslate2 dependencies..."
& $pythonExe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
  throw "pip upgrade failed"
}
& $pythonExe -m pip install --upgrade ctranslate2 "transformers>=4.42,<5" sentencepiece huggingface_hub torch
if ($LASTEXITCODE -ne 0) {
  throw "NLLB dependency installation failed"
}

if ($Force -and (Test-Path $modelDir)) {
  Write-Host "Removing existing model directory because -Force was supplied: $modelDir"
  Remove-Item -LiteralPath $modelDir -Recurse -Force
}

if ($Force -and (Test-Path $hfSnapshotDir)) {
  Write-Host "Removing existing Hugging Face snapshot because -Force was supplied: $hfSnapshotDir"
  Remove-Item -LiteralPath $hfSnapshotDir -Recurse -Force
}

if (!(Test-Path $hfSnapshotDir)) {
  Write-Host "Downloading $ModelName snapshot to $hfSnapshotDir"
  $env:NO_PROXY = ""
  $env:no_proxy = ""
  $proxyToUse = $DownloadProxy
  if (!$proxyToUse) {
    try {
      $systemProxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy("https://huggingface.co")
      if ($systemProxy -and $systemProxy.AbsoluteUri -ne "https://huggingface.co/") {
        $proxyToUse = $systemProxy.AbsoluteUri.TrimEnd("/")
      }
    } catch {
      $proxyToUse = ""
    }
  }
  if ($proxyToUse) {
    Write-Host "Using proxy for Hugging Face download: $proxyToUse"
    $env:HTTP_PROXY = $proxyToUse
    $env:HTTPS_PROXY = $proxyToUse
  }
  $env:HF_HOME = $hfCacheDir
  $env:HUGGINGFACE_HUB_CACHE = Join-Path $hfCacheDir "hub"
  $downloadScript = @'
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="{MODEL_NAME}",
    local_dir=r"{SNAPSHOT_DIR}",
    local_dir_use_symlinks=False,
    resume_download=True,
    allow_patterns=[
        "config.json",
        "generation_config.json",
        "pytorch_model.bin",
        "sentencepiece.bpe.model",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
    ],
)
'@
  $downloadScript = $downloadScript.Replace("{MODEL_NAME}", $ModelName).Replace("{SNAPSHOT_DIR}", $hfSnapshotDir.Replace("\", "\\"))
  $downloadScript | & $pythonExe -
  if ($LASTEXITCODE -ne 0) {
    throw "Hugging Face snapshot download failed"
  }
}

if (!(Test-Path $modelDir)) {
  Write-Host "Converting local snapshot to CTranslate2 int8 at $modelDir"
  $env:HF_HOME = $hfCacheDir
  $env:HUGGINGFACE_HUB_CACHE = Join-Path $hfCacheDir "hub"
  & $pythonExe -m ctranslate2.converters.transformers --model $hfSnapshotDir --output_dir $modelDir --quantization int8 --force
  if ($LASTEXITCODE -ne 0) {
    throw "CTranslate2 model conversion failed"
  }
} else {
  Write-Host "Model already exists: $modelDir"
}

Write-Host "Writing user environment variables..."
[Environment]::SetEnvironmentVariable("FTRANSLATE_NLLB_PYTHON", $pythonExe, "User")
[Environment]::SetEnvironmentVariable("FTRANSLATE_NLLB_MODEL_DIR", $modelDir, "User")
[Environment]::SetEnvironmentVariable("FTRANSLATE_NLLB_TOKENIZER_DIR", $hfSnapshotDir, "User")
[Environment]::SetEnvironmentVariable("FTRANSLATE_NLLB_DEVICE", "auto", "User")
$cudaDllDirs = @()
foreach ($candidate in $cudaDllCandidates) {
  if ((Test-Path (Join-Path $candidate "cublas64_12.dll")) -and (Test-Path (Join-Path $candidate "cudart64_12.dll"))) {
    $cudaDllDirs += $candidate
  }
}
if ($cudaDllDirs.Count -gt 0) {
  [Environment]::SetEnvironmentVariable("FTRANSLATE_NLLB_CUDA_DLL_DIRS", ($cudaDllDirs -join ";"), "User")
  Write-Host "CUDA DLL directories: $($cudaDllDirs -join ';')"
} else {
  Write-Host "CUDA DLL directories were not found. NLLB will run on CPU unless CUDA runtime is installed later."
}

Write-Host "Running smoke test..."
if ($cudaDllDirs.Count -gt 0) {
  $env:FTRANSLATE_NLLB_CUDA_DLL_DIRS = ($cudaDllDirs -join [IO.Path]::PathSeparator)
  $env:PATH = (($cudaDllDirs -join [IO.Path]::PathSeparator) + [IO.Path]::PathSeparator + $env:PATH)
}
$smoke = @'
import os
import time
import ctranslate2
from transformers import AutoTokenizer

model_dir = r"{MODEL_DIR}"
tokenizer_dir = r"{TOKENIZER_DIR}"
cuda_dll_dirs = [p for p in os.environ.get("FTRANSLATE_NLLB_CUDA_DLL_DIRS", "").split(os.pathsep) if p]
if hasattr(os, "add_dll_directory"):
    for dll_dir in cuda_dll_dirs:
        if os.path.isdir(dll_dir):
            os.add_dll_directory(dll_dir)
tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir, src_lang="eng_Latn", local_files_only=True)
tokens = tokenizer.convert_ids_to_tokens(tokenizer.encode("Robot navigation requires robust perception.", add_special_tokens=True))
target_lang_id = tokenizer.convert_tokens_to_ids("zho_Hans")
target_prefix = [[tokenizer.convert_ids_to_tokens(target_lang_id)]]
last_error = None
translator = None
runtime_device = "unknown"
start = time.time()
for device in ["cuda", "cpu"]:
    try:
        translator = ctranslate2.Translator(model_dir, device=device, compute_type="int8")
        runtime_device = device
        break
    except Exception as exc:
        last_error = exc
        print(f"{device.upper()} smoke failed: {exc}")
if translator is None:
    raise last_error or RuntimeError("No CTranslate2 runtime available")
result = translator.translate_batch([tokens], target_prefix=target_prefix, beam_size=4, max_decoding_length=128)
out_tokens = result[0].hypotheses[0]
if out_tokens and out_tokens[0] == target_prefix[0][0]:
    out_tokens = out_tokens[1:]
print(f"NLLB smoke runtime: {runtime_device.upper()} ({time.time() - start:.2f}s)")
print(tokenizer.decode(tokenizer.convert_tokens_to_ids(out_tokens), skip_special_tokens=True))
'@
$smoke = $smoke.Replace("{MODEL_DIR}", $modelDir.Replace("\", "\\")).Replace("{TOKENIZER_DIR}", $hfSnapshotDir.Replace("\", "\\"))
$smoke | & $pythonExe -
if ($LASTEXITCODE -ne 0) {
  throw "NLLB smoke test failed"
}

Write-Host ""
Write-Host "NLLB CTranslate2 int8 is installed."
Write-Host "Python: $pythonExe"
Write-Host "Model : $modelDir"
Write-Host "Tokenizer: $hfSnapshotDir"
if ($cudaDllDirs.Count -gt 0) {
  Write-Host "CUDA DLL dirs: $($cudaDllDirs -join ';')"
}
Write-Host "Restart FTranslate so Electron can read the updated user environment variables."

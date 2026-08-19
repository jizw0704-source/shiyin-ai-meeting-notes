param(
  [string]$ReleaseDirectory = "release",
  [string]$ExpectedVersion = "0.5.1"
)

$ErrorActionPreference = "Stop"
$releaseRoot = (Resolve-Path $ReleaseDirectory).Path
$installer = Get-ChildItem -Path $releaseRoot -Recurse -File |
  Where-Object { $_.Name -match "Setup.*\.exe$" } |
  Select-Object -First 1
if (-not $installer) { throw "没有找到 Windows NSIS 安装包" }

$installRoot = Join-Path $env:RUNNER_TEMP "shiyin-ai-installed"
$userDataRoot = Join-Path $env:APPDATA "拾音 AI"
$markerPath = Join-Path $userDataRoot "data\ci-upgrade-preserve.txt"

function Stop-ShiyinProcesses {
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

function Install-Shiyin {
  $process = Start-Process -FilePath $installer.FullName -ArgumentList @("/S", "/D=$installRoot") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "NSIS 安装失败，退出码：$($process.ExitCode)" }
}

function Start-And-VerifyShiyin {
  $application = Get-ChildItem -Path $installRoot -Filter "拾音 AI.exe" -Recurse -File | Select-Object -First 1
  if (-not $application) { throw "安装目录中没有找到拾音 AI.exe" }
  $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($application.FullName).ProductVersion
  if (-not $version.StartsWith($ExpectedVersion)) {
    throw "安装版本不符：期望 $ExpectedVersion，实际 $version"
  }

  Start-Process -FilePath $application.FullName | Out-Null
  $health = $null
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8788/health" -TimeoutSec 2
      if ($health.ok) { break }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $health.ok) { throw "安装版启动后，本地后台未能在 120 秒内就绪" }
  if ($health.service -ne "shiyin-ai-backend") { throw "后台身份校验失败" }
  if ($health.asrMode -ne "local" -or -not $health.localAsrAvailable) { throw "安装版未加载本地转写模型" }
  if (-not $health.speakerModelAvailable) { throw "安装版未加载发言人模型" }

  $page = Invoke-WebRequest -Uri $health.appOrigin -UseBasicParsing -TimeoutSec 10
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch "<title>拾音 AI") {
    throw "安装版界面身份或 HTTP 状态校验失败"
  }
  return @{ application = $application; health = $health; version = $version }
}

try {
  Install-Shiyin
  $firstRun = Start-And-VerifyShiyin
  Stop-ShiyinProcesses

  New-Item -ItemType Directory -Force -Path (Split-Path $markerPath) | Out-Null
  Set-Content -Path $markerPath -Value "preserve-across-upgrade" -Encoding UTF8

  Install-Shiyin
  if (-not (Test-Path $markerPath)) { throw "覆盖安装删除了已有用户数据" }
  if ((Get-Content $markerPath -Raw) -notmatch "preserve-across-upgrade") {
    throw "覆盖安装修改了已有用户数据"
  }
  $secondRun = Start-And-VerifyShiyin
  Stop-ShiyinProcesses

  $uninstaller = Get-ChildItem -Path $installRoot -Filter "Uninstall*.exe" -Recurse -File | Select-Object -First 1
  if (-not $uninstaller) { throw "安装目录中没有找到卸载程序" }
  $uninstallProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) { throw "静默卸载失败，退出码：$($uninstallProcess.ExitCode)" }
  if (-not (Test-Path $markerPath)) { throw "卸载程序意外删除了用户会议数据" }

  $result = [ordered]@{
    ok = $true
    version = $secondRun.version
    installer = $installer.Name
    localAsrAvailable = $secondRun.health.localAsrAvailable
    speakerModelAvailable = $secondRun.health.speakerModelAvailable
    dataPreservedAcrossUpgrade = $true
    dataPreservedAfterUninstall = $true
  }
  $result | ConvertTo-Json | Tee-Object -FilePath (Join-Path $releaseRoot "windows-smoke-result.json")
} finally {
  Stop-ShiyinProcesses
}

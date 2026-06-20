param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBase,

  [Parameter(Mandatory = $true)]
  [string]$WorkspaceId,

  [string]$Queue = "Adverts",
  [string]$TaskName = "Inkwell Tumblr Local Runner",
  [string]$UserDataDir = ".tumblr-runner-profile-local",
  [int]$IntervalSeconds = 15,
  [int]$CompanionPort = 17842,
  [string]$RunnerToken = ""
)

$ErrorActionPreference = "Stop"

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not [string]::IsNullOrWhiteSpace($RunnerToken)) {
  [Environment]::SetEnvironmentVariable("INWELL_LOCAL_RUNNER_TOKEN", $RunnerToken, "User")
}

$token = [Environment]::GetEnvironmentVariable("INWELL_LOCAL_RUNNER_TOKEN", "User")
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "INWELL_LOCAL_RUNNER_TOKEN is not set in the Windows user environment."
}

function Quote-PowerShell([string]$Value) {
  "'" + $Value.Replace("'", "''") + "'"
}

function Safe-FileName([string]$Value) {
  $safe = $Value
  foreach ($char in [System.IO.Path]::GetInvalidFileNameChars()) {
    $safe = $safe.Replace([string]$char, "-")
  }
  $safe.Trim()
}

$launcherRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "InkwellLocalRunner"
$installRoot = Join-Path $launcherRoot "runner"
$launcherName = Safe-FileName $TaskName
$launcherPs1 = Join-Path $launcherRoot "$launcherName.ps1"
$launcherCmd = Join-Path $launcherRoot "$launcherName.cmd"

function Normalize-Path([string]$Value) {
  [System.IO.Path]::GetFullPath($Value).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}

function Install-RunnerPackage {
  New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

  if ((Normalize-Path $sourceRoot) -ieq (Normalize-Path $installRoot)) {
    return
  }

  Get-ChildItem -LiteralPath $sourceRoot -Force |
    Where-Object { $_.Name -ne $UserDataDir } |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $installRoot -Recurse -Force
    }
}

Install-RunnerPackage
$repoRoot = Resolve-Path $installRoot

function Install-RunnerLauncher {
  New-Item -ItemType Directory -Force -Path $launcherRoot | Out-Null
  $launcherScript = @(
    '$ErrorActionPreference = "Stop"',
    '$logPath = Join-Path $PSScriptRoot "runner.log"',
    'try { Start-Transcript -Path $logPath -Append | Out-Null } catch {}',
    'try {',
    '  $env:INWELL_LOCAL_RUNNER_TOKEN = [Environment]::GetEnvironmentVariable("INWELL_LOCAL_RUNNER_TOKEN", "User")',
    "  Set-Location -LiteralPath $(Quote-PowerShell $repoRoot.Path)",
    "  npm.cmd run tumblr:runner:local -- --api-base $(Quote-PowerShell $ApiBase) --workspace-id $(Quote-PowerShell $WorkspaceId) --queue $(Quote-PowerShell $Queue) --user-data-dir $(Quote-PowerShell $UserDataDir) --watch --serve --companion-port $CompanionPort --no-pause --submit --interval-seconds $IntervalSeconds",
    '  if ($LASTEXITCODE -ne 0) { throw "Local runner exited with code $LASTEXITCODE." }',
    '} finally {',
    '  try { Stop-Transcript | Out-Null } catch {}',
    '}'
  ) -join [Environment]::NewLine
  $launcherBatch = @"
@echo off
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0$launcherName.ps1"
"@

  Set-Content -LiteralPath $launcherPs1 -Value $launcherScript -Encoding UTF8
  Set-Content -LiteralPath $launcherCmd -Value $launcherBatch -Encoding ASCII
}

function Install-ProtocolLauncher {
  $protocolRoot = "HKCU:\Software\Classes\inkwell-runner"
  New-Item -Path $protocolRoot -Force | Out-Null
  New-ItemProperty -Path $protocolRoot -Name "(default)" -Value "URL:Inkwell Local Runner" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
  New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
  New-ItemProperty -Path "$protocolRoot\shell\open\command" -Name "(default)" -Value "`"$launcherCmd`" `"%1`"" -PropertyType String -Force | Out-Null
  Write-Host "Installed protocol launcher: inkwell-runner://start"
}

function Install-StartupLauncher {
  $startupDir = [Environment]::GetFolderPath("Startup")
  if ([string]::IsNullOrWhiteSpace($startupDir)) {
    throw "Could not find the Windows Startup folder for this user."
  }

  $baseName = Safe-FileName $TaskName
  $startupCmd = Join-Path $startupDir "$baseName.cmd"
  $startupBatch = @"
@echo off
call "$launcherCmd"
"@
  Set-Content -LiteralPath $startupCmd -Value $startupBatch -Encoding ASCII
  Write-Host "Installed Startup folder launcher: $startupCmd"
}

Install-RunnerLauncher
Install-ProtocolLauncher

$scheduledArgument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPs1`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $scheduledArgument
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 7) -MultipleInstances IgnoreNew
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Runs the Inkwell Tumblr local watcher at Windows login."

try {
  Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
  Write-Host "Installed scheduled task: $TaskName"
} catch {
  Write-Warning "Could not register scheduled task: $($_.Exception.Message)"
  Install-StartupLauncher
}
Write-Host "Queue: $Queue"
Write-Host "API: $ApiBase"

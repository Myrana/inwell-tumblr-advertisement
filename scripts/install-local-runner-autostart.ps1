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

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
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

$commandParts = @(
  "`$env:INWELL_LOCAL_RUNNER_TOKEN = [Environment]::GetEnvironmentVariable('INWELL_LOCAL_RUNNER_TOKEN', 'User')",
  "Set-Location $(Quote-PowerShell $repoRoot.Path)",
  "npm.cmd run tumblr:runner:local -- --api-base $(Quote-PowerShell $ApiBase) --workspace-id $(Quote-PowerShell $WorkspaceId) --queue $(Quote-PowerShell $Queue) --user-data-dir $(Quote-PowerShell $UserDataDir) --watch --serve --companion-port $CompanionPort --no-pause --submit --interval-seconds $IntervalSeconds"
)
$command = $commandParts -join "; "

function Install-StartupLauncher {
  $startupDir = [Environment]::GetFolderPath("Startup")
  if ([string]::IsNullOrWhiteSpace($startupDir)) {
    throw "Could not find the Windows Startup folder for this user."
  }

  $baseName = Safe-FileName $TaskName
  $launcherPs1 = Join-Path $startupDir "$baseName.ps1"
  $launcherCmd = Join-Path $startupDir "$baseName.cmd"
  $launcherScript = @(
    '$ErrorActionPreference = "Stop"',
    '$env:INWELL_LOCAL_RUNNER_TOKEN = [Environment]::GetEnvironmentVariable("INWELL_LOCAL_RUNNER_TOKEN", "User")',
    "Set-Location -LiteralPath $(Quote-PowerShell $repoRoot.Path)",
    "npm.cmd run tumblr:runner:local -- --api-base $(Quote-PowerShell $ApiBase) --workspace-id $(Quote-PowerShell $WorkspaceId) --queue $(Quote-PowerShell $Queue) --user-data-dir $(Quote-PowerShell $UserDataDir) --watch --serve --companion-port $CompanionPort --no-pause --submit --interval-seconds $IntervalSeconds"
  ) -join [Environment]::NewLine
  $launcherBatch = @"
@echo off
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0$baseName.ps1"
"@

  Set-Content -LiteralPath $launcherPs1 -Value $launcherScript -Encoding UTF8
  Set-Content -LiteralPath $launcherCmd -Value $launcherBatch -Encoding ASCII
  Write-Host "Installed Startup folder launcher: $launcherCmd"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -Command $command"
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

param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBase,

  [Parameter(Mandatory = $true)]
  [string]$WorkspaceId,

  [string]$Queue = "Adverts",
  [string]$TaskName = "Inkwell Tumblr Local Runner",
  [string]$UserDataDir = ".tumblr-runner-profile-local",
  [int]$IntervalSeconds = 15,
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

$commandParts = @(
  "`$env:INWELL_LOCAL_RUNNER_TOKEN = [Environment]::GetEnvironmentVariable('INWELL_LOCAL_RUNNER_TOKEN', 'User')",
  "Set-Location $(Quote-PowerShell $repoRoot.Path)",
  "npm.cmd run tumblr:runner:local -- --api-base $(Quote-PowerShell $ApiBase) --workspace-id $(Quote-PowerShell $WorkspaceId) --queue $(Quote-PowerShell $Queue) --user-data-dir $(Quote-PowerShell $UserDataDir) --watch --no-pause --submit --interval-seconds $IntervalSeconds"
)
$command = $commandParts -join "; "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -Command $command"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 7) -MultipleInstances IgnoreNew
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Runs the Inkwell Tumblr local watcher at Windows login."

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Write-Host "Installed scheduled task: $TaskName"
Write-Host "Queue: $Queue"
Write-Host "API: $ApiBase"

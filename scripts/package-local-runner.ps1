param(
  [string]$OutputDir = "dist\local-runner",
  [string]$PackageName = "inkwell-local-runner"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$stagingRoot = Join-Path $repoRoot $OutputDir
$packageRoot = Join-Path $stagingRoot $PackageName
$zipPath = Join-Path $stagingRoot "$PackageName.zip"

if (Test-Path $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot "scripts") | Out-Null

Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\tumblr-local-runner.mjs") -Destination (Join-Path $packageRoot "scripts\tumblr-local-runner.mjs")
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\tumblr-runner.mjs") -Destination (Join-Path $packageRoot "scripts\tumblr-runner.mjs")
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\tumblr-runner-core.mjs") -Destination (Join-Path $packageRoot "scripts\tumblr-runner-core.mjs")
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\install-local-runner-autostart.ps1") -Destination (Join-Path $packageRoot "scripts\install-local-runner-autostart.ps1")

$packageJson = @{
  name = "inkwell-local-runner"
  version = "0.1.0"
  private = $true
  type = "module"
  scripts = @{
    "tumblr:install-browsers" = "playwright install chromium"
    "tumblr:runner:install-autostart" = "powershell -ExecutionPolicy Bypass -File scripts/install-local-runner-autostart.ps1"
    "tumblr:runner:local" = "node scripts/tumblr-local-runner.mjs"
    "tumblr:runner" = "node scripts/tumblr-runner.mjs"
  }
  dependencies = @{
    playwright = "^1.61.0"
  }
}
$packageJson | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $packageRoot "package.json") -Encoding UTF8

@'
# Inkwell Local Runner

This companion package runs Tumblr queue submissions from a Windows desktop browser session.

## First Run

1. Install Node.js 20 or newer.
2. Open PowerShell in this folder.
3. Run `npm install`.
4. Run `npm run tumblr:install-browsers`.
5. In Inkwell, open your queue and use `Copy setup command` to copy the private setup command.
6. Paste that command in this folder to install the Windows login task.

Use `Run locally` in Inkwell to copy a one-time command for an immediate run.
Keep copied commands private because they include a device token.
'@ | Set-Content -LiteralPath (Join-Path $packageRoot "README.md") -Encoding UTF8

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -Force

Write-Host "Packaged local runner:"
Write-Host $packageRoot
Write-Host $zipPath

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("local runner installer refreshes Discord webhook for immediate launcher start without printing the URL", () => {
  const installer = fs.readFileSync("scripts/install-local-runner-autostart.ps1", "utf8");

  assert.match(
    installer,
    /\$env:INWELL_DISCORD_WEBHOOK_URL = \[Environment\]::GetEnvironmentVariable\("INWELL_DISCORD_WEBHOOK_URL", "User"\)/,
  );
  assert.match(installer, /\[Environment\]::SetEnvironmentVariable\("INWELL_DISCORD_WEBHOOK_URL", \$DiscordWebhookUrl, "User"\)/);
  assert.match(installer, /Write-Host "Discord webhook: configured"/);
  assert.match(installer, /\[switch\]\$Headless/);
  assert.match(installer, /\$headlessArg = if \(\$Headless\) \{ " --headless" \}/);
  assert.doesNotMatch(installer, /Write-Host "\$DiscordWebhookUrl"/);
  assert.doesNotMatch(installer, /--discord-webhook-url/);
});

test("local runner package script includes all imported runtime modules", () => {
  const packageScript = fs.readFileSync("scripts/package-local-runner.ps1", "utf8");

  for (const scriptName of [
    "tumblr-local-runner.mjs",
    "discord-run-summary.mjs",
    "tumblr-login.mjs",
    "tumblr-runner.mjs",
    "tumblr-runner-core.mjs",
    "tumblr-runner-results.mjs",
    "install-local-runner-autostart.ps1",
  ]) {
    assert.match(packageScript, new RegExp(`"${scriptName.replace(".", "\\.")}"`));
  }
});

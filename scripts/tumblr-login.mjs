#!/usr/bin/env node
import { parseArgs } from "./tumblr-runner-core.mjs";
import { openChromeLogin } from "./tumblr-chrome.mjs";

async function main() {
  const options = parseArgs(["--plan", "manual-login-placeholder", ...process.argv.slice(2)]);
  await openChromeLogin(options.userDataDir);
  console.log("[login] Google Chrome is open with the saved Inkwell profile.");
  console.log("[login] Log into Tumblr manually, including any verification, and wait for the dashboard.");
  console.log("[login] Close all windows for this Inkwell profile before running the queue so Chrome can save and release the session.");
}

main().catch((error) => {
  console.error(`[login:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

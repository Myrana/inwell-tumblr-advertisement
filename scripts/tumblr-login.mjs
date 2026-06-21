#!/usr/bin/env node
import path from "node:path";
import { chromium } from "playwright";
import { parseArgs } from "./tumblr-runner-core.mjs";

async function main() {
  const options = parseArgs(["--plan", "manual-login-placeholder", ...process.argv.slice(2)]);
  const context = await chromium.launchPersistentContext(path.resolve(options.userDataDir), {
    headless: false,
    slowMo: options.slowMo,
  });

  const page = await context.newPage();
  await page.goto("https://www.tumblr.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("[login] A Playwright Chromium window is open.");
  console.log("[login] Log into Tumblr manually in that window, including any captcha or verification.");
  console.log("[login] Keep the dashboard open until it is stable.");

  if (process.stdin.isTTY) {
    console.log("[login] Press Enter here to close the helper.");
    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", resolve);
    });
  } else {
    console.log("[login] Close the browser window when login is complete.");
    await new Promise((resolve) => context.once("close", resolve));
  }

  await context.close();
}

main().catch((error) => {
  console.error(`[login:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

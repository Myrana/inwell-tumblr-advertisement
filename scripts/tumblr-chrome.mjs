import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function chromeExecutable({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const candidates = env.INWELL_CHROME_PATH ? [env.INWELL_CHROME_PATH] : platform === "win32"
    ? [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter(Boolean).map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
    : platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  const executable = candidates.find((candidate) => exists(candidate));
  if (!executable) {
    throw new Error("Google Chrome was not found. Install Chrome or set INWELL_CHROME_PATH to its executable, then open Tumblr login again.");
  }
  return executable;
}

export function chromeLoginArgs(userDataDir) {
  return [
    `--user-data-dir=${path.resolve(userDataDir)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "https://www.tumblr.com/login?redirect_to=%2Fdashboard",
  ];
}

export async function openChromeLogin(userDataDir) {
  const child = spawn(chromeExecutable(), chromeLoginArgs(userDataDir), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}

export function chromeRunnerOptions(options) {
  return {
    ...(process.env.INWELL_CHROME_PATH
      ? { executablePath: chromeExecutable() }
      : { channel: "chrome" }),
    headless: options.headless,
    slowMo: options.slowMo,
    viewport: { width: 1365, height: 1000 },
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { chromeExecutable, chromeLoginArgs, chromeRunnerOptions } from "../../scripts/tumblr-chrome.mjs";

test("Chrome discovery finds per-user Windows installs", () => {
  const executable = path.join("user apps", "Google", "Chrome", "Application", "chrome.exe");
  assert.equal(chromeExecutable({ platform: "win32", env: { PROGRAMFILES: "system apps", LOCALAPPDATA: "user apps" }, exists: (candidate) => candidate === executable }), executable);
});

test("Chrome discovery honors explicit paths and reports missing installs", () => {
  assert.equal(chromeExecutable({ env: { INWELL_CHROME_PATH: "custom chrome" }, exists: () => true }), "custom chrome");
  assert.throws(() => chromeExecutable({ env: { INWELL_CHROME_PATH: "missing" }, exists: () => false }), /Install Chrome or set INWELL_CHROME_PATH/);
});

test("native login uses the same resolved profile without automation or debugging switches", () => {
  const args = chromeLoginArgs("profile with spaces");
  assert.equal(args[0], `--user-data-dir=${path.resolve("profile with spaces")}`);
  assert.ok(args.includes("https://www.tumblr.com/login?redirect_to=%2Fdashboard"));
  assert.ok(args.every((arg) => !/remote-debugging|enable-automation|disable-blink/.test(arg)));
});

test("queue runner selects installed Chrome and preserves execution settings", () => {
  const saved = process.env.INWELL_CHROME_PATH;
  delete process.env.INWELL_CHROME_PATH;
  try {
    const options = chromeRunnerOptions({ headless: true, slowMo: 250 });
    assert.equal(options.channel, "chrome");
    assert.equal(options.headless, true);
    assert.equal(options.slowMo, 250);
  } finally {
    if (saved !== undefined) process.env.INWELL_CHROME_PATH = saved;
  }
});

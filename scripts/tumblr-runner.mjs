#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  fieldsForItem,
  loadRunnerPlan,
  materializeDataUrl,
  parseArgs,
  shouldPauseForManualAction,
} from "./tumblr-runner-core.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = await loadRunnerPlan(options.planPath);
  await fs.mkdir(options.userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless,
    slowMo: options.slowMo,
  });

  try {
    for (const item of plan.items) {
      await runQueueItem(context, item, options);
    }
  } finally {
    await context.close();
  }
}

async function runQueueItem(context, item, options) {
  const page = await context.newPage();
  const fields = fieldsForItem(item);
  console.log(`\n[runner] Opening ${item.targetName}: ${item.submitUrl}`);
  await page.goto(item.submitUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  if (await pageNeedsManualAction(page)) {
    console.log(`[manual-action] ${item.targetName}: login, captcha, terms, or changed form detected.`);
    await pauseForOperator(page);
    return;
  }

  await choosePostType(page, item.postType);
  await fillTextFields(page, fields);
  await uploadMedia(page, item, fields);

  if (await pageNeedsManualAction(page)) {
    console.log(`[manual-action] ${item.targetName}: page requires review before submit.`);
    await pauseForOperator(page);
    return;
  }

  if (options.submit) {
    const clicked = await clickSubmit(page);
    console.log(clicked ? `[submitted] ${item.targetName}: submit button clicked.` : `[manual-action] ${item.targetName}: no submit button found.`);
  } else {
    console.log(`[ready] ${item.targetName}: fields filled where possible. Review the page, then submit manually or rerun with --submit.`);
    await pauseForOperator(page);
  }
}

async function pageNeedsManualAction(page) {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return shouldPauseForManualAction(text, page.url());
}

async function choosePostType(page, postType) {
  const label = postType === "text" ? /text/i : postType === "video" ? /video/i : /photo|image/i;
  for (const role of ["button", "link", "tab"]) {
    const control = page.getByRole(role, { name: label }).first();
    if (await control.isVisible({ timeout: 1000 }).catch(() => false)) {
      await control.click().catch(() => undefined);
      return;
    }
  }
}

async function fillTextFields(page, fields) {
  const text = fields.caption || fields.body || fields.packageText;
  if (!text.trim()) {
    return;
  }

  const textboxes = page.locator("textarea, [contenteditable='true'], input[type='text']");
  const count = await textboxes.count();
  for (let index = 0; index < count; index += 1) {
    const box = textboxes.nth(index);
    if (!(await box.isVisible().catch(() => false))) {
      continue;
    }

    const tagName = await box.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    if (tagName === "input") {
      const label = await accessibleContext(box);
      if (/tag/i.test(label) && fields.tags.length) {
        await box.fill(fields.tags.join(", ")).catch(() => undefined);
        continue;
      }
    }

    await box.fill(text).catch(async () => {
      await box.click().catch(() => undefined);
      await box.pressSequentially(text, { delay: 1 }).catch(() => undefined);
    });
    return;
  }
}

async function accessibleContext(locator) {
  return locator
    .evaluate((node) => {
      const input = node;
      const label = input.getAttribute("aria-label") || input.getAttribute("placeholder") || input.getAttribute("name") || "";
      return label;
    })
    .catch(() => "");
}

async function uploadMedia(page, item, fields) {
  if (item.postType === "video" && fields.videoUrl.trim()) {
    await fillFirstMatchingInput(page, /video|url|link/i, fields.videoUrl);
  }

  if (!fields.imageDataUrl) {
    return;
  }

  const uploadPath = await materializeDataUrl(fields.imageDataUrl, fields.imageName, path.join(os.tmpdir(), "inwell-tumblr-runner"));
  if (!uploadPath) {
    console.log(`[manual-action] ${item.targetName}: image is not embedded in the plan; upload it manually.`);
    return;
  }

  const fileInput = page.locator("input[type='file']").first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(uploadPath).catch(() => undefined);
  } else {
    console.log(`[manual-action] ${item.targetName}: no visible file input found; upload ${uploadPath} manually.`);
  }
}

async function fillFirstMatchingInput(page, pattern, value) {
  const inputs = page.locator("input, textarea");
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const context = await accessibleContext(input);
    if (pattern.test(context)) {
      await input.fill(value).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function clickSubmit(page) {
  for (const name of [/submit/i, /send/i, /post/i]) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click();
      return true;
    }
  }
  return false;
}

async function pauseForOperator(page) {
  console.log("[runner] Browser remains open for review. Press Enter here to continue.");
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });
  await page.close().catch(() => undefined);
}

main().catch((error) => {
  console.error(`[runner:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

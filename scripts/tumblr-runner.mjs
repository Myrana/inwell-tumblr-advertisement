#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  appearsLoggedInToTumblr,
  frameCandidateScore,
  fieldsForItem,
  loadRunnerPlan,
  materializeDataUrl,
  parseArgs,
  postTypeCandidateIndex,
  reviewPagesOpenMessage,
  shouldDeferReadyReview,
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
    if (options.loginFirst) {
      await waitForTumblrLogin(context, options);
    }

    const reviewPages = [];
    for (const item of plan.items) {
      const result = await runQueueItem(context, item, options);
      if (result?.readyForReview && result.page) {
        reviewPages.push(result.page);
      }
    }

    if (reviewPages.length > 0) {
      await waitForQueueReviewPages(options, reviewPages);
    }
  } finally {
    await context.close();
  }
}

async function waitForTumblrLogin(context, options) {
  const page = await context.newPage();
  console.log("[login] Opening Tumblr in this runner browser session.");
  await page.goto("https://www.tumblr.com/login?redirect_to=%2Fdashboard", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  if (await tumblrSessionReady(page)) {
    console.log("[login] Tumblr session is already active; continuing without an Enter prompt.");
    await page.close().catch(() => undefined);
    return;
  }

  if (options.headless || options.noPause) {
    console.log("[login] Noninteractive mode: continuing without waiting for manual login.");
    await page.close().catch(() => undefined);
    return;
  }

  console.log("[login] Log into Tumblr in the browser, wait for the dashboard to settle, then press Enter here.");
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });
  await page.close().catch(() => undefined);
}

async function tumblrSessionReady(page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const frame of page.frames()) {
      const text = await frame.locator("body").innerText({ timeout: 2000 }).catch(() => "");
      if (appearsLoggedInToTumblr(text, frame.url())) {
        return true;
      }
    }

    await page.waitForTimeout(500).catch(() => undefined);
  }

  return false;
}

async function runQueueItem(context, item, options) {
  const page = await context.newPage();
  const fields = fieldsForItem(item);
  console.log(`\n[runner] Opening ${item.targetName}: ${item.submitUrl}`);
  await page.goto(item.submitUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await waitForSubmitForm(page, item);

  if (await pageNeedsManualAction(page)) {
    console.log(`[manual-action] ${item.targetName}: login, captcha, terms, or changed form detected.`);
    await pauseForOperator(page, options);
    return { readyForReview: false };
  }

  await logFrameDiagnostics(page);
  const target = await automationTarget(page);
  console.log(`[runner] Automation target: ${target.url() || "top page"}`);
  const postTypeSelected = await choosePostType(page, item.postType);
  if (!postTypeSelected) {
    const operatorSelected = await waitForOperatorPostTypeSelection(page, item, options);
    if (!operatorSelected) {
      console.log(`[manual-action] ${item.targetName}: could not switch post type to ${item.postType}; stopping before fill.`);
      await pauseForOperator(page, options);
      return { readyForReview: false };
    }
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  await fillTitle(page, fields);
  const textFilled = await fillTextFields(page, fields);
  const tagsFilled = await fillTags(page, fields.tags);
  const mediaUploaded = await uploadMedia(page, item, fields, options);
  const termsAccepted = await acceptTerms(page);
  console.log(
    `[runner] Fill summary: text=${textFilled ? "filled" : "not found"}, tags=${tagsFilled ? "filled" : "not found"}, media=${mediaUploaded ? "uploaded" : "not uploaded"}, terms=${termsAccepted ? "accepted" : "not found"}.`,
  );

  if (await pageNeedsManualAction(page)) {
    console.log(`[manual-action] ${item.targetName}: page requires review before submit.`);
    if (shouldDeferReadyReview(options)) {
      return { readyForReview: true, page };
    }

    await pauseForOperator(page, options);
    return { readyForReview: false };
  }

  if (options.submit) {
    const clicked = await clickSubmit(target);
    console.log(clicked ? `[submitted] ${item.targetName}: submit button clicked.` : `[manual-action] ${item.targetName}: no submit button found.`);
  } else {
    console.log(`[ready] ${item.targetName}: fields filled where possible. Review the page, then submit manually or rerun with --submit.`);
    if (shouldDeferReadyReview(options)) {
      return { readyForReview: true, page };
    }

    await pauseForOperator(page, options);
  }

  return { readyForReview: false };
}

async function pageNeedsManualAction(page) {
  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (shouldPauseForManualAction(text, frame.url())) {
      return true;
    }
  }

  return false;
}

async function automationTarget(page) {
  const candidates = [];
  for (const frame of page.frames()) {
    const controlCount = await frame.locator("input, textarea, button, [contenteditable='true']").count().catch(() => 0);
    candidates.push({
      frame,
      score: frameCandidateScore({
        name: frame.name(),
        url: frame.url(),
        controlCount,
      }),
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.frame ?? page;
}

async function waitForSubmitForm(page, item) {
  const directSubmitUrl = `https://www.tumblr.com/submit_form/${new URL(item.submitUrl).hostname}`;
  const ready = await waitForFormControls(page, 15000);
  if (ready) {
    return true;
  }

  console.log(`[runner] Public submit page did not expose the form yet; opening ${directSubmitUrl}`);
  await page.goto(directSubmitUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  return waitForFormControls(page, 15000);
}

async function waitForFormControls(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const result = await frame
        .evaluate(() => {
          const bodyText = document.body?.innerText || "";
          const controls = document.querySelectorAll("select, input, textarea, button, [contenteditable='true'], [role='textbox']").length;
          return {
            controls,
            readyText: /Text|Photo|Video|Tags|Submit|Upload image/i.test(bodyText),
          };
        })
        .catch(() => ({ controls: 0, readyText: false }));

      if (result.controls >= 5 || result.readyText) {
        console.log(`[runner] Submit form ready with ${result.controls} controls in ${frame.url() || "about:blank"}.`);
        return true;
      }
    }

    await page.waitForTimeout(500).catch(() => undefined);
  }

  console.log("[manual-action] Timed out waiting for Tumblr submit form controls.");
  return false;
}

async function pageTargets(page) {
  const targets = [];
  for (const frame of page.frames()) {
    const controlCount = await frame.locator("input, textarea, button, [contenteditable='true'], [role='textbox']").count().catch(() => 0);
    targets.push({
      frame,
      score: frameCandidateScore({
        name: frame.name(),
        url: frame.url(),
        controlCount,
      }),
    });
  }
  targets.sort((left, right) => right.score - left.score);
  return targets.map((target) => target.frame);
}

async function logFrameDiagnostics(page) {
  for (const frame of page.frames()) {
    const controls = await frame
      .locator("input, textarea, button, [contenteditable='true'], [role='textbox']")
      .count()
      .catch(() => 0);
    console.log(`[runner] Frame controls: ${controls} at ${frame.url() || "about:blank"}`);
  }
}

async function choosePostType(page, postType) {
  const optionValue = postType === "text" ? "text" : postType === "video" ? "video" : "photo";

  for (const target of await pageTargets(page)) {
    const selects = target.locator("select");
    const count = await selects.count();
    for (let index = 0; index < count; index += 1) {
      const select = selects.nth(index);
      if (!(await select.isVisible().catch(() => false))) {
        continue;
      }

      const selected = await selectPostTypeOption(select, optionValue);
      if (selected && (await postTypeSelected(page, optionValue))) {
        console.log(`[runner] Selected ${optionValue} post type from dropdown.`);
        return true;
      }
    }
  }

  const clicked = await choosePostTypeFromClassicDropdown(page, optionValue);
  if (clicked) {
    console.log(`[runner] Selected ${optionValue} post type from classic dropdown.`);
    return true;
  }

  const keyboardSelected = await choosePostTypeWithKeyboard(page, optionValue);
  if (keyboardSelected) {
    console.log(`[runner] Selected ${optionValue} post type with keyboard fallback.`);
    return true;
  }

  const domSelected = await choosePostTypeWithDomClick(page, optionValue);
  if (domSelected) {
    console.log(`[runner] Selected ${optionValue} post type with DOM click fallback.`);
    return true;
  }

  const customSelected = await choosePostTypeFromTumblrOptions(page, optionValue);
  if (customSelected) {
    console.log(`[runner] Selected ${optionValue} post type from Tumblr option markup.`);
    return true;
  }

  const coordinateSelected = await choosePostTypeByCoordinates(page, optionValue);
  if (coordinateSelected) {
    console.log(`[runner] Selected ${optionValue} post type with coordinate fallback.`);
    return true;
  }

  await logPostTypeDiagnostics(page);
  console.log(`[manual-action] Could not find a ${optionValue} post type control.`);
  return false;
}

async function waitForOperatorPostTypeSelection(page, item, options) {
  if (options.headless || options.noPause) {
    return false;
  }

  const optionValue = item.postType === "text" ? "text" : item.postType === "video" ? "video" : "photo";
  console.log(`[manual-action] Select ${optionValue} in the Tumblr post type dropdown. The runner will continue automatically.`);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await postTypeSelected(page, optionValue)) {
      return true;
    }

    await page.waitForTimeout(500).catch(() => undefined);
  }

  const selected = await postTypeSelected(page, optionValue);
  if (!selected) {
    console.log(`[manual-action] Tumblr still does not report ${optionValue} as selected.`);
  }
  return selected;
}

async function choosePostTypeFromClassicDropdown(page, optionValue) {
  for (const target of await pageTargets(page)) {
    const selectedFromSelect = await choosePostTypeFromToggles(page, target.locator("select"), target, optionValue);
    if (selectedFromSelect) {
      return true;
    }

    const selectedFromText = await choosePostTypeFromToggles(
      page,
      target.getByText(/^(Text|Photo|Video)$/),
      target,
      optionValue,
    );
    if (selectedFromText) {
      return true;
    }
  }

  return false;
}

async function choosePostTypeFromToggles(page, toggles, target, optionValue) {
  const count = await toggles.count();
  for (let index = 0; index < count; index += 1) {
    const toggle = toggles.nth(index);
    if (!(await toggle.isVisible().catch(() => false))) {
      continue;
    }

    await toggle.click().catch(() => undefined);
    await page.waitForTimeout(500).catch(() => undefined);
    const option = target.getByText(new RegExp(`^${optionValue}$`, "i")).last();
    if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
      await option.click().catch(() => undefined);
      await page.waitForTimeout(1000).catch(() => undefined);
      return postTypeSelected(page, optionValue);
    }
  }

  return false;
}

async function choosePostTypeWithKeyboard(page, optionValue) {
  for (const target of await pageTargets(page)) {
    const selectedFromSelect = await choosePostTypeWithKeyboardFromToggles(page, target.locator("select"), optionValue);
    if (selectedFromSelect) {
      return true;
    }

    const selectedFromText = await choosePostTypeWithKeyboardFromToggles(
      page,
      target.getByText(/^(Text|Photo|Video)$/),
      optionValue,
    );
    if (selectedFromText) {
      return true;
    }
  }

  return false;
}

async function choosePostTypeWithKeyboardFromToggles(page, toggles, optionValue) {
  const count = await toggles.count();
  for (let index = 0; index < count; index += 1) {
    const toggle = toggles.nth(index);
    if (!(await toggle.isVisible().catch(() => false))) {
      continue;
    }

    await toggle.click().catch(() => undefined);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (await postTypeSelected(page, optionValue)) {
        return true;
      }
      await page.keyboard.press("ArrowDown").catch(() => undefined);
      await page.keyboard.press("Enter").catch(() => undefined);
      await page.waitForTimeout(1000).catch(() => undefined);
    }
  }

  return false;
}

async function choosePostTypeWithDomClick(page, optionValue) {
  for (const target of await pageTargets(page)) {
    const opened = await clickElementByExactText(target, /^(Text|Photo|Video)$/i);
    if (!opened) {
      continue;
    }

    await page.waitForTimeout(700).catch(() => undefined);
    const selected = await clickElementByExactText(target, new RegExp(`^${optionValue}$`, "i"));
    if (!selected) {
      continue;
    }

    await page.waitForTimeout(1000).catch(() => undefined);
    if (await postTypeSelected(page, optionValue)) {
      return true;
    }
  }

  return false;
}

async function clickElementByExactText(target, pattern) {
  return target
    .evaluate((patternSource) => {
      const pattern = new RegExp(patternSource, "i");
      const elements = Array.from(document.querySelectorAll("button, a, div, span, li, option, select"));
      const element = elements.find((node) => {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        const rect = node.getBoundingClientRect();
        return pattern.test(text) && rect.width > 0 && rect.height > 0;
      });

      if (!element) {
        return false;
      }

      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }, pattern.source)
    .catch(() => false);
}

async function choosePostTypeFromTumblrOptions(page, optionValue) {
  for (const target of await pageTargets(page)) {
    const selectedFromVisibleOption = await choosePostTypeFromVisibleTumblrOption(page, target, optionValue);
    if (selectedFromVisibleOption) {
      return true;
    }

    const clicked = await target
      .evaluate((value) => {
        const textMatches = (node) => (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === value;
        const currentToggle = Array.from(document.querySelectorAll(".txt, .selected, [class*='select']"))
          .find((node) => /^(text|photo|video)$/i.test((node.textContent || "").trim()));

        if (currentToggle) {
          currentToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          currentToggle.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          currentToggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        }

        const option = Array.from(document.querySelectorAll(".option, li, div, span"))
          .find((node) => textMatches(node) && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
        if (!option) {
          return false;
        }

        option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      }, optionValue)
      .catch(() => false);

    if (clicked) {
      await page.waitForTimeout(1000).catch(() => undefined);
      if (await postTypeSelected(page, optionValue)) {
        return true;
      }
    }
  }

  return false;
}

async function choosePostTypeFromVisibleTumblrOption(page, target, optionValue) {
  const opened = await clickElementByExactText(target, /^(Text|Photo|Video)$/i);
  if (!opened) {
    return false;
  }

  await page.waitForTimeout(500).catch(() => undefined);
  const candidates = await target
    .evaluate(() =>
      Array.from(document.querySelectorAll(".option, li, [role='option'], button, a, div, span")).map((node) => {
        const rect = node.getBoundingClientRect();
        const className = typeof node.className === "string" ? node.className : "";
        return {
          className,
          selected: /\bselected\b/i.test(className) || node.getAttribute("aria-selected") === "true",
          text: (node.textContent || "").replace(/\s+/g, " ").trim(),
          visible: rect.width > 0 && rect.height > 0,
        };
      }),
    )
    .catch(() => []);

  const candidateIndex = postTypeCandidateIndex(candidates, optionValue);
  if (candidateIndex < 0) {
    return false;
  }

  const clicked = await target
    .evaluate((index) => {
      const nodes = Array.from(document.querySelectorAll(".option, li, [role='option'], button, a, div, span"));
      const node = nodes[index];
      if (!node) {
        return false;
      }

      const clickTarget = node.closest(".option, li, [role='option'], button, a") || node;
      const eventOptions = { bubbles: true, cancelable: true, view: window };
      clickTarget.dispatchEvent(new PointerEvent("pointerdown", eventOptions));
      clickTarget.dispatchEvent(new MouseEvent("mousedown", eventOptions));
      clickTarget.dispatchEvent(new PointerEvent("pointerup", eventOptions));
      clickTarget.dispatchEvent(new MouseEvent("mouseup", eventOptions));
      clickTarget.dispatchEvent(new MouseEvent("click", eventOptions));
      return true;
    }, candidateIndex)
    .catch(() => false);

  if (!clicked) {
    return false;
  }

  await page.waitForTimeout(1000).catch(() => undefined);
  return postTypeSelected(page, optionValue);
}

async function choosePostTypeByCoordinates(page, optionValue) {
  if (optionValue !== "photo") {
    return false;
  }

  for (const target of await pageTargets(page)) {
    const toggles = target.getByText(/^(Text|Photo|Video)$/).filter({ hasText: /^Text$/ });
    const count = await toggles.count();
    for (let index = 0; index < count; index += 1) {
      const toggle = toggles.nth(index);
      if (!(await toggle.isVisible().catch(() => false))) {
        continue;
      }

      const box = await toggle.boundingBox().catch(() => null);
      if (!box) {
        continue;
      }

      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => undefined);
      await page.waitForTimeout(500).catch(() => undefined);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height + 28).catch(() => undefined);
      await page.waitForTimeout(1000).catch(() => undefined);

      if (await postTypeSelected(page, optionValue)) {
        return true;
      }
    }
  }

  return false;
}

async function postTypeSelected(page, optionValue) {
  for (const target of await pageTargets(page)) {
    const selectedText = await target
      .evaluate(() => {
        const select = document.querySelector("select");
        if (select) {
          return select.options[select.selectedIndex]?.textContent || select.value || "";
        }

        const selectedOption = document.querySelector(".option.selected");
        if (selectedOption?.textContent) {
          return selectedOption.textContent;
        }

        const currentText = document.querySelector(".txt");
        if (currentText?.textContent) {
          return currentText.textContent;
        }

        const topText = Array.from(document.querySelectorAll("select, option, button, a, div, span, li"))
          .slice(0, 80)
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
          .find((text) => /^(Text|Photo|Video)$/i.test(text));
        return topText || "";
      })
      .catch(() => "");

    if (selectedText.trim().toLowerCase() === optionValue) {
      return true;
    }
  }

  return false;
}

async function logPostTypeDiagnostics(page) {
  console.log("[diagnostic] Post type controls visible to runner:");
  for (const frame of page.frames()) {
    const diagnostics = await frame
      .evaluate(() => {
        const selectSummaries = Array.from(document.querySelectorAll("select")).map((select, index) => ({
          index,
          name: select.getAttribute("name") || "",
          id: select.getAttribute("id") || "",
          value: select.value || "",
          text: select.options[select.selectedIndex]?.textContent?.trim() || "",
          options: Array.from(select.options).map((option) => ({
            value: option.value,
            text: option.textContent?.trim() || "",
          })),
        }));

        const exactTypeText = Array.from(document.querySelectorAll("button, a, div, span, li, option, select"))
          .map((node) => ({
            tag: node.tagName.toLowerCase(),
            text: (node.textContent || "").replace(/\s+/g, " ").trim(),
            className: typeof node.className === "string" ? node.className : "",
          }))
          .filter((node) => /^(Text|Photo|Video|Image)$/i.test(node.text))
          .slice(0, 20);

        return {
          url: location.href,
          title: document.title,
          selectSummaries,
          exactTypeText,
          bodySample: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500),
        };
      })
      .catch((error) => ({ url: frame.url(), error: error.message }));

    console.log(JSON.stringify(diagnostics, null, 2));
  }
}

async function selectPostTypeOption(select, optionValue) {
  return select
    .evaluate(
      (node, args) => {
        const selectNode = node;
        const options = Array.from(selectNode.options);
        const option = options.find((item) => {
          const text = (item.textContent || "").toLowerCase();
          return item.value.toLowerCase() === args.optionValue || text.includes(args.optionValue);
        });
        if (!option) {
          return false;
        }

        selectNode.value = option.value;
        selectNode.dispatchEvent(new Event("input", { bubbles: true }));
        selectNode.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      { optionValue },
    )
    .catch(() => false);
}

async function fillTextFields(page, fields) {
  const text = fields.caption || fields.body || fields.packageText;
  if (!text.trim()) {
    return false;
  }

  if (await fillRichTextFrame(page, fields.bodyHtml || text, Boolean(fields.bodyHtml))) {
    return true;
  }

  for (const target of await pageTargets(page)) {
    const textboxes = target.locator("textarea, [contenteditable='true'], [role='textbox'], input[type='text']");
    const count = await textboxes.count();
    for (let index = 0; index < count; index += 1) {
      const box = textboxes.nth(index);
      if (!(await box.isVisible().catch(() => false))) {
        continue;
      }

      const label = await accessibleContext(box);
      if (/title|tag|search|email|password|login|description|optional|insert|url|link/i.test(label)) {
        continue;
      }

      const filled = await fillEditable(box, text);
      if (filled) {
        console.log(`[runner] Filled text field in ${target.url() || "top page"}.`);
        return true;
      }
    }
  }

  console.log("[manual-action] No visible caption/body field was found.");
  return false;
}

async function fillRichTextFrame(page, value, isHtml = false) {
  for (const frame of page.frames()) {
    const filled = await frame
      .evaluate(({ value, isHtml }) => {
        const body = document.body;
        const editable =
          document.querySelector("[contenteditable='true']") ||
          (document.designMode === "on" ? body : null) ||
          (body?.id === "tinymce" ? body : null) ||
          (body?.className && String(body.className).toLowerCase().includes("tinymce") ? body : null);

        if (!editable) {
          return false;
        }

        editable.focus();
        if (isHtml) {
          editable.innerHTML = value;
        } else {
          editable.textContent = value;
        }
        editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: isHtml ? editable.textContent : value }));
        editable.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, { value, isHtml })
      .catch(() => false);

    if (filled) {
      console.log(`[runner] Filled rich text editor in ${frame.url() || "editor frame"}.`);
      return true;
    }
  }

  return false;
}

async function fillTitle(page, fields) {
  if (!fields.title.trim()) {
    return false;
  }

  for (const target of await pageTargets(page)) {
    const titleFields = target.locator("input[type='text'], textarea, [role='textbox']");
    const count = await titleFields.count();
    for (let index = 0; index < count; index += 1) {
      const field = titleFields.nth(index);
      if (!(await field.isVisible().catch(() => false))) {
        continue;
      }

      const context = await accessibleContext(field);
      if (!/title/i.test(context)) {
        continue;
      }

      const filled = await fillEditable(field, fields.title);
      if (filled) {
        console.log("[runner] Filled title field.");
        return true;
      }
    }
  }

  return false;
}

async function fillEditable(locator, value) {
  const filled = await locator.fill(value).then(() => true).catch(() => false);
  if (filled) {
    return true;
  }

  await locator.click().catch(() => undefined);
  const selected = await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A").then(() => true).catch(() => false);
  if (selected) {
    await locator.press("Backspace").catch(() => undefined);
  }
  return locator.pressSequentially(value, { delay: 1 }).then(() => true).catch(() => false);
}

async function fillTags(page, tags) {
  if (!tags.length) {
    return false;
  }

  for (const target of await pageTargets(page)) {
    let checkedAny = false;
    const checkboxes = target.locator("input[type='checkbox']");
    const checkboxCount = await checkboxes.count();
    for (let index = 0; index < checkboxCount; index += 1) {
      const checkbox = checkboxes.nth(index);
      const labelText = await checkboxLabelText(checkbox);
      if (!tags.some((tag) => sameTag(tag, labelText))) {
        continue;
      }

      const checked = await checkbox.check().then(() => true).catch(() => false);
      checkedAny = checkedAny || checked;
      if (checked) {
        console.log(`[runner] Checked tag: ${labelText}`);
      }
    }

    if (checkedAny) {
      return true;
    }

    const inputs = target.locator("input, textarea, [contenteditable='true'], [role='textbox']");
    const count = await inputs.count();
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      if (!(await input.isVisible().catch(() => false))) {
        continue;
      }

      const context = await accessibleContext(input);
      if (!/tag/i.test(context)) {
        continue;
      }

      const tagText = tags.join(", ");
      const filled = await fillEditable(input, tagText);
      if (filled) {
        console.log(`[runner] Filled tags in ${target.url() || "top page"}.`);
        return true;
      }
    }
  }

  console.log("[manual-action] No visible tag field was found.");
  return false;
}

async function acceptTerms(page) {
  for (const target of await pageTargets(page)) {
    const checkboxes = target.locator("input[type='checkbox']");
    const count = await checkboxes.count();
    for (let index = 0; index < count; index += 1) {
      const checkbox = checkboxes.nth(index);
      const labelText = await checkboxLabelText(checkbox);
      if (!/accept.*terms|terms of submission/i.test(labelText)) {
        continue;
      }

      const checked = await checkbox.check().then(() => true).catch(() => false);
      if (checked) {
        console.log("[runner] Accepted terms checkbox.");
        return true;
      }
    }
  }

  return false;
}

async function checkboxLabelText(locator) {
  return locator
    .evaluate((node) => {
      const input = node;
      const ownId = input.getAttribute("id");
      const explicit = ownId ? document.querySelector(`label[for="${CSS.escape(ownId)}"]`) : null;
      const wrapped = input.closest("label");
      return (explicit?.textContent || wrapped?.textContent || input.parentElement?.textContent || "").replace(/\s+/g, " ").trim();
    })
    .catch(() => "");
}

function sameTag(left, right) {
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalize(left) === normalize(right);
}

async function accessibleContext(locator) {
  return locator
    .evaluate((node) => {
      const input = node;
      const label =
        input.getAttribute("aria-label") ||
        input.getAttribute("placeholder") ||
        input.getAttribute("name") ||
        input.getAttribute("data-testid") ||
        input.textContent ||
        "";
      return label;
    })
    .catch(() => "");
}

async function uploadMedia(page, item, fields, options) {
  if (item.postType === "video" && fields.videoUrl.trim()) {
    await fillFirstMatchingInput(page, /video|url|link/i, fields.videoUrl);
  }

  const uploadPath = await resolveUploadPath(fields, options);
  if (!uploadPath) {
    console.log(
      `[manual-action] ${item.targetName}: image data is not embedded and ${fields.imageName} was not found; upload it manually or pass --media-dir.`,
    );
    return false;
  }

  for (const target of await pageTargets(page)) {
    const fileInput = target.locator("input[type='file']").first();
    if (await fileInput.count()) {
      const uploaded = await fileInput.setInputFiles(uploadPath).then(() => true).catch(() => false);
      if (uploaded) {
        console.log(`[runner] Uploaded media ${uploadPath}.`);
        return true;
      }
    }
  }

  console.log(`[manual-action] ${item.targetName}: no file input accepted ${uploadPath}; upload it manually.`);
  return false;
}

async function resolveUploadPath(fields, options) {
  if (fields.imageDataUrl) {
    return materializeDataUrl(fields.imageDataUrl, fields.imageName, path.join(os.tmpdir(), "inwell-tumblr-runner"));
  }

  if (!fields.imageName || !options.mediaDir) {
    return null;
  }

  const localPath = path.resolve(options.mediaDir, fields.imageName);
  return existsSync(localPath) ? localPath : null;
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

async function pauseForOperator(page, options) {
  if (options.headless || options.noPause) {
    await page.close().catch(() => undefined);
    return;
  }

  console.log("[runner] Browser remains open for review. Press Enter here to continue.");
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });
  await page.close().catch(() => undefined);
}

async function waitForQueueReviewPages(options, reviewPages) {
  if (options.headless || options.noPause) {
    await Promise.all(reviewPages.map((page) => page.close().catch(() => undefined)));
    return;
  }

  console.log(reviewPagesOpenMessage(reviewPages.length));
  while (reviewPages.some((page) => !page.isClosed())) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main().catch((error) => {
  console.error(`[runner:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

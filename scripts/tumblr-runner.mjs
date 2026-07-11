#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  appearsLoggedInToTumblr,
  appearsRateLimitedByTumblr,
  frameCandidateScore,
  fieldsForItem,
  fillPhotoClickThroughUrl,
  fillRichTextEditorInDocument,
  headlessBlockerCodes,
  headlessBlockerCodeForReason,
  headlessBlockerMessage,
  headlessLoginRequiredMessage,
  isReusableRemotePage,
  loginWaitMessage,
  loadRunnerPlan,
  manualActionReason,
  materializeDataUrl,
  parseArgs,
  postTypeCandidateIndex,
  reviewPagesOpenMessage,
  shouldDeferReadyReview,
  tumblrPostSelectOptionSelector,
} from "./tumblr-runner-core.mjs";
import { collectRunnerTargetResults, writeRunnerResult } from "./tumblr-runner-results.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let targetResults = [];
  try {
    const plan = await loadRunnerPlan(options.planPath);
    const runnerBrowser = await openRunnerBrowser(options);

    try {
      if (options.loginFirst) {
        await waitForTumblrLogin(runnerBrowser.context, options);
      }

      const runResults = await collectRunnerTargetResults(
        plan.items,
        (item) => runQueueItem(runnerBrowser.context, item, options),
        async (item, error, message) => {
          console.log(`[runner:error] ${item.targetName}: ${message}`);
          await reportRunnerEvent(options, item, "failed", `Runner failed: ${message}`, "error", { error: message });
        },
      );
      targetResults = runResults.targetResults;
      const { reviewPages, failureCount } = runResults;

      if (reviewPages.length > 0) {
        await waitForQueueReviewPages(options, reviewPages);
      }
      if (options.headless && failureCount > 0) {
        throw new Error(runResults.firstFailureMessage || `Headless runner failed for ${failureCount} queue item${failureCount === 1 ? "" : "s"}.`);
      }
    } finally {
      await runnerBrowser.close();
    }

    await writeRunnerResult(options, { status: "success", blockerCode: "", failureKind: "", message: "", targetResults });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeRunnerResult(options, {
      status: "error",
      blockerCode: options.headless ? runnerResultBlockerCode(message) : "",
      failureKind: options.headless ? "headless_blocker" : "runner_error",
      message,
      targetResults,
    });
    throw error;
  }
}

function runnerResultBlockerCode(message) {
  const knownCode = Object.values(headlessBlockerCodes).find((code) => String(message || "").includes(code));
  return knownCode || headlessBlockerCodes.runnerFailed;
}

async function openRunnerBrowser(options) {
  if (options.remoteCdpUrl) {
    console.log("[runner] Connecting to remote browser session.");
    if (options.remoteLiveUrl) {
      console.log(`[runner] Remote browser live view: ${options.remoteLiveUrl}`);
    }
    const browser = await chromium.connectOverCDP(options.remoteCdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    return {
      context,
      close: async () => {
        await browser.close().catch(() => undefined);
      },
    };
  }

  await fs.mkdir(options.userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless,
    slowMo: options.slowMo,
    viewport: { width: 1365, height: 1000 },
  });
  return {
    context,
    close: async () => {
      await context.close().catch(() => undefined);
    },
  };
}

async function waitForTumblrLogin(context, options) {
  const page = await runnerPage(context, options);
  console.log("[login] Opening Tumblr in this runner browser session.");
  await page.goto("https://www.tumblr.com/login?redirect_to=%2Fdashboard", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  if (await tumblrSessionReady(page)) {
    console.log("[login] Tumblr session is already active; continuing without an Enter prompt.");
    if (!options.remoteCdpUrl) {
      await page.close().catch(() => undefined);
    }
    return;
  }

  if (options.headless) {
    const message = headlessLoginRequiredMessage();
    console.log(`[runner:error] ${message}`);
    if (!options.remoteCdpUrl) {
      await page.close().catch(() => undefined);
    }
    throw new Error(message);
  }

  if (options.noPause) {
    console.log("[login] Noninteractive mode: continuing without waiting for manual login.");
    if (!options.remoteCdpUrl) {
      await page.close().catch(() => undefined);
    }
    return;
  }

  console.log(loginWaitMessage(300));
  const ready = await waitForTumblrSession(page, 300000);
  if (!ready) {
    console.log("[login] Tumblr session was not detected before the timeout; continuing to the queue for review.");
  }
  if (!options.remoteCdpUrl) {
    await page.close().catch(() => undefined);
  }
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

async function waitForTumblrSession(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tumblrSessionReady(page)) {
      return true;
    }

    await page.waitForTimeout(1000).catch(() => undefined);
  }

  return false;
}

async function runQueueItem(context, item, options) {
  const page = await runnerPage(context, options);
  const fields = fieldsForItem(item);
  console.log(`\n[runner] Opening ${item.targetName}: ${item.submitUrl}`);
  await reportRunnerEvent(options, item, "running", `Opening ${item.targetName}.`, "info", { submitUrl: item.submitUrl });
  await page.goto(item.submitUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const initialBlocker = await handleTumblrManualBlocker(page, item, options);
  if (initialBlocker) {
    return manualBlockerReviewResult(page, options);
  }
  await waitForSubmitForm(page, item);
  if (await handleTumblrRateLimit(page, item, options)) {
    return rateLimitReviewResult(page, options);
  }
  const formBlocker = await handleTumblrManualBlocker(page, item, options);
  if (formBlocker) {
    return manualBlockerReviewResult(page, options);
  }

  if (await pageNeedsManualAction(page)) {
    console.log(`[manual-action] ${item.targetName}: login, captcha, terms, or changed form detected.`);
    const message = "Login, captcha, terms, or changed form detected before fill.";
    await reportRunnerEvent(
      options,
      item,
      options.headless ? "failed" : "needs-review",
      options.headless ? headlessBlockerMessage(message) : message,
      options.headless ? "error" : "warning",
      options.headless ? { reason_code: headlessBlockerCodes.manualReviewRequired } : {},
    );
    if (options.headless) {
      throw new Error(headlessBlockerMessage(message));
    }
    await pauseForOperator(page, options);
    return { readyForReview: false, status: "needs-review" };
  }

  await logFrameDiagnostics(page);
  const target = await automationTarget(page);
  console.log(`[runner] Automation target: ${target.url() || "top page"}`);
  const postTypeSelected = await choosePostType(page, item.postType);
  if (!postTypeSelected) {
    const operatorSelected = await waitForOperatorPostTypeSelection(page, item, options);
    if (!operatorSelected) {
      const message = `Could not switch post type to ${item.postType}.`;
      console.log(`[manual-action] ${item.targetName}: ${message}`);
      await reportRunnerEvent(options, item, options.headless ? "failed" : "needs-review", options.headless ? headlessBlockerMessage(message) : message, options.headless ? "error" : "warning", {
        ...(options.headless ? { reason_code: headlessBlockerCodes.manualReviewRequired } : {}),
      });
      await failHeadlessReview(page, options, message);
      await pauseForOperator(page, options);
      return { readyForReview: false, status: options.headless ? "failed" : "needs-review" };
    }
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  await fillTitle(page, fields);
  const textFilled = await fillTextFields(page, fields);
  const tagsFilled = await fillTags(page, fields.tags);
  const mediaUploaded = await uploadMedia(page, item, fields, options);
  const imageLinkFilled = item.postType === "photo" ? await fillPhotoClickThroughUrl(page, fields.imageLinkUrl, {
    pageTargets,
    accessibleContext,
    fillEditable,
  }) : false;
  const termsAccepted = await acceptTerms(page);
  console.log(
    `[runner] Fill summary: text=${textFilled ? "filled" : "not found"}, tags=${tagsFilled ? "filled" : "not found"}, media=${mediaUploaded ? "uploaded" : "not uploaded"}, imageLink=${imageLinkFilled ? "filled" : "not found"}, terms=${termsAccepted ? "accepted" : "not found"}.`,
  );
  await reportRunnerEvent(options, item, "running", "Fields filled where possible.", "info", {
    textFilled,
    tagsFilled,
    mediaUploaded,
    imageLinkFilled,
    termsAccepted,
  });

  if (await pageNeedsManualAction(page)) {
    const message = "Page requires review before submit.";
    console.log(`[manual-action] ${item.targetName}: ${message}`);
    await reportRunnerEvent(
      options,
      item,
      options.headless ? "failed" : "needs-review",
      options.headless ? headlessBlockerMessage(message) : message,
      options.headless ? "error" : "warning",
      options.headless ? { reason_code: headlessBlockerCodes.manualReviewRequired } : {},
    );
    await failHeadlessReview(page, options, message);
    if (shouldDeferReadyReview(options)) {
      return { readyForReview: true, page, status: "needs-review" };
    }

    await pauseForOperator(page, options);
    return { readyForReview: false, status: options.headless ? "failed" : "needs-review" };
  }

  if (options.submit) {
    const submitResult = await clickSubmit(target);
    const submitted = submitResult.status === "clicked";
    const postedUrl = submitted ? await postedUrlFromPage(page, item.submitUrl) : "";
    console.log(submitted ? `[submitted] ${item.targetName}: submit button clicked.` : `[manual-action] ${item.targetName}: ${submitResult.message}`);
    await reportRunnerEvent(
      options,
      item,
      submitted ? "submitted" : options.headless ? "failed" : "needs-review",
      submitted ? submitResult.message : options.headless ? headlessBlockerMessage(submitResult.message) : submitResult.message,
      submitted ? "info" : options.headless ? "error" : "warning",
      submitted ? { ...submitResult, postedUrl } : submitResult,
    );
    if (!submitted) {
      await failHeadlessReview(page, options, submitResult.message);
    }
    return { readyForReview: false, status: submitted ? "submitted" : options.headless ? "failed" : "needs-review" };
  } else {
    console.log(`[ready] ${item.targetName}: fields filled where possible. Review the page, then submit manually or rerun with --submit.`);
    await reportRunnerEvent(options, item, "needs-review", "Fields filled and ready for manual review.", "info");
    if (shouldDeferReadyReview(options)) {
      return { readyForReview: true, page, status: "needs-review" };
    }

    await pauseForOperator(page, options);
  }

  return { readyForReview: false, status: "needs-review" };
}

async function postedUrlFromPage(page, submitUrl) {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  const url = page.url();
  return /^https?:\/\//i.test(url) && url !== submitUrl ? url : "";
}

async function runnerPage(context, options) {
  if (options.remoteCdpUrl) {
    const existing = context.pages().find(isReusableRemotePage);
    if (existing) {
      await existing.bringToFront().catch(() => undefined);
      return existing;
    }
  }

  const page = await context.newPage();
  await page.bringToFront().catch(() => undefined);
  return page;
}

async function reportRunnerEvent(options, item, status, message, level = "info", details = {}) {
  if (!options.apiBaseUrl || !item?.id) {
    return;
  }

  await fetch(`${options.apiBaseUrl}/runner/logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.apiToken ? { Authorization: `Bearer ${options.apiToken}` } : {}),
    },
    body: JSON.stringify({
      run_id: options.runId,
      workspace_id: options.workspaceId,
      queue_item_id: item.id,
      target_name: item.targetName,
      level,
      status,
      message,
      details,
    }),
  }).catch((error) => {
    console.log(`[runner] Could not write queue log: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function pageNeedsManualAction(page) {
  return Boolean(await pageManualActionReason(page));
}

async function pageManualActionReason(page) {
  const pageTitle = await page.title().catch(() => "");
  const topReason = manualActionReason(pageTitle, page.url());
  if (topReason) {
    return { message: topReason, url: page.url(), sample: pageTitle };
  }

  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const reason = manualActionReason(text, frame.url());
    if (reason) {
      return {
        message: reason,
        url: frame.url(),
        sample: text.replace(/\s+/g, " ").trim().slice(0, 240),
      };
    }
  }

  return null;
}

async function handleTumblrManualBlocker(page, item, options) {
  const blocker = await pageManualActionReason(page);
  if (!blocker) {
    return false;
  }

  console.log(`[manual-action] ${item.targetName}: ${blocker.message}`);
  const headlessMessage = options.headless ? headlessBlockerMessage(blocker.message) : "";
  const headlessReasonCode = options.headless ? headlessBlockerCodeForReason(blocker.message) : "";
  await reportRunnerEvent(options, item, options.headless ? "failed" : "needs-review", headlessMessage || blocker.message, options.headless ? "error" : "warning", {
    explanation: blocker.message,
    reason_code: headlessReasonCode || "manual_review_required",
    headless_reason_code: headlessReasonCode,
    url: blocker.url,
    sample: blocker.sample,
  });
  if (options.headless) {
    throw new Error(headlessMessage);
  }
  return true;
}

async function failHeadlessReview(page, options, message) {
  if (!options.headless) {
    return;
  }
  await page.close().catch(() => undefined);
  throw new Error(headlessBlockerMessage(message));
}

async function manualBlockerReviewResult(page, options) {
  if (shouldDeferReadyReview(options)) {
    return { readyForReview: true, page, status: "needs-review" };
  }

  await pauseForOperator(page, options);
  return { readyForReview: false, status: "needs-review" };
}

async function handleTumblrRateLimit(page, item, options) {
  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (appearsRateLimitedByTumblr(text, frame.url())) {
      const message = "Tumblr rate limit exceeded. Wait before retrying this target.";
      console.log(`[manual-action] ${item.targetName}: ${message}`);
      const headlessMessage = options.headless ? headlessBlockerMessage(message) : "";
      await reportRunnerEvent(options, item, options.headless ? "failed" : "needs-review", headlessMessage || message, options.headless ? "error" : "warning", {
        explanation: message,
        reason_code: options.headless ? headlessBlockerCodes.rateLimited : "tumblr_rate_limited",
        headless_reason_code: options.headless ? headlessBlockerCodes.rateLimited : "",
        url: frame.url(),
      });
      if (options.headless) {
        throw new Error(headlessMessage);
      }
      return true;
    }
  }

  return false;
}

async function rateLimitReviewResult(page, options) {
  if (shouldDeferReadyReview(options)) {
    return { readyForReview: true, page, status: "needs-review" };
  }

  await pauseForOperator(page, options);
  return { readyForReview: false, status: "needs-review" };
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
  const publicPageRateLimited = await pageAppearsRateLimitedByTumblr(page);
  const ready = publicPageRateLimited ? false : await waitForFormControls(page, 15000);
  if (ready) {
    return true;
  }

  console.log(
    publicPageRateLimited
      ? `[runner] Public submit page was rate-limited; opening ${directSubmitUrl}`
      : `[runner] Public submit page did not expose the form yet; opening ${directSubmitUrl}`,
  );
  await page.goto(directSubmitUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  return waitForFormControls(page, 15000);
}

async function pageAppearsRateLimitedByTumblr(page) {
  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (appearsRateLimitedByTumblr(text, frame.url())) {
      return true;
    }
  }

  return false;
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

  const tumblrPostSelectSelected = await choosePostTypeFromTumblrPostSelect(page, optionValue);
  if (tumblrPostSelectSelected) {
    console.log(`[runner] Selected ${optionValue} post type from Tumblr post selector.`);
    return true;
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

async function choosePostTypeFromTumblrPostSelect(page, optionValue) {
  for (const target of await pageTargets(page)) {
    const postSelect = target.locator("#post_select").first();
    if (!(await postSelect.count().catch(() => 0))) {
      continue;
    }

    if (await postTypeSelected(page, optionValue)) {
      return true;
    }

    await postSelect.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
    const opened = await target
      .locator("#post_select .txt, #post_select")
      .first()
      .click({ force: true, timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      continue;
    }

    await page.waitForTimeout(500).catch(() => undefined);
    const option = target.locator(tumblrPostSelectOptionSelector(optionValue)).first();
    if (!(await option.count().catch(() => 0))) {
      continue;
    }

    await option.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
    const box = await option.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => undefined);
    } else {
      await option.click({ force: true, timeout: 3000 }).catch(() => undefined);
    }

    if (await waitForPostTypeSelected(page, optionValue, 5000)) {
      return true;
    }
  }

  return false;
}

async function waitForPostTypeSelected(page, optionValue, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await postTypeSelected(page, optionValue)) {
      return true;
    }

    await page.waitForTimeout(250).catch(() => undefined);
  }

  return postTypeSelected(page, optionValue);
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
  const optionSelector = ".option, li, [role='option'], button, a, div, span";
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

  const option = target.locator(optionSelector).nth(candidateIndex);
  const clickedWithPlaywright = await option.click({ force: true, timeout: 1500 }).then(() => true).catch(() => false);
  if (clickedWithPlaywright) {
    await page.waitForTimeout(1000).catch(() => undefined);
    if (await postTypeSelected(page, optionValue)) {
      return true;
    }
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
      .evaluate(fillRichTextEditorInDocument, { value, isHtml })
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
    await clearLocatorSelection(locator);
    return true;
  }

  await locator.click().catch(() => undefined);
  const selected = await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A").then(() => true).catch(() => false);
  if (selected) {
    await locator.press("Backspace").catch(() => undefined);
  }
  const typed = await locator.pressSequentially(value, { delay: 1 }).then(() => true).catch(() => false);
  if (typed) {
    await clearLocatorSelection(locator);
  }
  return typed;
}

async function clearLocatorSelection(locator) {
  await locator
    .evaluate((element) => {
      const selection = window.getSelection?.();
      selection?.removeAllRanges();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const end = element.value.length;
        element.setSelectionRange(end, end);
      }
      if (typeof element.blur === "function") {
        element.blur();
      }
      selection?.removeAllRanges();
    })
    .catch(() => undefined);
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
    const embeddedPath = await materializeDataUrl(fields.imageDataUrl, fields.imageName, path.join(os.tmpdir(), "inwell-tumblr-runner"));
    if (embeddedPath) {
      return embeddedPath;
    }

    const remotePath = await materializeRemoteMedia(fields.imageDataUrl, fields.imageName, options);
    if (remotePath) {
      return remotePath;
    }
  }

  if (!fields.imageName || !options.mediaDir) {
    return null;
  }

  const localPath = path.resolve(options.mediaDir, fields.imageName);
  return existsSync(localPath) ? localPath : null;
}

async function materializeRemoteMedia(value, preferredName, options) {
  const mediaUrl = remoteMediaUrl(value, options);
  if (!mediaUrl) {
    return null;
  }

  const response = await fetch(mediaUrl).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const urlPath = new URL(mediaUrl).pathname;
  const extension = path.extname(urlPath) || extensionForContentType(response.headers.get("content-type"));
  const fileName = safeMediaFileName(preferredName || `tumblr-upload${extension || ".bin"}`, extension);
  const directory = path.join(os.tmpdir(), "inwell-tumblr-runner");
  const targetPath = path.join(directory, fileName);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

function remoteMediaUrl(value, options) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("data:")) {
    return "";
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (!raw.startsWith("/") || !options.apiBaseUrl) {
    return "";
  }

  const appBaseUrl = options.apiBaseUrl.replace(/\/api$/i, "");
  return new URL(raw, `${appBaseUrl}/`).toString();
}

function extensionForContentType(contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/webp") return ".webp";
  return "";
}

function safeMediaFileName(fileName, extension) {
  const safeName = String(fileName || "tumblr-upload").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  if (extension && !safeName.toLowerCase().endsWith(extension.toLowerCase())) {
    return `${safeName}${extension}`;
  }
  return safeName || `tumblr-upload${extension || ".bin"}`;
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
      if (!(await button.isEnabled({ timeout: 1000 }).catch(() => false))) {
        return { status: "disabled", message: "Submit button is disabled after filling the form." };
      }
      await button.click({ timeout: 5000 });
      return { status: "clicked", message: "Submit button clicked." };
    }
  }
  return { status: "missing", message: "No submit button found." };
}

async function pauseForOperator(page, options) {
  if (options.noPause || options.noReviewPause) {
    await page.close().catch(() => undefined);
    return;
  }

  if (options.remoteCdpUrl) {
    console.log("[runner] Remote browser page remains open for review. Close the live-view tab page when done.");
    while (!page.isClosed()) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return;
  }

  if (options.headless) {
    await page.close().catch(() => undefined);
    throw new Error(`${headlessBlockerCodes.operatorPauseRequired}: Headless mode cannot pause for browser review. Rerun with Run headless off, complete the browser action, then retry headless.`);
  }

  console.log("[runner] Browser remains open for review. Press Enter here to continue.");
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });
  await page.close().catch(() => undefined);
}

async function waitForQueueReviewPages(options, reviewPages) {
  if (options.headless || options.noPause || options.noReviewPause) {
    await Promise.all(reviewPages.map((page) => page.close().catch(() => undefined)));
    return;
  }

  if (options.remoteCdpUrl) {
    console.log(`[runner] ${reviewPages.length} remote browser review page${reviewPages.length === 1 ? " is" : "s are"} open. Close review tabs when done.`);
  } else {
    console.log(reviewPagesOpenMessage(reviewPages.length));
  }
  while (reviewPages.some((page) => !page.isClosed())) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main().catch((error) => {
  console.error(`[runner:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

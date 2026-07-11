import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const manualActionPatterns = [
  /log in/i,
  /login/i,
  /sign in/i,
  /captcha/i,
  /recaptcha/i,
  /verify you/i,
  /are you a robot/i,
  /request denied/i,
  /permission denied/i,
  /access denied/i,
];

export const tumblrRateLimitPatterns = [
  /rate limit exceeded/i,
  /encountered the rate limit/i,
];

export const headlessBlockerCodes = {
  loginRequired: "headless_login_required",
  manualReviewRequired: "headless_manual_review_required",
  captchaRequired: "headless_captcha_required",
  accessDenied: "headless_access_denied",
  rateLimited: "headless_rate_limited",
  operatorPauseRequired: "headless_operator_pause_required",
  runnerFailed: "headless_runner_failed",
};

export function parseArgs(argv) {
  const options = {
    planPath: "",
    userDataDir: path.join(process.cwd(), ".tumblr-runner-profile"),
    mediaDir: "",
    headless: false,
    loginFirst: false,
    noPause: false,
    noReviewPause: false,
    submit: false,
    slowMo: 0,
    apiBaseUrl: "",
    runId: "",
    workspaceId: "",
    apiToken: "",
    remoteCdpUrl: "",
    remoteLiveUrl: "",
    resultPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan") {
      options.planPath = argv[++index] ?? "";
    } else if (arg === "--media-dir") {
      options.mediaDir = argv[++index] ?? "";
    } else if (arg === "--user-data-dir") {
      options.userDataDir = argv[++index] ?? "";
    } else if (arg === "--headless") {
      options.headless = true;
    } else if (arg === "--login-first") {
      options.loginFirst = true;
    } else if (arg === "--no-pause") {
      options.noPause = true;
    } else if (arg === "--no-review-pause") {
      options.noReviewPause = true;
    } else if (arg === "--submit") {
      options.submit = true;
    } else if (arg === "--slow-mo") {
      options.slowMo = Number(argv[++index] ?? "0") || 0;
    } else if (arg === "--api-base") {
      options.apiBaseUrl = String(argv[++index] ?? "").replace(/\/$/, "");
    } else if (arg === "--run-id") {
      options.runId = String(argv[++index] ?? "");
    } else if (arg === "--workspace-id") {
      options.workspaceId = String(argv[++index] ?? "");
    } else if (arg === "--api-token") {
      options.apiToken = String(argv[++index] ?? "");
    } else if (arg === "--remote-cdp-url") {
      options.remoteCdpUrl = String(argv[++index] ?? "");
    } else if (arg === "--remote-live-url") {
      options.remoteLiveUrl = String(argv[++index] ?? "");
    } else if (arg === "--result-path") {
      options.resultPath = String(argv[++index] ?? "");
    } else if (!arg.startsWith("--") && !options.planPath) {
      options.planPath = arg;
    } else {
      throw new Error(`Unknown runner argument: ${arg}`);
    }
  }

  if (!options.planPath) {
    throw new Error("Missing queue plan. Use --plan tumblr-runner-plan.json.");
  }

  return options;
}

export async function loadRunnerPlan(planPath) {
  const raw = await fs.readFile(planPath, "utf8");
  return normalizeRunnerPlan(JSON.parse(raw));
}

export function normalizeRunnerPlan(value) {
  if (value?.workflow !== "tumblr-submission-queue" || !Array.isArray(value.items)) {
    throw new Error("Expected a tumblr-submission-queue plan with an items array.");
  }

  return {
    version: Number(value.version) || 1,
    generatedAt: String(value.generatedAt ?? ""),
    items: value.items.map(normalizeQueueItem).filter(Boolean),
  };
}

export function normalizeQueueItem(value) {
  if (!value?.id || !value.submitUrl || !value.runnerPayload) {
    return null;
  }

  const payload = decodeRunnerPayload(value.runnerPayload);
  return {
    id: String(value.id),
    targetName: String(value.targetName || value.targetId || payload.target?.name || "Tumblr target"),
    submitUrl: String(value.submitUrl),
    postType: normalizePostType(value.postType || payload.advertisement?.postType),
    payload,
  };
}

export function decodeRunnerPayload(value) {
  if (typeof value === "string") {
    return JSON.parse(value);
  }

  if (value && typeof value === "object") {
    return value;
  }

  throw new Error("Queue item has an invalid runnerPayload.");
}

export function normalizePostType(value) {
  return value === "text" || value === "video" ? value : "photo";
}

export function postTypeCandidateIndex(candidates, optionValue) {
  const requested = normalizePostType(optionValue);
  const normalized = candidates.map((candidate, index) => ({
    index,
    selected: Boolean(candidate.selected),
    text: String(candidate.text ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
    visible: Boolean(candidate.visible),
  }));

  return (
    normalized.find((candidate) => candidate.visible && !candidate.selected && candidate.text === requested)?.index ??
    normalized.find((candidate) => candidate.visible && candidate.text === requested)?.index ??
    -1
  );
}

export function tumblrPostSelectOptionSelector(value) {
  return `#post_select [data-option-value="${normalizePostType(value)}"]`;
}

export function shouldPauseForManualAction(text, url = "") {
  return Boolean(manualActionReason(text, url));
}

export function manualActionReason(text, url = "") {
  const haystack = `${url}\n${text}`;
  if (/request denied|permission denied|access denied/i.test(haystack)) {
    return "Tumblr denied this request. Review the live page or retry later with the saved Tumblr session.";
  }
  if (/captcha|recaptcha|verify you|are you a robot/i.test(haystack)) {
    return "Tumblr asked for captcha or identity verification.";
  }
  if (/log in|login|sign in/i.test(haystack)) {
    return "Tumblr asked for login before the submit form was available.";
  }
  return manualActionPatterns.some((pattern) => pattern.test(haystack))
    ? "Tumblr needs manual review before this item can continue."
    : "";
}

export function headlessBlockerCodeForReason(reason) {
  const value = String(reason || "");
  if (/captcha|identity verification/i.test(value)) {
    return headlessBlockerCodes.captchaRequired;
  }
  if (/denied/i.test(value)) {
    return headlessBlockerCodes.accessDenied;
  }
  if (/login|log in|sign in/i.test(value)) {
    return headlessBlockerCodes.loginRequired;
  }
  if (/rate limit/i.test(value)) {
    return headlessBlockerCodes.rateLimited;
  }
  return headlessBlockerCodes.manualReviewRequired;
}

export function headlessBlockerMessage(reason) {
  const message = String(reason || "Tumblr needs manual review before this item can continue.");
  const code = headlessBlockerCodeForReason(message);
  return `${code}: ${message} Rerun with Run headless off, complete the browser action, then retry headless.`;
}

export function headlessLoginRequiredMessage() {
  return headlessBlockerMessage("Tumblr asked for login before the submit form was available.");
}

export function appearsRateLimitedByTumblr(text, url = "") {
  const haystack = `${url}\n${text}`;
  return /tumblr\.com/i.test(haystack) && tumblrRateLimitPatterns.some((pattern) => pattern.test(haystack));
}

export function shouldDeferReadyReview(options) {
  return !options.submit && !options.headless && !options.noPause;
}

export function isReusableRemotePage(page) {
  if (!page || typeof page.isClosed !== "function" || page.isClosed()) {
    return false;
  }
  if (typeof page.url !== "function") {
    return false;
  }
  const url = page.url();
  return ["", "about:blank"].includes(url) || /^https:\/\/www\.tumblr\.com\/(dashboard|login)/i.test(url);
}

export function reviewPagesOpenMessage(readyReviewCount) {
  return `[runner] ${readyReviewCount} queued page${readyReviewCount === 1 ? " is" : "s are"} open for review. Submit or review in the browser, then close ${readyReviewCount === 1 ? "that browser tab" : "those browser tabs"} when done.`;
}

export function loginWaitMessage(timeoutSeconds) {
  return `[login] Log into Tumblr in the browser if needed. The runner will continue automatically when Tumblr is ready, or after ${timeoutSeconds} seconds.`;
}

export function appearsLoggedInToTumblr(text, url = "") {
  const haystack = `${url}\n${text}`;
  return (
    /dashboard|following|for you|account|activity|home/i.test(haystack) &&
    !/log in to continue|login_register_required|log in|sign in/i.test(haystack)
  );
}

export function frameCandidateScore(frameInfo) {
  let score = 0;
  if (/submit_form/i.test(frameInfo.name ?? "")) score += 100;
  if (/\/submit_form\//i.test(frameInfo.url ?? "")) score += 100;
  if (/\/submit\b/i.test(frameInfo.url ?? "")) score += 25;
  score += Math.min(Number(frameInfo.controlCount) || 0, 20);
  return score;
}

export function summarizeFrames(frames) {
  const blockerFrame = frames.find(
    (frame) => frame.hasDeniedText || frame.hasCaptchaText || frame.hasLoginText,
  );
  const formFrame =
    frames
      .map((frame) => ({
        ...frame,
        controlCount:
          (Number(frame.inputs) || 0) +
          (Number(frame.textareas) || 0) +
          (Number(frame.contenteditable) || 0) +
          (Number(frame.buttons) || 0),
      }))
      .filter((frame) => frame.controlCount > 3)
      .sort((left, right) => frameCandidateScore(right) - frameCandidateScore(left))[0] ?? null;

  const combinedText = frames.map((frame) => frame.sample ?? "").join(" ");
  return {
    likelyLoggedIn:
      /dashboard|following|for you|account|activity/i.test(combinedText) &&
      !/log in to continue|login_register_required/i.test(combinedText),
    blocker: blockerFrame?.sample ?? "",
    blockerUrl: blockerFrame?.url ?? "",
    formFrame,
  };
}

export function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }

  const [, mimeType = "application/octet-stream", base64, body] = match;
  const buffer = base64 ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
  return { buffer, mimeType };
}

export async function materializeDataUrl(dataUrl, preferredName, directory = os.tmpdir()) {
  const parsed = dataUrlToBuffer(dataUrl);
  if (!parsed) {
    return null;
  }

  const extension = extensionForMimeType(parsed.mimeType);
  const safeName = sanitizeFileName(preferredName || `tumblr-upload${extension}`);
  const targetPath = path.join(directory, safeName.endsWith(extension) ? safeName : `${safeName}${extension}`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(targetPath, parsed.buffer);
  return targetPath;
}

export function extensionForMimeType(mimeType) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "video/mp4") return ".mp4";
  return ".bin";
}

export function sanitizeFileName(value) {
  const cleaned = String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim();
  return cleaned || "tumblr-upload";
}

export function htmlToPlainText(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fieldsForItem(item) {
  const fields = item.payload.fields ?? {};
  const advertisement = item.payload.advertisement ?? {};
  const bodyHtml = String(fields.body || fields.caption || "");
  return {
    body: htmlToPlainText(bodyHtml || fields.package || ""),
    caption: htmlToPlainText(bodyHtml || fields.package || ""),
    bodyHtml,
    packageText: String(fields.package || fields.body || ""),
    title: String(advertisement.savedOptionName || ""),
    videoUrl: String(fields.videoUrl || advertisement.videoUrl || ""),
    imageDataUrl: String(fields.imageDataUrl || advertisement.imageDataUrl || ""),
    imageLinkUrl: String(fields.imageLinkUrl || advertisement.forumUrl || ""),
    imageName: String(advertisement.imageName || "tumblr-upload.png"),
    tags: Array.isArray(advertisement.tags) ? advertisement.tags.map(String) : [],
  };
}

export function isPhotoClickThroughContext(value, allowGenericUrl = false) {
  const context = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!context) {
    return false;
  }
  if (/video|tag|caption|body|title|search|email|password|login/.test(context)) {
    return false;
  }

  return /click.?through|photo link|image link|link url|source url|content source|set a link|add a link/.test(context)
    || (allowGenericUrl && /^url$|^https?:\/\/|url to link|link$/.test(context));
}

export async function fillPhotoClickThroughUrl(page, value, dependencies) {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  if (await fillPhotoLinkInput(page, url, false, dependencies)) {
    return true;
  }

  const opened = await openPhotoLinkControl(page, dependencies);
  return opened ? fillPhotoLinkInput(page, url, true, dependencies) : false;
}

export async function openPhotoLinkControl(page, { pageTargets, accessibleContext }) {
  for (const target of await pageTargets(page)) {
    const controls = target.locator("button, a, [role='button']");
    const count = await controls.count();
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible().catch(() => false))) {
        continue;
      }
      if (!isPhotoClickThroughContext(await accessibleContext(control))) {
        continue;
      }
      const clicked = await control.click({ timeout: 1500 }).then(() => true).catch(() => false);
      if (clicked) {
        await page.waitForTimeout(250).catch(() => undefined);
        return true;
      }
    }
  }
  return false;
}

async function fillPhotoLinkInput(page, value, allowGenericUrl, { pageTargets, accessibleContext, fillEditable, log = console.log }) {
  for (const target of await pageTargets(page)) {
    const inputs = target.locator("input[type='url'], input[type='text'], input:not([type]), textarea");
    const count = await inputs.count();
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      if (!(await input.isVisible().catch(() => false))) {
        continue;
      }
      if (!isPhotoClickThroughContext(await accessibleContext(input), allowGenericUrl)) {
        continue;
      }
      if (await fillEditable(input, value)) {
        log("[runner] Filled photo click-through URL.");
        return true;
      }
    }
  }
  return false;
}

export function fillRichTextEditorInDocument({ value, isHtml = false }) {
  const clearSelection = () => {
    const selection = window.getSelection?.();
    selection?.removeAllRanges();
  };
  const settleSelectionAtEnd = (editable) => {
    clearSelection();
    const selection = window.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    selection?.addRange(range);
    clearSelection();
    if (typeof editable.blur === "function") {
      editable.blur();
    }
    const activeElement = document.activeElement;
    if (activeElement && typeof activeElement.blur === "function") {
      activeElement.blur();
    }
  };
  const body = document.body;
  const editable =
    document.querySelector("[contenteditable='true']") ||
    (document.designMode === "on" ? body : null) ||
    (body?.id === "tinymce" ? body : null) ||
    (body?.className && String(body.className).toLowerCase().includes("tinymce") ? body : null);

  if (!editable) {
    return false;
  }

  clearSelection();
  editable.focus();
  if (isHtml) {
    editable.innerHTML = value;
  } else {
    editable.textContent = value;
  }
  editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: isHtml ? editable.textContent : value }));
  editable.dispatchEvent(new Event("change", { bubbles: true }));
  settleSelectionAtEnd(editable);
  return true;
}

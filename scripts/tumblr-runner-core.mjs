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
];

export function parseArgs(argv) {
  const options = {
    planPath: "",
    userDataDir: path.join(process.cwd(), ".tumblr-runner-profile"),
    mediaDir: "",
    headless: false,
    loginFirst: false,
    noPause: false,
    submit: false,
    slowMo: 0,
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
    } else if (arg === "--submit") {
      options.submit = true;
    } else if (arg === "--slow-mo") {
      options.slowMo = Number(argv[++index] ?? "0") || 0;
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

export function shouldPauseForManualAction(text, url = "") {
  const haystack = `${url}\n${text}`;
  return manualActionPatterns.some((pattern) => pattern.test(haystack));
}

export function shouldDeferReadyReview(options) {
  return !options.submit && !options.headless && !options.noPause;
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
    imageName: String(advertisement.imageName || "tumblr-upload.png"),
    tags: Array.isArray(advertisement.tags) ? advertisement.tags.map(String) : [],
  };
}

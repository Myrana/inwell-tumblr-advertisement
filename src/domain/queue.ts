import { submissionQueueStorageKey } from "./constants";
import { Advertisement, SubmissionQueueItem, SubmissionStatus, TumblrSubmitTarget } from "./types";
import { composerContentFor } from "./ads";

export const defaultScheduleTimezone = "America/New_York";

export function normalizeQueueItem(value: Partial<SubmissionQueueItem> | null | undefined): SubmissionQueueItem | null {
  if (!value?.id || !value.adId || !value.targetId || !value.submitUrl) {
    return null;
  }

  const status = normalizeSubmissionStatus(value.status);

  return {
    id: value.id,
    adId: value.adId,
    targetId: value.targetId,
    targetName: value.targetName || value.targetId,
    submitUrl: value.submitUrl,
    postType: value.postType === "text" || value.postType === "video" ? value.postType : "photo",
    status,
    scheduledFor: value.scheduledFor || "",
    timezone: value.timezone || defaultScheduleTimezone,
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || new Date().toISOString(),
    lastRunAt: value.lastRunAt || "",
    postedAt: value.postedAt || "",
    failedAt: value.failedAt || "",
    notes: value.notes || "",
    runnerPayload: value.runnerPayload || "",
  };
}

export function normalizeSubmissionStatus(value: unknown): SubmissionStatus {
  if (value === "submitting" || value === "running") return "running";
  if (value === "submitted") return "submitted";
  if (value === "posted") return "posted";
  if (value === "manual-action" || value === "needs-review") return "needs-review";
  if (value === "scheduled" || value === "failed") return value;
  return "queued";
}

export function loadSubmissionQueue() {
  try {
    const raw = localStorage.getItem(submissionQueueStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Partial<SubmissionQueueItem>[];
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeQueueItem(item)).filter((item): item is SubmissionQueueItem => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

export function buildRunnerPayload(advertisement: Advertisement, target: TumblrSubmitTarget, postPackage: string) {
  const composerContent = composerContentFor(advertisement);
  return JSON.stringify(
    {
      version: 1,
      workflow: "tumblr-public-submit-page",
      target,
      advertisement: {
        id: advertisement.id,
        savedOptionName: advertisement.title,
        postType: advertisement.postType,
        forumUrl: advertisement.forumUrl,
        tags: advertisement.tags,
        imageName: advertisement.imageName,
        imageDataUrl: advertisement.imageDataUrl,
        videoName: advertisement.videoName,
        videoUrl: advertisement.videoUrl,
      },
      fields: {
        body: composerContent,
        caption: composerContent,
        videoUrl: advertisement.videoUrl,
        imageDataUrl: advertisement.imageDataUrl,
        package: postPackage,
      },
      runnerNotes: [
        "Open submitUrl in a logged-in Tumblr browser session.",
        "Choose the matching text/photo/video form.",
        "Paste the prepared fields, upload local media when needed, accept required blog terms, and submit.",
        "If Tumblr shows login, captcha, or changed form markup, pause for manual action.",
      ],
    },
    null,
    2,
  );
}

export function createQueueItem(advertisement: Advertisement, target: TumblrSubmitTarget, postPackage: string): SubmissionQueueItem {
  const timestamp = new Date().toISOString();
  return {
    id: `${advertisement.id}-${target.id}`,
    adId: advertisement.id,
    targetId: target.id,
    targetName: target.name,
    submitUrl: target.submitUrl,
    postType: advertisement.postType,
    status: "queued",
    scheduledFor: "",
    timezone: defaultScheduleTimezone,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastRunAt: "",
    postedAt: "",
    failedAt: "",
    notes: "Ready for local browser runner.",
    runnerPayload: buildRunnerPayload(advertisement, target, postPackage),
  };
}

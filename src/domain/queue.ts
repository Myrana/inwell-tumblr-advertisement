import { defaultQueueName, submissionQueueStorageKey } from "./constants";
import { Advertisement, QueueDefinition, SubmissionQueueItem, SubmissionStatus, TumblrSubmitTarget } from "./types";
import { composerContentFor } from "./ads";

export const defaultScheduleTimezone = "America/New_York";

export function queueIdFromName(name: string) {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "default-queue";
}

export function normalizeQueueName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  return name || defaultQueueName;
}

export function normalizeQueueDefinition(value: Partial<QueueDefinition> | null | undefined): QueueDefinition | null {
  const name = normalizeQueueName(value?.name);
  const id = typeof value?.id === "string" && value.id.trim() ? value.id.trim() : queueIdFromName(name);
  return { id, name };
}

export function uniqueQueueDefinitions(definitions: QueueDefinition[], items: SubmissionQueueItem[] = []) {
  const byName = new Map<string, QueueDefinition>();
  [...definitions, ...items.map((item) => ({ id: queueIdFromName(item.queueName), name: item.queueName }))].forEach((definition) => {
    const normalized = normalizeQueueDefinition(definition);
    if (!normalized) {
      return;
    }
    byName.set(normalized.name.toLowerCase(), normalized);
  });

  if (!byName.size) {
    byName.set(defaultQueueName.toLowerCase(), { id: queueIdFromName(defaultQueueName), name: defaultQueueName });
  }

  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

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
    queueName: normalizeQueueName(value.queueName),
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

export function createQueueItem(
  advertisement: Advertisement,
  target: TumblrSubmitTarget,
  postPackage: string,
  queueName = defaultQueueName,
): SubmissionQueueItem {
  const timestamp = new Date().toISOString();
  const normalizedQueueName = normalizeQueueName(queueName);
  return {
    id: `${advertisement.id}-${queueIdFromName(normalizedQueueName)}-${target.id}`,
    adId: advertisement.id,
    targetId: target.id,
    targetName: target.name,
    queueName: normalizedQueueName,
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

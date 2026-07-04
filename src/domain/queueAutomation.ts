import { isQueueableAdvertisement } from "./adEligibility";
import { buildPreparedPost } from "./post";
import { createQueueItem, isCompletedQueueItem } from "./queue";
import { fallbackTarget } from "./submitTargets";
import {
  Advertisement,
  RunnerActivity,
  SubmissionQueueItem,
  SubmissionStatus,
  TumblrSubmitTarget,
  WorkspaceView,
} from "./types";

export type QueueStatusCounts = Record<SubmissionStatus, number>;

export type QueueReadiness = {
  canRun: boolean;
  status: "ready" | "blocked" | "empty" | "review";
  title: string;
  detail: string;
  primaryAction: {
    label: string;
    view: WorkspaceView;
  };
  blockers: string[];
};

export type QueueRefillResult = {
  queue: SubmissionQueueItem[];
  addedItems: SubmissionQueueItem[];
  skippedReasons: string[];
};

const emptyCounts: QueueStatusCounts = {
  queued: 0,
  scheduled: 0,
  running: 0,
  submitted: 0,
  posted: 0,
  "needs-review": 0,
  failed: 0,
};

export function queueStatusCounts(items: SubmissionQueueItem[]): QueueStatusCounts {
  return items.reduce<QueueStatusCounts>(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { ...emptyCounts },
  );
}

export function runnableQueueItems(items: SubmissionQueueItem[]) {
  return items.filter((item) => !["submitted", "posted", "running"].includes(item.status));
}

export function activeQueueItems(items: SubmissionQueueItem[]) {
  return items.filter((item) => !isCompletedQueueItem(item));
}

export function attentionQueueItems(items: SubmissionQueueItem[]) {
  return items.filter((item) => item.status === "needs-review" || item.status === "failed");
}

export function completedQueueItems(items: SubmissionQueueItem[]) {
  return items.filter(isCompletedQueueItem);
}

export function queueReadiness(options: {
  activeQueueName: string;
  activeQueue: SubmissionQueueItem[];
  connectedAccountCount: number;
  runnerActivity: RunnerActivity;
  savedDraftCount: number;
  submitApproved: boolean;
}): QueueReadiness {
  const runnableCount = runnableQueueItems(options.activeQueue).length;
  const attentionCount = attentionQueueItems(options.activeQueue).length;
  const blockers: string[] = [];
  const runnerReady = !["Offline", "Needs attention"].includes(options.runnerActivity.status);

  if (!options.activeQueueName) {
    blockers.push("Create or select a queue.");
  }
  if (!options.connectedAccountCount) {
    blockers.push("Connect a Tumblr account.");
  }
  if (!runnableCount) {
    blockers.push("Add queued or scheduled submissions.");
  }
  if (!runnerReady) {
    blockers.push("Start or repair the local runner.");
  }

  if (attentionCount > 0) {
    return {
      canRun: false,
      status: "review",
      title: `${attentionCount} item${attentionCount === 1 ? "" : "s"} need review`,
      detail: "Clear failed or review-needed submissions before relying on automation.",
      primaryAction: { label: "Review queue", view: "queue" },
      blockers,
    };
  }

  if (!options.activeQueueName || !options.activeQueue.length) {
    return {
      canRun: false,
      status: "empty",
      title: "Queue needs content",
      detail: options.savedDraftCount ? "Queue saved drafts before starting the runner." : "Create saved content before building a queue.",
      primaryAction: { label: options.savedDraftCount ? "Open content" : "New submission", view: options.savedDraftCount ? "saved" : "editor" },
      blockers,
    };
  }

  if (blockers.length) {
    return {
      canRun: false,
      status: "blocked",
      title: "Run blocked",
      detail: blockers[0],
      primaryAction: { label: blockers[0].includes("Tumblr") ? "Manage accounts" : "Open queue", view: blockers[0].includes("Tumblr") ? "accounts" : "queue" },
      blockers,
    };
  }

  return {
    canRun: true,
    status: "ready",
    title: options.submitApproved ? "Ready for live run" : "Ready for test run",
    detail: options.submitApproved ? `${runnableCount} runnable item${runnableCount === 1 ? "" : "s"} can post.` : "Live posting is off; the runner will prepare items for review.",
    primaryAction: { label: "Open runner", view: "runner" },
    blockers: [],
  };
}

export function refillQueueFromReadyDrafts(options: {
  queue: SubmissionQueueItem[];
  sourceAds: Advertisement[];
  submitTargets: TumblrSubmitTarget[];
  queueName: string;
  tumblrAccountId: string;
  targetDepth: number;
  now?: Date;
  cooldownDays?: number;
}): QueueRefillResult {
  const now = options.now ?? new Date();
  const cooldownMs = Math.max(0, options.cooldownDays ?? 14) * 24 * 60 * 60 * 1000;
  const scopedItems = options.queue.filter((item) => item.queueName === options.queueName);
  const activeDepth = activeQueueItems(scopedItems).length;
  const needed = Math.max(0, options.targetDepth - activeDepth);
  const addedItems: SubmissionQueueItem[] = [];
  const skippedReasons: string[] = [];

  if (!options.queueName || needed <= 0) {
    return { queue: options.queue, addedItems, skippedReasons };
  }

  const candidates = options.sourceAds.filter((ad) => ad.status === "ready" && isQueueableAdvertisement(ad));
  for (const ad of candidates) {
    if (addedItems.length >= needed) {
      break;
    }

    const target = options.submitTargets.find((item) => item.id === ad.destinationBlog) ?? fallbackTarget(ad.destinationBlog);
    if (hasRecentOrActiveMatch([...options.queue, ...addedItems], ad.id, target.id, options.queueName, now, cooldownMs)) {
      skippedReasons.push(`${ad.title || ad.id} recently ran for ${target.name}.`);
      continue;
    }

    const item = createQueueItem(ad, target, buildPreparedPost(ad), options.queueName, options.tumblrAccountId);
    addedItems.push({
      ...item,
      id: `${item.id}-refill-${now.getTime()}-${addedItems.length + 1}`,
      notes: "Auto-added to keep this queue stocked after a completed submission.",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  return {
    queue: addedItems.length ? [...addedItems, ...options.queue] : options.queue,
    addedItems,
    skippedReasons,
  };
}

function hasRecentOrActiveMatch(
  items: SubmissionQueueItem[],
  adId: string,
  targetId: string,
  queueName: string,
  now: Date,
  cooldownMs: number,
) {
  return items.some((item) => {
    if (item.queueName !== queueName || item.adId !== adId || item.targetId !== targetId) {
      return false;
    }
    if (!isCompletedQueueItem(item)) {
      return true;
    }
    const completedAt = item.postedAt || item.updatedAt || item.createdAt;
    return cooldownMs > 0 && now.getTime() - new Date(completedAt).getTime() < cooldownMs;
  });
}

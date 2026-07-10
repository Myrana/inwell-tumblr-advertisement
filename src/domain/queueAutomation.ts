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
  scheduledCanRun: boolean;
  status: "ready" | "blocked" | "empty" | "review";
  title: string;
  detail: string;
  primaryAction: {
    label: string;
    view: WorkspaceView;
  };
  blockers: string[];
};

export type RunnerExecutionReadiness = {
  ready: boolean;
  manualCanRun: boolean;
  scheduledCanRun: boolean;
  title: string;
  detail: string;
};

export type QueueRefillResult = {
  queue: SubmissionQueueItem[];
  addedItems: SubmissionQueueItem[];
  skippedReasons: string[];
};

export const defaultAutomationRefillTargetDepth = 3;

export type PreparedAutomationQueue = {
  addedCount: number;
  attentionCount: number;
  queue: SubmissionQueueItem[];
  readyCount: number;
};

export type AutomationQueuePreparationResult =
  | {
      status: "ready";
      preparedQueue: PreparedAutomationQueue;
    }
  | {
      status: "blocked";
      message: string;
      reconciledQueue?: SubmissionQueueItem[];
      savedItems?: SubmissionQueueItem[];
    };

export type PrepareAutomationQueueForRunOptions = {
  allowWithoutRunnable?: boolean;
  queue: SubmissionQueueItem[];
  sourceAds: Advertisement[];
  submitTargets: TumblrSubmitTarget[];
  queueName: string;
  tumblrAccountId: string;
  targetDepth?: number;
  saveQueueItem: (item: SubmissionQueueItem) => Promise<SubmissionQueueItem | null>;
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

export function automationRunnableQueueItems(items: SubmissionQueueItem[]) {
  return items.filter((item) => item.status === "queued" || item.status === "scheduled");
}

export function runnableQueueItems(items: SubmissionQueueItem[]) {
  return automationRunnableQueueItems(items);
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
  scheduledRunnerReady?: boolean;
  scheduledRunnerDetail?: string;
  accountBlocker?: string;
  selectedConnectedAccount?: boolean;
  savedDraftCount: number;
  submitApproved: boolean;
}): QueueReadiness {
  const executionReadiness = runnerExecutionReadiness({
    activeQueueName: options.activeQueueName,
    activeQueue: options.activeQueue,
    connectedAccountCount: options.connectedAccountCount,
    scheduledRunnerReady: options.scheduledRunnerReady ?? !["Offline", "Needs attention"].includes(options.runnerActivity.status),
    scheduledRunnerDetail: options.scheduledRunnerDetail ?? options.runnerActivity.detail,
    accountBlocker: options.accountBlocker,
    selectedConnectedAccount: options.selectedConnectedAccount,
  });
  const runnableCount = automationRunnableQueueItems(options.activeQueue).length;
  const attentionCount = attentionQueueItems(options.activeQueue).length;
  const blockers: string[] = [];
  const accountReady = options.selectedConnectedAccount ?? options.connectedAccountCount > 0;

  if (!options.activeQueueName) {
    blockers.push("Create or select a queue.");
  }
  if (!options.connectedAccountCount) {
    blockers.push("Connect a Tumblr account.");
  } else if (!accountReady) {
    blockers.push(options.accountBlocker || "Select a connected Tumblr account.");
  }
  if (!runnableCount) {
    blockers.push("Add queued or scheduled submissions.");
  }
  if (!executionReadiness.scheduledCanRun) {
    blockers.push("Start or repair the local runner for scheduled automation.");
  }

  if (attentionCount > 0 && runnableCount === 0) {
    blockers.push("Review failed or needs-review submissions.");
    return {
      canRun: false,
      status: "review",
      title: `${attentionCount} item${attentionCount === 1 ? "" : "s"} need review`,
      detail: "Clear failed or review-needed submissions before relying on automation.",
      primaryAction: { label: "Review queue", view: "queue" },
      scheduledCanRun: false,
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
      scheduledCanRun: false,
      blockers,
    };
  }

  if (!executionReadiness.manualCanRun) {
    const blockerDetail = blockers[0] ?? executionReadiness.detail;
    return {
      canRun: false,
      status: "blocked",
      title: executionReadiness.title,
      detail: blockerDetail,
      primaryAction: { label: blockerDetail.includes("Tumblr") ? "Manage accounts" : "Open queue", view: blockerDetail.includes("Tumblr") ? "accounts" : "queue" },
      scheduledCanRun: false,
      blockers,
    };
  }

  return {
    canRun: true,
    status: executionReadiness.scheduledCanRun ? "ready" : "blocked",
    title: options.submitApproved ? "Ready for live run" : "Ready for test run",
    detail: executionReadiness.scheduledCanRun
      ? options.submitApproved
        ? `${runnableCount} runnable item${runnableCount === 1 ? "" : "s"} can post${attentionCount ? ` while ${attentionCount} item${attentionCount === 1 ? " stays" : "s stay"} in review` : ""}.`
        : `Live posting is off; the runner will prepare runnable items for review${attentionCount ? ` and skip ${attentionCount} review item${attentionCount === 1 ? "" : "s"}` : ""}.`
      : `${options.scheduledRunnerDetail || "Local runner needs attention."} Manual run controls remain available.`,
    primaryAction: { label: "Open runner", view: "runner" },
    scheduledCanRun: executionReadiness.scheduledCanRun,
    blockers: [],
  };
}

export function runnerExecutionReadiness(options: {
  activeQueueName: string;
  activeQueue: SubmissionQueueItem[];
  connectedAccountCount: number;
  scheduledRunnerReady: boolean;
  scheduledRunnerDetail: string;
  accountBlocker?: string;
  selectedAccountName?: string;
  selectedConnectedAccount?: boolean;
}): RunnerExecutionReadiness {
  const runnableCount = automationRunnableQueueItems(options.activeQueue).length;
  const attentionCount = attentionQueueItems(options.activeQueue).length;
  const selectedAccountReady = options.selectedConnectedAccount ?? options.connectedAccountCount > 0;
  const selectedAccountName = options.selectedAccountName || "Selected account";
  const manualCanRun = Boolean(selectedAccountReady && runnableCount > 0);
  const scheduledCanRun = manualCanRun && options.scheduledRunnerReady;

  if (!selectedAccountReady) {
    return {
      ready: false,
      manualCanRun: false,
      scheduledCanRun: false,
      title: "Automation needs a selected Tumblr account",
      detail: options.accountBlocker || "Choose a connected account before starting queue automation.",
    };
  }
  if (attentionCount > 0 && runnableCount === 0) {
    return {
      ready: false,
      manualCanRun: false,
      scheduledCanRun: false,
      title: "Automation needs queue review",
      detail: `Clear ${attentionCount} failed or review-needed item${attentionCount === 1 ? "" : "s"} before running ${options.activeQueueName || "the selected queue"}.`,
    };
  }
  if (runnableCount === 0) {
    return {
      ready: false,
      manualCanRun: false,
      scheduledCanRun: false,
      title: "Automation needs queued advertisements",
      detail: `Add ready advertisements to ${options.activeQueueName || "the selected queue"} before starting the runner.`,
    };
  }
  if (!options.scheduledRunnerReady) {
    return {
      ready: false,
      manualCanRun: true,
      scheduledCanRun: false,
      title: "Automation needs local runner recovery",
      detail: options.scheduledRunnerDetail,
    };
  }
  return {
    ready: true,
    manualCanRun: true,
    scheduledCanRun: true,
    title: "Automation is ready to watch the queue",
    detail: `${selectedAccountName} can run ${runnableCount} queued advertisement${runnableCount === 1 ? "" : "s"}${attentionCount ? ` while ${attentionCount} item${attentionCount === 1 ? " stays" : "s stay"} in review` : ""}.`,
  };
}

export function automationQueueRunStatusMessage(addedCount: number, attentionCount: number) {
  const refillMessage = addedCount
    ? `Auto-filled ${addedCount} ready ad${addedCount === 1 ? "" : "s"} before running. `
    : "";
  const attentionMessage = attentionCount
    ? `Skipping ${attentionCount} failed or review-needed item${attentionCount === 1 ? "" : "s"}; runnable items can continue. `
    : "";
  return `${refillMessage}${attentionMessage}`;
}

export async function prepareAutomationQueueForRun(options: PrepareAutomationQueueForRunOptions): Promise<AutomationQueuePreparationResult> {
  const refill = refillQueueFromReadyDrafts({
    queue: options.queue,
    sourceAds: options.sourceAds,
    submitTargets: options.submitTargets,
    queueName: options.queueName,
    tumblrAccountId: options.tumblrAccountId,
    targetDepth: options.targetDepth ?? defaultAutomationRefillTargetDepth,
  });
  const savedItems: SubmissionQueueItem[] = [];

  for (const item of refill.addedItems) {
    const saved = await options.saveQueueItem(item);
    if (!saved) {
      const savedCount = savedItems.length;
      const prefix = savedCount
        ? `Auto-filled ${savedCount} item${savedCount === 1 ? "" : "s"}, but `
        : "Auto-fill ";
      return {
        status: "blocked",
        message: `${prefix}stopped before ${item.targetName} because the queue item could not be saved.`,
        reconciledQueue: savedItems.length ? [...savedItems, ...options.queue] : options.queue,
        savedItems,
      };
    }
    savedItems.push(saved);
  }

  const persistedQueue = savedItems.length ? [...savedItems, ...options.queue] : options.queue;
  const activeQueue = persistedQueue.filter((item) => item.queueName === options.queueName);
  const readyItems = runnableQueueItems(activeQueue);
  const reviewItems = attentionQueueItems(activeQueue);

  if (!readyItems.length && reviewItems.length && !options.allowWithoutRunnable) {
    return {
      status: "blocked",
      message: "Only failed or needs-review submissions are in this queue. Review or requeue one item, or add ready ads for auto-fill.",
    };
  }
  if (!readyItems.length && !options.allowWithoutRunnable) {
    return {
      status: "blocked",
      message: savedItems.length ? "Auto-fill ran, but no runnable queue items were saved." : "Add ready ads or queued targets before starting the runner.",
    };
  }

  return {
    status: "ready",
    preparedQueue: {
      addedCount: savedItems.length,
      attentionCount: reviewItems.length,
      queue: persistedQueue,
      readyCount: readyItems.length,
    },
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
  const activeDepth = automationRunnableQueueItems(scopedItems).length;
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

import { isQueueableAdvertisement, queueEligibilityBlockers } from "./adEligibility";
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

export type QueueRefillPreview = {
  availableCount: number;
  candidateAdIds: string[];
  candidateCount: number;
  candidateLabels: string[];
  neededCount: number;
  skippedReasons: string[];
  state: "no-queue" | "at-capacity" | "needs-refill";
};

type QueueRefillPlanCandidate = {
  advertisement: Advertisement;
  label: string;
  target: TumblrSubmitTarget;
};

type QueueRefillPlan = {
  availableCount: number;
  candidateAdIds: string[];
  candidateCount: number;
  candidateLabels: string[];
  candidates: QueueRefillPlanCandidate[];
  neededCount: number;
  skippedReasons: string[];
  state: QueueRefillPreview["state"];
};

export type QueueFlowSummary = {
  automation: {
    detail: string;
    label: string;
    tone: "ready" | "warning" | "blocked";
  };
  emptyReasons: string[];
  healthStats: Array<{
    detail: string;
    label: string;
    tone: "ready" | "warning" | "blocked" | "neutral";
    value: string;
  }>;
  lanes: {
    attention: SubmissionQueueItem[];
    history: SubmissionQueueItem[];
    runnable: SubmissionQueueItem[];
    running: SubmissionQueueItem[];
  };
  latestCompletion: SubmissionQueueItem | null;
  refillActivity: string;
  statusLabels: Record<SubmissionStatus, string>;
  timeline: Array<{
    detail: string;
    label: string;
    tone: "ready" | "warning" | "blocked" | "neutral";
    value: string;
  }>;
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

export const queueLifecycleStatusLabels: Record<SubmissionStatus, string> = {
  queued: "Ready",
  scheduled: "Scheduled",
  running: "Runner active",
  submitted: "Submitted",
  posted: "Posted",
  "needs-review": "Needs review",
  failed: "Failed",
};

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

export function previewQueueRefillFromReadyDrafts(options: {
  queue: SubmissionQueueItem[];
  sourceAds: Advertisement[];
  submitTargets: TumblrSubmitTarget[];
  queueName: string;
  targetDepth: number;
  now?: Date;
  cooldownDays?: number;
}): QueueRefillPreview {
  const plan = planQueueRefillFromReadyDrafts(options);
  return {
    availableCount: plan.availableCount,
    candidateAdIds: plan.candidateAdIds,
    candidateCount: plan.candidateCount,
    candidateLabels: plan.candidateLabels,
    neededCount: plan.neededCount,
    skippedReasons: plan.skippedReasons,
    state: plan.state,
  };
}

function planQueueRefillFromReadyDrafts(options: {
  queue: SubmissionQueueItem[];
  sourceAds: Advertisement[];
  submitTargets: TumblrSubmitTarget[];
  queueName: string;
  targetDepth: number;
  now?: Date;
  cooldownDays?: number;
}): QueueRefillPlan {
  const now = options.now ?? new Date();
  const cooldownMs = Math.max(0, options.cooldownDays ?? 14) * 24 * 60 * 60 * 1000;
  const scopedItems = options.queue.filter((item) => item.queueName === options.queueName);
  const activeDepth = automationRunnableQueueItems(scopedItems).length;
  const needed = Math.max(0, options.targetDepth - activeDepth);
  const candidates: QueueRefillPlanCandidate[] = [];
  const skippedReasons: string[] = [];

  if (!options.queueName) {
    return {
      availableCount: 0,
      candidateAdIds: [],
      candidateCount: 0,
      candidateLabels: [],
      candidates,
      neededCount: 0,
      skippedReasons,
      state: "no-queue",
    };
  }

  const previewItems: SubmissionQueueItem[] = [];
  const sourceCandidates = options.sourceAds.filter((ad) => ad.status === "ready" && isQueueableAdvertisement(ad));
  for (const ad of sourceCandidates) {
    if (needed > 0 && candidates.length >= needed) {
      break;
    }

    const target = options.submitTargets.find((item) => item.id === ad.destinationBlog) ?? fallbackTarget(ad.destinationBlog);
    if (hasRecentOrActiveMatch([...options.queue, ...previewItems], ad.id, target.id, options.queueName, now, cooldownMs)) {
      skippedReasons.push(`${ad.title || ad.id} recently ran for ${target.name}.`);
      continue;
    }

    const label = ad.title || ad.id;
    candidates.push({ advertisement: ad, label, target });
    previewItems.push(displayOnlyQueueMatch(ad, target, options.queueName, now));
  }

  return {
    availableCount: Math.min(candidates.length, needed),
    candidateAdIds: candidates.map((candidate) => candidate.advertisement.id),
    candidateCount: candidates.length,
    candidateLabels: candidates.map((candidate) => candidate.label),
    candidates,
    neededCount: needed,
    skippedReasons,
    state: needed > 0 ? "needs-refill" : "at-capacity",
  };
}

export function queueFlowSummary(options: {
  activeQueueName: string;
  activeQueue: SubmissionQueueItem[];
  queueScheduleEnabled: boolean;
  runnerDetail: string;
  runnerReady: boolean;
  savedDraftCount: number;
  selectedConnectedAccount: boolean;
  sourceAds: Advertisement[];
  submitTargets: TumblrSubmitTarget[];
  targetDepth?: number;
  now?: Date;
}): QueueFlowSummary {
  const counts = queueStatusCounts(options.activeQueue);
  const lanes = queueFlowLanes(options.activeQueue);
  const latestCompletion = latestCompletedQueueItem(lanes.history);
  const refillItems = options.activeQueue.filter((item) => item.notes.toLowerCase().includes("auto-added") || item.id.includes("-refill-"));
  const readyAds = options.sourceAds.filter((ad) => ad.status === "ready" && !ad.archived);
  const eligibleReadyAds = readyAds.filter(isQueueableAdvertisement);
  const ineligibleReadyAds = readyAds.filter((ad) => !isQueueableAdvertisement(ad));
  const missingTargetAds = eligibleReadyAds.filter((ad) => {
    const target = options.submitTargets.find((item) => item.id === ad.destinationBlog) ?? fallbackTarget(ad.destinationBlog);
    return !target.submitUrl;
  });
  const refillPreview = previewQueueRefillFromReadyDrafts({
    queue: options.activeQueue,
    sourceAds: options.sourceAds,
    submitTargets: options.submitTargets,
    queueName: options.activeQueueName,
    targetDepth: options.targetDepth ?? defaultAutomationRefillTargetDepth,
    now: options.now,
  });
  const emptyReasons = queueEmptyReasons({
    activeQueueName: options.activeQueueName,
    attentionCount: lanes.attention.length,
    ineligibleReadyAds,
    missingTargetAds,
    queueScheduleEnabled: options.queueScheduleEnabled,
    refillAvailableCount: refillPreview.availableCount,
    refillSkippedReasons: refillPreview.skippedReasons,
    runnableCount: lanes.runnable.length,
    runnerDetail: options.runnerDetail,
    runnerReady: options.runnerReady,
    savedDraftCount: options.savedDraftCount,
    selectedConnectedAccount: options.selectedConnectedAccount,
  });

  return {
    automation: queueAutomationState({
      attentionCount: lanes.attention.length,
      emptyReasons,
      queueScheduleEnabled: options.queueScheduleEnabled,
      runnableCount: lanes.runnable.length,
      runnerReady: options.runnerReady,
      selectedConnectedAccount: options.selectedConnectedAccount,
    }),
    emptyReasons,
    healthStats: queueHealthStats(lanes, refillPreview, latestCompletion),
    lanes,
    latestCompletion,
    refillActivity: queueRefillActivity(refillItems, refillPreview, options.activeQueueName, emptyReasons),
    statusLabels: queueLifecycleStatusLabels,
    timeline: queueFlowTimeline(counts, refillItems.length, refillPreview),
  };
}

export function queueRefillAvailabilityPreview(options: {
  queue: SubmissionQueueItem[];
  sourceAds: Advertisement[];
  submitTargets: TumblrSubmitTarget[];
  queueName: string;
  targetDepth?: number;
  now?: Date;
  cooldownDays?: number;
}) {
  return previewQueueRefillFromReadyDrafts({
    queue: options.queue,
    sourceAds: options.sourceAds,
    submitTargets: options.submitTargets,
    queueName: options.queueName,
    targetDepth: options.targetDepth ?? defaultAutomationRefillTargetDepth,
    now: options.now,
    cooldownDays: options.cooldownDays,
  });
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
  const plan = planQueueRefillFromReadyDrafts({
    queue: options.queue,
    sourceAds: options.sourceAds,
    submitTargets: options.submitTargets,
    queueName: options.queueName,
    targetDepth: options.targetDepth,
    now,
    cooldownDays: options.cooldownDays,
  });
  const addedItems: SubmissionQueueItem[] = [];

  for (const candidate of plan.candidates.slice(0, plan.availableCount)) {
    const item = createQueueItem(candidate.advertisement, candidate.target, buildPreparedPost(candidate.advertisement), options.queueName, options.tumblrAccountId);
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
    skippedReasons: plan.skippedReasons,
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

function queueEmptyReasons(options: {
  activeQueueName: string;
  attentionCount: number;
  ineligibleReadyAds: Advertisement[];
  missingTargetAds: Advertisement[];
  queueScheduleEnabled: boolean;
  refillAvailableCount: number;
  refillSkippedReasons: string[];
  runnableCount: number;
  runnerDetail: string;
  runnerReady: boolean;
  savedDraftCount: number;
  selectedConnectedAccount: boolean;
}) {
  const reasons: string[] = [];
  if (!options.activeQueueName) {
    reasons.push("Select or create a queue before automation can run.");
  }
  if (!options.selectedConnectedAccount) {
    reasons.push("Choose a connected Tumblr account for runner work.");
  }
  if (!options.runnerReady) {
    reasons.push(options.runnerDetail || "Start the local runner so watcher automation can see this queue.");
  }
  if (!options.queueScheduleEnabled) {
    reasons.push("Daily automation is disabled for this queue.");
  }
  if (!options.runnableCount) {
    if (options.refillAvailableCount) {
      reasons.push(`${options.refillAvailableCount} ready ad${options.refillAvailableCount === 1 ? "" : "s"} can refill this queue after automation runs.`);
    } else if (options.refillSkippedReasons.length) {
      reasons.push(options.refillSkippedReasons[0]);
    } else if (options.ineligibleReadyAds.length) {
      const blocker = queueEligibilityBlockers(options.ineligibleReadyAds[0])[0] || "Ready ads need required fields before queueing.";
      reasons.push(blocker);
    } else if (options.savedDraftCount) {
      reasons.push("Saved drafts exist, but none are ready and eligible for queue refill.");
    } else {
      reasons.push("No saved ads are ready for queue refill.");
    }
  }
  if (options.missingTargetAds.length) {
    reasons.push(`${options.missingTargetAds.length} ready ad${options.missingTargetAds.length === 1 ? " has" : "s have"} no matching submit target saved.`);
  }
  if (options.attentionCount) {
    reasons.push(`${options.attentionCount} failed or needs-review item${options.attentionCount === 1 ? " is" : "s are"} parked for manual review.`);
  }
  return Array.from(new Set(reasons)).slice(0, 5);
}

function queueFlowLanes(items: SubmissionQueueItem[]) {
  return {
    attention: attentionQueueItems(items),
    history: completedQueueItems(items),
    runnable: automationRunnableQueueItems(items),
    running: items.filter((item) => item.status === "running"),
  };
}

function latestCompletedQueueItem(items: SubmissionQueueItem[]) {
  return [...items].sort((left, right) => completionTime(right).localeCompare(completionTime(left)))[0] ?? null;
}

function queueAutomationState(options: {
  attentionCount: number;
  emptyReasons: string[];
  queueScheduleEnabled: boolean;
  runnableCount: number;
  runnerReady: boolean;
  selectedConnectedAccount: boolean;
}): QueueFlowSummary["automation"] {
  const automationReady = options.queueScheduleEnabled && options.runnerReady && options.selectedConnectedAccount && options.runnableCount > 0;
  if (automationReady) {
    return {
      label: "Automation ready",
      detail: `${options.runnableCount} runnable item${options.runnableCount === 1 ? "" : "s"} can run${
        options.attentionCount ? ` while ${options.attentionCount} item${options.attentionCount === 1 ? " stays" : "s stay"} parked` : ""
      }.`,
      tone: "ready",
    };
  }
  if (options.queueScheduleEnabled) {
    return {
      label: "Automation waiting",
      detail: options.emptyReasons[0] || "Automation needs runnable queue work.",
      tone: "blocked",
    };
  }
  return {
    label: "Automation off",
    detail: "Daily automation is disabled for this queue.",
    tone: "warning",
  };
}

function queueHealthStats(
  lanes: QueueFlowSummary["lanes"],
  refillPreview: QueueRefillPreview,
  latestCompletion: SubmissionQueueItem | null,
): QueueFlowSummary["healthStats"] {
  return [
    {
      label: "Runnable",
      value: String(lanes.runnable.length),
      detail: lanes.runnable.length ? "Queued or scheduled for the runner." : "No runnable work is ready.",
      tone: lanes.runnable.length ? "ready" : "warning",
    },
    {
      label: "Running",
      value: String(lanes.running.length),
      detail: lanes.running.length ? "Currently with the runner." : "No active runner item.",
      tone: lanes.running.length ? "ready" : "neutral",
    },
    {
      label: "Review",
      value: String(lanes.attention.length),
      detail: lanes.attention.length ? "Parked until reviewed." : "No attention items.",
      tone: lanes.attention.length ? "blocked" : "ready",
    },
    {
      label: "Ready ads",
      value: String(refillPreview.availableCount || (refillPreview.neededCount === 0 ? refillPreview.candidateCount : 0)),
      detail: refillPreview.availableCount
        ? "Available to refill this queue."
        : refillPreview.state === "at-capacity" && refillPreview.candidateCount
          ? "Queue is stocked; ready ads can refill when capacity opens."
        : refillPreview.skippedReasons[0] || "No eligible ready ads.",
      tone: refillPreview.availableCount || (refillPreview.state === "at-capacity" && refillPreview.candidateCount) ? "ready" : "warning",
    },
    {
      label: "Last completion",
      value: latestCompletion ? queueLifecycleStatusLabels[latestCompletion.status] : "None",
      detail: latestCompletion ? latestCompletion.targetName : "No submitted or posted item yet.",
      tone: latestCompletion ? "ready" : "neutral",
    },
  ];
}

function queueRefillActivity(
  refillItems: SubmissionQueueItem[],
  refillPreview: QueueRefillPreview,
  activeQueueName: string,
  emptyReasons: string[],
) {
  if (refillItems.length) {
    return `Latest refill added ${refillItems[0].targetName || "a replacement"} to keep ${activeQueueName || "this queue"} stocked.`;
  }
  if (refillPreview.availableCount) {
    return `${refillPreview.availableCount} ready ad${refillPreview.availableCount === 1 ? "" : "s"} can refill this queue.`;
  }
  if (refillPreview.state === "at-capacity") {
    return refillPreview.candidateCount
      ? `${activeQueueName || "This queue"} is stocked; ${refillPreview.candidateCount} ready ad${refillPreview.candidateCount === 1 ? "" : "s"} can refill when capacity opens.`
      : `${activeQueueName || "This queue"} is stocked to target depth.`;
  }
  return emptyReasons[0] || "No refill activity yet.";
}

function queueFlowTimeline(counts: QueueStatusCounts, refillItemCount: number, refillPreview: QueueRefillPreview): QueueFlowSummary["timeline"] {
  const replacementCount = refillItemCount || refillPreview.availableCount || (refillPreview.state === "at-capacity" ? refillPreview.candidateCount : 0);
  const replacementDetail = refillItemCount
    ? "Backend refill has added queue work."
    : refillPreview.availableCount
      ? "Backend refill can add queue work."
      : refillPreview.state === "at-capacity"
        ? "Queue is already stocked to target depth."
        : "No ready replacement is available yet.";

  return [
    {
      label: "Ready",
      value: String(counts.queued + counts.scheduled),
      detail: "Queued or scheduled items the runner can pick up.",
      tone: counts.queued + counts.scheduled ? "ready" : "warning",
    },
    {
      label: "Running",
      value: String(counts.running),
      detail: "Items currently opened by the runner.",
      tone: counts.running ? "ready" : "neutral",
    },
    {
      label: "Completed",
      value: String(counts.submitted + counts.posted),
      detail: "Submitted or posted items moved into history.",
      tone: counts.submitted + counts.posted ? "ready" : "neutral",
    },
    {
      label: "Replacement",
      value: String(replacementCount),
      detail: replacementDetail,
      tone: replacementCount ? "ready" : "warning",
    },
  ];
}

function displayOnlyQueueMatch(
  advertisement: Advertisement,
  target: TumblrSubmitTarget,
  queueName: string,
  now: Date,
): SubmissionQueueItem {
  const timestamp = now.toISOString();
  return {
    id: `preview:${advertisement.id}:${target.id}`,
    adId: advertisement.id,
    targetId: target.id,
    targetName: target.name,
    tumblrAccountId: "",
    queueName,
    submitUrl: target.submitUrl,
    postType: advertisement.postType,
    status: "queued",
    scheduledFor: "",
    timezone: "America/New_York",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastRunAt: "",
    postedAt: "",
    failedAt: "",
    notes: "Display-only refill preview.",
    runnerPayload: "",
  };
}

function completionTime(item: SubmissionQueueItem) {
  return item.postedAt || item.updatedAt || item.createdAt;
}

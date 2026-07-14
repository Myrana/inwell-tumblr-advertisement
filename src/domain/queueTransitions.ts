import { activeQueueItems, refillQueueFromReadyDrafts } from "./queueAutomation";
import { Advertisement, SubmissionQueueItem, SubmissionStatus, TumblrSubmitTarget } from "./types";

export type QueueTransition = {
  nextQueue: SubmissionQueueItem[];
  refillItems: SubmissionQueueItem[];
  updatedItems: SubmissionQueueItem[];
};

export function buildQueueItemUpdate(
  item: SubmissionQueueItem,
  status: SubmissionStatus,
  notes: string,
  timestamp: string,
): SubmissionQueueItem {
  return {
    ...item,
    status,
    notes,
    updatedAt: timestamp,
    lastRunAt: status === "running" ? timestamp : status === "queued" ? "" : item.lastRunAt,
    postedAt: status === "posted" ? timestamp : status === "queued" ? "" : item.postedAt,
    failedAt: status === "failed" ? timestamp : status === "queued" ? "" : item.failedAt,
  };
}

export function buildQueueTransition(options: {
  currentQueue: SubmissionQueueItem[];
  ids: string[];
  notes: string;
  sourceAds: Advertisement[];
  status: SubmissionStatus;
  submitTargets: TumblrSubmitTarget[];
  timestamp: string;
  tumblrAccountId: string;
}): QueueTransition {
  const selectedIds = new Set(options.ids);
  const updatedItems: SubmissionQueueItem[] = [];
  let nextQueue = options.currentQueue.map((item) => {
    if (!selectedIds.has(item.id)) {
      return item;
    }
    const nextItem = buildQueueItemUpdate(item, options.status, options.notes, options.timestamp);
    updatedItems.push(nextItem);
    return nextItem;
  });
  const refillItems: SubmissionQueueItem[] = [];

  if (options.status !== "posted" && options.status !== "submitted") {
    return { nextQueue, updatedItems, refillItems };
  }

  const completedQueueNames = [...new Set(updatedItems.map((item) => item.queueName))];
  completedQueueNames.forEach((queueName) => {
    const completedItems = updatedItems
      .filter((item) => item.queueName === queueName);
    const completedTargetIds = completedItems
      .map((item) => item.targetId);
    const targetDepth = Math.max(1, activeQueueItems(options.currentQueue.filter((item) => item.queueName === queueName)).length);
    const refill = refillQueueFromReadyDrafts({
      queue: nextQueue,
      sourceAds: options.sourceAds,
      submitTargets: options.submitTargets,
      queueName,
      tumblrAccountId: options.tumblrAccountId,
      targetDepth,
      targetIds: completedTargetIds,
      now: new Date(options.timestamp),
    });
    nextQueue = refill.queue;
    refillItems.push(...refill.addedItems);

    const requeuedItems = requeueCompletedTargetSlots({
      completedItems,
      filledTargetSlots: targetSlotCounts(refill.addedItems),
      timestamp: options.timestamp,
    });
    nextQueue = requeuedItems.length ? [...requeuedItems, ...nextQueue] : nextQueue;
    refillItems.push(...requeuedItems);
  });
  return { nextQueue, updatedItems, refillItems };
}

function requeueCompletedTargetSlots(options: {
  completedItems: SubmissionQueueItem[];
  filledTargetSlots: Map<string, number>;
  timestamp: string;
}) {
  const requeuedItems: SubmissionQueueItem[] = [];
  for (const completedItem of options.completedItems) {
    const targetSlotKey = queueTargetSlotKey(completedItem.queueName, completedItem.targetId);
    const filledCount = options.filledTargetSlots.get(targetSlotKey) ?? 0;
    if (filledCount > 0) {
      options.filledTargetSlots.set(targetSlotKey, filledCount - 1);
      continue;
    }
    requeuedItems.push({
      ...completedItem,
      id: `${completedItem.id}-requeue-${new Date(options.timestamp).getTime()}-${requeuedItems.length + 1}`,
      status: "queued",
      scheduledFor: "",
      createdAt: options.timestamp,
      updatedAt: options.timestamp,
      lastRunAt: "",
      postedAt: "",
      failedAt: "",
      notes: "Auto-requeued after successful submission to keep this target in rotation.",
    });
  }
  return requeuedItems;
}

function targetSlotCounts(items: SubmissionQueueItem[]) {
  return items.reduce((counts, item) => {
    const key = queueTargetSlotKey(item.queueName, item.targetId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
}

function queueTargetSlotKey(queueName: string, targetId: string) {
  return `${queueName}\u0000${targetId}`;
}

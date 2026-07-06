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
    const targetDepth = Math.max(1, activeQueueItems(options.currentQueue.filter((item) => item.queueName === queueName)).length);
    const refill = refillQueueFromReadyDrafts({
      queue: nextQueue,
      sourceAds: options.sourceAds,
      submitTargets: options.submitTargets,
      queueName,
      tumblrAccountId: options.tumblrAccountId,
      targetDepth,
      now: new Date(options.timestamp),
    });
    nextQueue = refill.queue;
    refillItems.push(...refill.addedItems);
  });
  return { nextQueue, updatedItems, refillItems };
}

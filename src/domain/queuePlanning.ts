import { queueEligibilityBlockers } from "./adEligibility";
import { buildPreparedPost } from "./post";
import { createQueueItem } from "./queue";
import { Advertisement, SubmissionQueueItem, TumblrSubmitTarget } from "./types";

export type QueueTargetPlan =
  | { status: "missing-queue"; message: string }
  | { status: "validation-error"; validation: string[] }
  | { status: "ready"; items: SubmissionQueueItem[] };

export function planQueueTargetAdditions(params: {
  ad: Advertisement;
  queueName: string;
  targets: TumblrSubmitTarget[];
  tumblrAccountId: string;
}): QueueTargetPlan {
  if (!params.queueName) {
    return { status: "missing-queue", message: "Create a queue before adding submissions." };
  }

  const validation = queueEligibilityBlockers(params.ad);
  if (validation.length) {
    return { status: "validation-error", validation };
  }

  return {
    status: "ready",
    items: params.targets.map((target) =>
      createQueueItem(params.ad, target, buildPreparedPost(params.ad), params.queueName, params.tumblrAccountId),
    ),
  };
}

export function applyQueueTargetReplacements(params: {
  adId: string;
  currentQueue: SubmissionQueueItem[];
  nextItems: SubmissionQueueItem[];
  queueName: string;
}) {
  const withoutExisting = params.currentQueue.filter(
    (item) =>
      item.queueName !== params.queueName ||
      item.adId !== params.adId ||
      !params.nextItems.some((next) => next.targetId === item.targetId),
  );
  return [...params.nextItems, ...withoutExisting];
}

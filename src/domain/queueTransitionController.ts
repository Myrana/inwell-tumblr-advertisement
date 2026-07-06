import type { QueueCommitResult } from "./queueCommit";
import type { SubmissionQueueItem } from "./types";

export function queueTransitionLockScopes(queue: SubmissionQueueItem[], ids: string[]) {
  const selectedIds = new Set(ids);
  const queueNames = new Set(
    queue
      .filter((item) => selectedIds.has(item.id))
      .map((item) => item.queueName),
  );
  if (queueNames.size) {
    return [...queueNames].map((queueName) => `queue:${queueName}`);
  }
  return ids.map((id) => `item:${id}`);
}

export function queueCommitFailureMessage(result: Extract<QueueCommitResult, { ok: false }>) {
  if (result.kind !== "partial") {
    return "Could not save queue update. Try again.";
  }
  const savedCount = result.savedItems.length;
  const failedLabel = result.failedItem.targetName || result.failedItem.adId || result.failedItem.id;
  const reloadMessage = result.reloaded
    ? "The queue was reloaded from the backend before retry."
    : "The backend queue could not be reloaded, so refresh before retrying.";
  return `Saved ${savedCount} queue change${savedCount === 1 ? "" : "s"}, but syncing stopped before ${failedLabel}. ${reloadMessage}`;
}

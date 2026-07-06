import { SubmissionQueueItem } from "./types";
import { QueueTransition } from "./queueTransitions";

export type QueueCommitResult =
  | { ok: true; kind: "success"; savedItems: SubmissionQueueItem[] }
  | {
      ok: false;
      kind: "failed" | "partial";
      failedItem: SubmissionQueueItem;
      reloadAttempted: boolean;
      reloaded: boolean;
      savedItems: SubmissionQueueItem[];
    };

type QueueCommitOptions = {
  backendOwnsWorkspaceState: boolean;
  reconcileBackendQueueAfterPartialSave: () => Promise<boolean>;
  setSubmissionQueue: (items: SubmissionQueueItem[]) => void;
  syncQueueItem: (item: SubmissionQueueItem) => Promise<SubmissionQueueItem | null>;
  transition: QueueTransition;
};

export async function commitQueueTransitionWithPersistence({
  backendOwnsWorkspaceState,
  reconcileBackendQueueAfterPartialSave,
  setSubmissionQueue,
  syncQueueItem,
  transition,
}: QueueCommitOptions): Promise<QueueCommitResult> {
  if (!transition.updatedItems.length) {
    return { ok: true, kind: "success", savedItems: [] };
  }

  const transitionItems = [...transition.updatedItems, ...transition.refillItems];
  if (!backendOwnsWorkspaceState) {
    setSubmissionQueue(transition.nextQueue);
    transitionItems.forEach((item) => {
      void syncQueueItem(item);
    });
    return { ok: true, kind: "success", savedItems: transitionItems };
  }

  const savedItems: SubmissionQueueItem[] = [];
  for (const item of transitionItems) {
    const saved = await syncQueueItem(item);
    if (!saved) {
      const reloadAttempted = savedItems.length > 0;
      const reloaded = reloadAttempted ? await reconcileBackendQueueAfterPartialSave() : false;
      return {
        ok: false,
        kind: savedItems.length ? "partial" : "failed",
        failedItem: item,
        reloadAttempted,
        reloaded,
        savedItems,
      };
    }
    savedItems.push(saved);
  }

  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  setSubmissionQueue(transition.nextQueue.map((item) => savedById.get(item.id) ?? item));
  return { ok: true, kind: "success", savedItems };
}

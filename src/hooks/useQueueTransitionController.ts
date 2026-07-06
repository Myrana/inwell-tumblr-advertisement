import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { commitQueueTransitionWithPersistence } from "../domain/queueCommit";
import { buildQueueItemUpdate, buildQueueTransition } from "../domain/queueTransitions";
import { normalizeStoredState } from "../domain/ads";
import {
  queueCommitFailureMessage,
  queueTransitionLockScopes,
} from "../domain/queueTransitionController";
import type {
  StoredState,
  SubmissionQueueItem,
  SubmissionStatus,
  TumblrSubmitTarget,
} from "../domain/types";

type QueueTransitionControllerOptions = {
  backendOwnsWorkspaceState: boolean;
  loadBackendQueue: () => Promise<SubmissionQueueItem[]>;
  setApiAvailable: (available: boolean) => void;
  setQueueStatus: (message: string) => void;
  setSubmissionQueue: Dispatch<SetStateAction<SubmissionQueueItem[]>>;
  startRunner: (options?: { allowWithoutRunnable?: boolean; submit?: boolean }) => Promise<void>;
  stored: StoredState;
  submissionQueue: SubmissionQueueItem[];
  submitTargets: TumblrSubmitTarget[];
  syncQueueItem: (item: SubmissionQueueItem) => Promise<SubmissionQueueItem | null>;
  tumblrAccountId: string;
};

export function useQueueTransitionController({
  backendOwnsWorkspaceState,
  loadBackendQueue,
  setApiAvailable,
  setQueueStatus,
  setSubmissionQueue,
  startRunner,
  stored,
  submissionQueue,
  submitTargets,
  syncQueueItem,
  tumblrAccountId,
}: QueueTransitionControllerOptions) {
  const inFlightScopesRef = useRef<Set<string>>(new Set());
  const [busyScopes, setBusyScopes] = useState<string[]>([]);

  function lockScopesFor(ids: string[]) {
    return queueTransitionLockScopes(submissionQueue, ids);
  }

  function lockScopes(scopes: string[]) {
    const inFlightScopes = inFlightScopesRef.current;
    if (scopes.some((scope) => inFlightScopes.has(scope))) {
      return false;
    }
    scopes.forEach((scope) => inFlightScopes.add(scope));
    setBusyScopes([...inFlightScopes]);
    setQueueStatus("Queue update in progress for this queue.");
    return true;
  }

  function unlockScopes(scopes: string[]) {
    const inFlightScopes = inFlightScopesRef.current;
    scopes.forEach((scope) => inFlightScopes.delete(scope));
    setBusyScopes([...inFlightScopes]);
  }

  async function reconcileBackendQueueAfterPartialSave() {
    try {
      const backendQueue = await loadBackendQueue();
      setSubmissionQueue(backendQueue);
      setApiAvailable(true);
      return true;
    } catch {
      setApiAvailable(false);
      return false;
    }
  }

  async function commitTransition(transition: ReturnType<typeof buildQueueTransition>) {
    return commitQueueTransitionWithPersistence({
      backendOwnsWorkspaceState,
      reconcileBackendQueueAfterPartialSave,
      setSubmissionQueue,
      syncQueueItem,
      transition,
    });
  }

  async function updateQueueItem(id: string, status: SubmissionStatus, notes: string) {
    const scopes = lockScopesFor([id]);
    if (!lockScopes(scopes)) {
      setQueueStatus("Queue update already in progress for that submission.");
      return null;
    }
    try {
      const transition = buildQueueTransition({
        currentQueue: submissionQueue,
        ids: [id],
        notes,
        sourceAds: normalizeStoredState(stored).ads,
        status,
        submitTargets,
        timestamp: new Date().toISOString(),
        tumblrAccountId,
      });
      const committed = await commitTransition(transition);
      if (!committed.ok) {
        setQueueStatus(queueCommitFailureMessage(committed));
        return null;
      }
      if (transition.refillItems.length) {
        setQueueStatus(
          `Marked submission ${status}. Auto-added ${transition.refillItems.length} replacement${
            transition.refillItems.length === 1 ? "" : "s"
          } to keep ${transition.refillItems[0].queueName} stocked.`,
        );
      } else {
        setQueueStatus(`Marked submission ${status}.`);
      }
      return transition.updatedItems[0] ?? null;
    } finally {
      unlockScopes(scopes);
    }
  }

  async function bulkUpdateQueueItems(ids: string[], status: SubmissionStatus, notes: string) {
    const scopes = lockScopesFor(ids);
    if (!lockScopes(scopes)) {
      setQueueStatus("Queue update already in progress for one or more selected submissions.");
      return;
    }
    try {
      const transition = buildQueueTransition({
        currentQueue: submissionQueue,
        ids,
        notes,
        sourceAds: normalizeStoredState(stored).ads,
        status,
        submitTargets,
        timestamp: new Date().toISOString(),
        tumblrAccountId,
      });
      const committed = await commitTransition(transition);
      if (!committed.ok) {
        setQueueStatus(queueCommitFailureMessage(committed));
        return;
      }

      setQueueStatus(
        `Updated ${transition.updatedItems.length} queued submission${transition.updatedItems.length === 1 ? "" : "s"}.${
          transition.refillItems.length ? ` Auto-added ${transition.refillItems.length} replacement${transition.refillItems.length === 1 ? "" : "s"}.` : ""
        }`,
      );
    } finally {
      unlockScopes(scopes);
    }
  }

  async function retryQueueItemTestRun(id: string) {
    const scopes = lockScopesFor([id]);
    if (!lockScopes(scopes)) {
      setQueueStatus("Queue update already in progress for that submission.");
      return;
    }
    try {
      const existingItem = submissionQueue.find((item) => item.id === id);
      const queuedItem = existingItem ? buildQueueItemUpdate(existingItem, "queued", "Requeued for a dry-run recovery attempt.", new Date().toISOString()) : null;
      const savedItem = queuedItem ? await syncQueueItem(queuedItem) : null;
      if (!savedItem) {
        setQueueStatus("Could not save the requeued submission before retrying. Try again.");
        return;
      }
      setQueueStatus("Starting a recovery test run. It will prepare Tumblr without submitting.");
      await startRunner({ allowWithoutRunnable: true, submit: false });
    } finally {
      unlockScopes(scopes);
    }
  }

  return {
    bulkUpdateQueueItems,
    busyScopes,
    isQueueBusy: (queueName: string) => busyScopes.includes(`queue:${queueName}`),
    retryQueueItemTestRun,
    updateQueueItem,
  };
}

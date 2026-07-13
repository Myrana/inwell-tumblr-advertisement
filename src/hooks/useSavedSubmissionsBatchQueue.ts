import { useCallback, useEffect, useRef, useState } from "react";
import { QueueDraftResult } from "./useEditorQueueActions";
import { Advertisement, QueueDefinition } from "../domain/types";

type SavedSubmissionsBatchQueuePreview = {
  queueName: string;
  readyDrafts: Advertisement[];
  skippedDrafts: Advertisement[];
};

type QueueDraftFailure = Extract<QueueDraftResult, { ok: false }>;
type QueueDraftFailureReason = QueueDraftFailure["reason"];

type BatchQueueDraftOutcome = {
  status: "failed" | "not-attempted";
  reason: string;
};

type UseSavedSubmissionsBatchQueueOptions = {
  activeQueueName: string;
  onBatchQueued: () => void;
  onQueueDraft: (id: string, queueName: string, navigate?: boolean) => Promise<QueueDraftResult>;
  queueOptions: QueueDefinition[];
  queueableAdIds: Set<string>;
};

type UseSavedSubmissionsBatchQueueResult = {
  batchQueueDraftOutcomes: Record<string, BatchQueueDraftOutcome>;
  batchQueueError: string;
  batchQueueName: string;
  batchQueuePending: boolean;
  batchPreview: SavedSubmissionsBatchQueuePreview | null;
  cancelBatchPreview: () => void;
  confirmBatchQueue: () => Promise<void>;
  previewQueueDrafts: (drafts: Advertisement[]) => void;
  setBatchQueueName: (queueName: string) => void;
};

function joinCountWord(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function useSavedSubmissionsBatchQueue({
  activeQueueName,
  onBatchQueued,
  onQueueDraft,
  queueOptions,
  queueableAdIds,
}: UseSavedSubmissionsBatchQueueOptions): UseSavedSubmissionsBatchQueueResult {
  const [batchQueueName, setBatchQueueName] = useState(activeQueueName || queueOptions[0]?.name || "");
  const [batchPreview, setBatchPreview] = useState<SavedSubmissionsBatchQueuePreview | null>(null);
  const [batchQueuePending, setBatchQueuePending] = useState(false);
  const [batchQueueDraftOutcomes, setBatchQueueDraftOutcomes] = useState<Record<string, BatchQueueDraftOutcome>>({});
  const [batchQueueError, setBatchQueueError] = useState("");
  const batchTriggerRef = useRef<HTMLElement | null>(null);
  const batchConfirmInFlightRef = useRef(false);

  const resolveQueueName = useCallback((candidate: string) => {
    const activeMatch = queueOptions.find((queue) => queue.name === activeQueueName)?.name;
    const candidateMatch = queueOptions.find((queue) => queue.name === candidate)?.name;
    return candidateMatch || activeMatch || queueOptions[0]?.name || "";
  }, [activeQueueName, queueOptions]);

  function reasonLabel(reason: QueueDraftFailureReason) {
    switch (reason) {
      case "missing-queue":
        return "Queue missing";
      case "validation-error":
        return "Validation blocked";
      case "ad-not-found":
        return "Draft missing";
      case "queue-save-failed":
        return "Queue write failed";
      case "queue-empty":
        return "Nothing was queued";
      default:
        return "Unable to queue";
    }
  }

  function formatFailureMessage(result: QueueDraftFailure, draftLabel: string) {
    const base = `${reasonLabel(result.reason)} for ${draftLabel}.`;
    if (!result.message) {
      return base;
    }
    return `${base} ${result.message}`;
  }

  function formatBatchQueueError(error: unknown, draftLabel: string) {
    const rawMessage = error instanceof Error ? error.message : `${error ?? ""}`.trim();
    const fallback = `Could not queue ${draftLabel}.`;
    return rawMessage ? `${fallback} ${rawMessage}` : fallback;
  }

  function formatFailureSummary(successCount: number, outcomes: Record<string, BatchQueueDraftOutcome>) {
    const failureLabels = Object.values(outcomes).filter((outcome) => outcome.status === "failed");
    const notAttemptedLabels = Object.values(outcomes).filter((outcome) => outcome.status === "not-attempted");
    const summaryParts: string[] = [];
    if (successCount > 0) {
      summaryParts.push(`${joinCountWord(successCount, "advertisement")} queued before the batch stopped.`);
    } else {
      summaryParts.push("No advertisements were queued before the batch stopped.");
    }
    summaryParts.push(`${joinCountWord(failureLabels.length + notAttemptedLabels.length, "advertisement")} need retry.`);
    const primaryFailure = failureLabels[0];
    if (primaryFailure) {
      summaryParts.push(primaryFailure.reason);
    }
    return summaryParts.join(" ");
  }

  function buildFailureOutcomes(
    failedDraft: Advertisement,
    failedReason: string,
    failedIndex: number,
    readyDrafts: Advertisement[],
  ) {
    const outcomes: Record<string, BatchQueueDraftOutcome> = {
      [failedDraft.id]: { status: "failed", reason: failedReason },
    };
    for (let nextIndex = failedIndex + 1; nextIndex < readyDrafts.length; nextIndex += 1) {
      const draft = readyDrafts[nextIndex];
      outcomes[draft.id] = {
        status: "not-attempted",
        reason: `Could not attempt after earlier ${failedDraft.title || failedDraft.id} queue failure.`,
      };
    }
    return outcomes;
  }

  function recordBatchFailure(
    failedDraft: Advertisement,
    failedReason: string,
    failedIndex: number,
    successCount: number,
    readyDrafts: Advertisement[],
  ) {
    const failureOutcomes = buildFailureOutcomes(failedDraft, failedReason, failedIndex, readyDrafts);
    setBatchQueueDraftOutcomes(failureOutcomes);
    setBatchQueueError(formatFailureSummary(successCount, failureOutcomes));
    setBatchPreview((current) => (current ? { ...current, readyDrafts: current.readyDrafts.slice(failedIndex) } : null));
  }

  function previewQueueDrafts(drafts: Advertisement[]) {
    const queueName = resolveQueueName(batchQueueName);
    if (!queueName) {
      setBatchQueueError("Could not open batch queue preview: queue destination is unavailable.");
      return;
    }

    batchTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBatchPreview({
      queueName,
      readyDrafts: drafts.filter((draft) => queueableAdIds.has(draft.id)),
      skippedDrafts: drafts.filter((draft) => !queueableAdIds.has(draft.id)),
    });
    setBatchQueueDraftOutcomes({});
    setBatchQueueError("");
  }

  function cancelBatchPreview() {
    setBatchPreview(null);
    setBatchQueueDraftOutcomes({});
    setBatchQueueError("");
    window.setTimeout(() => batchTriggerRef.current?.focus(), 0);
  }

  async function confirmBatchQueue() {
    if (!batchPreview || batchConfirmInFlightRef.current) return;

    const destinationQueueName = resolveQueueName(batchPreview.queueName);
    if (!destinationQueueName) {
      setBatchQueueError("Could not queue batch: destination queue is unavailable.");
      return;
    }

    batchConfirmInFlightRef.current = true;
    setBatchQueuePending(true);
    setBatchQueueError("");
    setBatchQueueDraftOutcomes({});

    try {
      let successfulQueuedCount = 0;
      for (let index = 0; index < batchPreview.readyDrafts.length; index += 1) {
        const draft = batchPreview.readyDrafts[index];
        try {
          const result = await onQueueDraft(draft.id, destinationQueueName, false);
          if (result.ok) {
            successfulQueuedCount += 1;
            continue;
          }

          const draftLabel = draft.title || draft.id;
          const failureReason = formatFailureMessage(result, draftLabel);
          recordBatchFailure(draft, failureReason, index, successfulQueuedCount, batchPreview.readyDrafts);
          return;
        } catch (error) {
          const draftLabel = draft.title || draft.id;
          const failureReason = `Queueing failed before ${draftLabel} could be fully processed. ${formatBatchQueueError(error, draftLabel)}`;
          recordBatchFailure(draft, failureReason, index, successfulQueuedCount, batchPreview.readyDrafts);
          return;
        }
      }

      setBatchQueueDraftOutcomes({});
      setBatchQueueError("");
      setBatchPreview(null);
      onBatchQueued();
    } finally {
      setBatchQueuePending(false);
      batchConfirmInFlightRef.current = false;
    }
  }

  useEffect(() => {
    setBatchQueueName((current) => resolveQueueName(current));
  }, [activeQueueName, queueOptions, resolveQueueName]);

  useEffect(() => {
    setBatchPreview((current) => {
      if (!current) {
        return current;
      }

      const selectedQueueName = batchQueueName || current.queueName;
      const nextQueueName = resolveQueueName(selectedQueueName);
      return nextQueueName === current.queueName ? current : { ...current, queueName: nextQueueName };
    });
  }, [batchQueueName, activeQueueName, queueOptions, resolveQueueName]);

  return {
    batchQueueDraftOutcomes,
    batchQueueError,
    batchQueueName,
    batchQueuePending,
    batchPreview,
    cancelBatchPreview,
    confirmBatchQueue,
    previewQueueDrafts,
    setBatchQueueName,
  };
}

import { applyQueueTargetReplacements, planQueueTargetAdditions } from "../domain/queuePlanning";
import { fallbackTarget } from "../domain/submitTargets";
import {
  Advertisement,
  RunnerSettings,
  StoredState,
  SubmissionQueueItem,
  TumblrSubmitTarget,
} from "../domain/types";

type UseEditorQueueActionsParams = {
  activeAd: Advertisement;
  activeQueueName: string;
  activeView: string;
  runnerSettings: RunnerSettings;
  stored: StoredState;
  submitTargets: TumblrSubmitTarget[];
  syncQueueItem: (item: SubmissionQueueItem) => Promise<SubmissionQueueItem | null>;
  setActiveView: (view: "editor" | "queue" | "queue-settings") => void;
  setEditorQueueConfirmation: (confirmation: { count: number; queueName: string } | null) => void;
  setQueueStatus: (status: string) => void;
  setSelectedQueueName: (queueName: string) => void;
  setStored: (updater: (current: StoredState) => StoredState) => void;
  setSubmissionQueue: (updater: (current: SubmissionQueueItem[]) => SubmissionQueueItem[]) => void;
  setValidation: (validation: string[]) => void;
};

export type QueueDraftResult =
  | { ok: true }
  | {
    ok: false;
    reason: "missing-queue" | "validation-error" | "ad-not-found" | "queue-save-failed" | "queue-empty";
    message?: string;
  };

export function useEditorQueueActions({
  activeAd,
  activeQueueName,
  activeView,
  runnerSettings,
  stored,
  submitTargets,
  syncQueueItem,
  setActiveView,
  setEditorQueueConfirmation,
  setQueueStatus,
  setSelectedQueueName,
  setStored,
  setSubmissionQueue,
  setValidation,
}: UseEditorQueueActionsParams) {
  async function queueTargets(targets: TumblrSubmitTarget[]) {
    const plan = planQueueTargetAdditions({
      ad: activeAd,
      queueName: activeQueueName,
      targets,
      tumblrAccountId: runnerSettings.tumblrAccountId,
    });

    if (plan.status === "missing-queue") {
      setQueueStatus(plan.message);
      setActiveView("queue-settings");
      return;
    }
    if (plan.status === "validation-error") {
      setValidation(plan.validation);
      return;
    }

    const queueTargetLabel = activeAd.title || targets[0]?.name || "ad";

    let failed = false;
    let successfulQueuedTargets = 0;

    for (const item of plan.items) {
      try {
        const savedItem = await syncQueueItem(item);
        if (!savedItem) {
          failed = true;
          setQueueStatus(`Could not queue ${queueTargetLabel}. Please try again.`);
          break;
        }

        setSubmissionQueue((current) =>
          applyQueueTargetReplacements({
            adId: activeAd.id,
            currentQueue: current,
            nextItems: [savedItem],
            queueName: activeQueueName,
          }),
        );
        successfulQueuedTargets += 1;
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : `${error ?? "Unknown error"}`;
        setQueueStatus(`Could not queue ${queueTargetLabel}. ${message}`);
        break;
      }
    }

    if (failed) {
      if (successfulQueuedTargets > 0) {
        setQueueStatus(`Queued ${successfulQueuedTargets} target${successfulQueuedTargets === 1 ? "" : "s"} before the queue operation failed.`);
      }
      return;
    }

    const queuedTargetCount = plan.items.length;
    setQueueStatus(`Queued ${queuedTargetCount} target${queuedTargetCount === 1 ? "" : "s"} in ${activeQueueName}.`);

    if (activeView === "editor") {
      setEditorQueueConfirmation({ count: queuedTargetCount, queueName: activeQueueName });
      return;
    }
  }

  async function queueSavedDraft(id: string, queueName = activeQueueName, navigate = true): Promise<QueueDraftResult> {
    const ad = stored.ads.find((item) => item.id === id);
    if (!ad) {
      return { ok: false, reason: "ad-not-found" };
    }

    const shouldNavigate = navigate !== false;
    const target = submitTargets.find((item) => item.id === ad.destinationBlog) ?? fallbackTarget(ad.destinationBlog);
    const plan = planQueueTargetAdditions({
      ad,
      queueName,
      targets: [target],
      tumblrAccountId: runnerSettings.tumblrAccountId,
    });

    if (plan.status === "missing-queue") {
      setQueueStatus(plan.message);
      if (shouldNavigate) {
        setActiveView("queue-settings");
      }
      return { ok: false, reason: "missing-queue", message: plan.message };
    }
    if (plan.status === "validation-error") {
      if (shouldNavigate) {
        setStored((current) => ({ ...current, activeAdId: id }));
        setValidation(plan.validation);
        setActiveView("editor");
      }
      return {
        ok: false,
        reason: "validation-error",
        message: plan.validation.join(". "),
      };
    }

    const queueLabel = ad.title || target.name;
    const savedItems: SubmissionQueueItem[] = [];
    for (const item of plan.items) {
      try {
        const savedItem = await syncQueueItem(item);
        if (!savedItem) {
          setQueueStatus(`Could not queue ${queueLabel}. Please try again.`);
          return { ok: false, reason: "queue-save-failed", message: "Could not save queue item." };
        }
        savedItems.push(savedItem);
      } catch (error) {
        const message = error instanceof Error ? error.message : `${error ?? "Unknown error"}`;
        setQueueStatus(`Could not queue ${queueLabel}. ${message}`);
        return { ok: false, reason: "queue-save-failed", message };
      }
    }

    if (!savedItems.length) {
      setQueueStatus(`Could not queue ${queueLabel}. Try again.`);
      return { ok: false, reason: "queue-empty", message: "Nothing was queued." };
    }
    setSubmissionQueue((current) => applyQueueTargetReplacements({
      adId: ad.id,
      currentQueue: current,
      nextItems: savedItems.filter((item): item is SubmissionQueueItem => Boolean(item)),
      queueName,
    }));
    setSelectedQueueName(queueName);
    setQueueStatus(`Queued ${ad.title || target.name} in ${queueName}.`);
    if (shouldNavigate) setActiveView("queue");
    return { ok: true };
  }

  return {
    queueSavedDraft,
    queueTargets,
  };
}

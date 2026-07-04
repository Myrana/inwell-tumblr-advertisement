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
  syncQueueItem: (item: SubmissionQueueItem) => void;
  setActiveView: (view: "editor" | "queue" | "queue-settings") => void;
  setEditorQueueConfirmation: (confirmation: { count: number; queueName: string } | null) => void;
  setQueueStatus: (status: string) => void;
  setSelectedQueueName: (queueName: string) => void;
  setStored: (updater: (current: StoredState) => StoredState) => void;
  setSubmissionQueue: (updater: (current: SubmissionQueueItem[]) => SubmissionQueueItem[]) => void;
  setValidation: (validation: string[]) => void;
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
  function queueTargets(targets: TumblrSubmitTarget[]) {
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

    setSubmissionQueue((current) => {
      return applyQueueTargetReplacements({
        adId: activeAd.id,
        currentQueue: current,
        nextItems: plan.items,
        queueName: activeQueueName,
      });
    });
    plan.items.forEach(syncQueueItem);
    setQueueStatus(`Queued ${plan.items.length} target${plan.items.length === 1 ? "" : "s"} in ${activeQueueName}.`);
    if (activeView === "editor") {
      setEditorQueueConfirmation({ count: plan.items.length, queueName: activeQueueName });
    }
  }

  function queueSavedDraft(id: string, queueName = activeQueueName) {
    const ad = stored.ads.find((item) => item.id === id);
    if (!ad) {
      return;
    }
    const target = submitTargets.find((item) => item.id === ad.destinationBlog) ?? fallbackTarget(ad.destinationBlog);
    const plan = planQueueTargetAdditions({
      ad,
      queueName,
      targets: [target],
      tumblrAccountId: runnerSettings.tumblrAccountId,
    });

    if (plan.status === "missing-queue") {
      setQueueStatus(plan.message);
      setActiveView("queue-settings");
      return;
    }
    if (plan.status === "validation-error") {
      setStored((current) => ({ ...current, activeAdId: id }));
      setValidation(plan.validation);
      setActiveView("editor");
      return;
    }

    setSubmissionQueue((current) => {
      return applyQueueTargetReplacements({
        adId: ad.id,
        currentQueue: current,
        nextItems: plan.items,
        queueName,
      });
    });
    plan.items.forEach(syncQueueItem);
    setSelectedQueueName(queueName);
    setQueueStatus(`Queued ${ad.title || target.name} in ${queueName}.`);
    setActiveView("queue");
  }

  return {
    queueSavedDraft,
    queueTargets,
  };
}

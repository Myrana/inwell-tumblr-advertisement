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

  async function queueSavedDraft(id: string, queueName = activeQueueName, navigate = true) {
    const ad = stored.ads.find((item) => item.id === id);
    if (!ad) {
      return false;
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
      return false;
    }
    if (plan.status === "validation-error") {
      setStored((current) => ({ ...current, activeAdId: id }));
      setValidation(plan.validation);
      setActiveView("editor");
      return false;
    }

    const savedItems = await Promise.all(plan.items.map(syncQueueItem));
    if (savedItems.some((item) => !item)) {
      setQueueStatus(`Could not queue ${ad.title || target.name}. Try again.`);
      return false;
    }
    setSubmissionQueue((current) => applyQueueTargetReplacements({
      adId: ad.id,
      currentQueue: current,
      nextItems: savedItems.filter((item): item is SubmissionQueueItem => Boolean(item)),
      queueName,
    }));
    setSelectedQueueName(queueName);
    setQueueStatus(`Queued ${ad.title || target.name} in ${queueName}.`);
    if (navigate) setActiveView("queue");
    return true;
  }

  return {
    queueSavedDraft,
    queueTargets,
  };
}

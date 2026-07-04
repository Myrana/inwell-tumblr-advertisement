import { useState } from "react";
import { TumblrSubmitTarget } from "../domain/types";

export function useQueuePreview() {
  const [previewTargets, setPreviewTargets] = useState<TumblrSubmitTarget[]>([]);

  function openPreview(targets: TumblrSubmitTarget[]) {
    const nextTargets = targets.filter((target) => target.id && target.submitUrl);
    if (!nextTargets.length) {
      return;
    }
    setPreviewTargets(nextTargets);
  }

  function clearPreview() {
    setPreviewTargets([]);
  }

  return {
    clearPreview,
    openPreview,
    previewTargets,
  };
}

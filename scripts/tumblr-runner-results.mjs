import fs from "node:fs/promises";

export function recordTargetResult(targetResults, item, result) {
  targetResults.push({
    id: item.id,
    targetName: item.targetName,
    status: normalizeRunnerTargetStatus(result?.status),
  });
}

export function recordFailedTargetResult(targetResults, item) {
  targetResults.push({
    id: item.id,
    targetName: item.targetName,
    status: "failed",
  });
}

export async function collectRunnerTargetResults(items, runItem, onItemError = async () => undefined) {
  const targetResults = [];
  const reviewPages = [];
  let failureCount = 0;
  let firstFailureMessage = "";

  for (const item of items) {
    try {
      const result = await runItem(item);
      recordTargetResult(targetResults, item, result);
      if (result?.readyForReview && result.page) {
        reviewPages.push(result.page);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failureCount += 1;
      if (!firstFailureMessage) {
        firstFailureMessage = message;
      }
      await onItemError(item, error, message);
      recordFailedTargetResult(targetResults, item);
    }
  }

  return { targetResults, reviewPages, failureCount, firstFailureMessage };
}

export function normalizeRunnerTargetStatus(status) {
  return ["submitted", "completed", "needs-review", "failed"].includes(status) ? status : "unknown";
}

export async function writeRunnerResult(options, result, log = console.log) {
  if (!options.resultPath) {
    return;
  }
  await fs.writeFile(options.resultPath, JSON.stringify(result, null, 2), "utf8").catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`[runner] Could not write runner result file; local companion will treat target results as unknown. ${message}`);
  });
}

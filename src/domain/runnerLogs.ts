import { RunnerLog, SubmissionQueueItem } from "./types";

export type QueueLogGroup = {
  item: SubmissionQueueItem;
  logs: RunnerLog[];
};

export type RunnerLogRunGroup = {
  id: string;
  runId: string;
  logs: RunnerLog[];
  latestAt: string;
  targetNames: string[];
  targetSummaries: RunnerLogTargetSummary[];
  warningCount: number;
  errorCount: number;
  failureExplanations: string[];
};

export type RunnerLogTargetSummary = {
  id: string;
  name: string;
  status: "ready" | "submitted" | "failed" | "needs-review" | "running";
  latestAt: string;
  explanation: string;
};

export function latestRunnerRunId(logs: RunnerLog[]) {
  return logs.find((log) => log.runId)?.runId ?? "";
}

export function visibleRunnerLogs(logs: RunnerLog[], showHistory: boolean) {
  if (showHistory) {
    return logs;
  }

  const runId = latestRunnerRunId(logs);
  if (!runId) {
    return logs;
  }

  return logs.filter((log) => log.runId === runId);
}

export function queueLogGroups(queue: SubmissionQueueItem[], logs: RunnerLog[]): QueueLogGroup[] {
  return queue.map((item) => ({
    item,
    logs: logs.filter((log) => log.queueItemId === item.id),
  }));
}

export function runnerLogsOutsideQueue(queue: SubmissionQueueItem[], logs: RunnerLog[]) {
  const queueIds = new Set(queue.map((item) => item.id));
  return logs.filter((log) => !queueIds.has(log.queueItemId));
}

export function displayLogTarget(log: RunnerLog, queue: SubmissionQueueItem[]) {
  return log.targetName || queue.find((item) => item.id === log.queueItemId)?.targetName || "Queue item";
}

export function runnerLogRunGroups(logs: RunnerLog[]): RunnerLogRunGroup[] {
  const groups = new Map<string, RunnerLogRunGroup>();

  logs.forEach((log) => {
    const groupId = log.runId || "untracked-run";
    const targetName = log.targetName.trim();
    const existing = groups.get(groupId);

    if (existing) {
      existing.logs.push(log);
      if (targetName && !existing.targetNames.includes(targetName)) {
        existing.targetNames.push(targetName);
      }
      existing.warningCount += log.level === "warning" ? 1 : 0;
      existing.errorCount += log.level === "error" ? 1 : 0;
      const explanation = runnerLogExplanation(log);
      if (explanation && !existing.failureExplanations.includes(explanation)) {
        existing.failureExplanations.push(explanation);
      }
      existing.targetSummaries = runnerLogTargetSummaries(existing.logs);
      return;
    }

    const explanation = runnerLogExplanation(log);
    groups.set(groupId, {
      id: groupId,
      runId: log.runId,
      logs: [log],
      latestAt: log.createdAt,
      targetNames: targetName ? [targetName] : [],
      targetSummaries: runnerLogTargetSummaries([log]),
      warningCount: log.level === "warning" ? 1 : 0,
      errorCount: log.level === "error" ? 1 : 0,
      failureExplanations: explanation ? [explanation] : [],
    });
  });

  return Array.from(groups.values());
}

export function runnerLogTargetSummaries(logs: RunnerLog[]): RunnerLogTargetSummary[] {
  const byTarget = new Map<string, RunnerLog[]>();

  logs.forEach((log) => {
    const key = log.targetName || log.queueItemId || "Queue item";
    byTarget.set(key, [...(byTarget.get(key) ?? []), log]);
  });

  return Array.from(byTarget.entries()).map(([target, targetLogs]) => {
    const failedLog = targetLogs.find((log) => log.level === "error");
    const warningLog = targetLogs.find((log) => log.level === "warning");
    const submittedLog = targetLogs.find((log) => /submit button clicked|submitted/i.test(log.message));
    const readyLog = targetLogs.find((log) => /ready for manual review/i.test(log.message));
    const runningLog = targetLogs.find((log) => /opening|launched|filled/i.test(log.message));
    const selectedLog = failedLog ?? warningLog ?? submittedLog ?? readyLog ?? runningLog ?? targetLogs[0];
    const explanation = failedLog || warningLog ? runnerLogExplanation(selectedLog) : "";

    return {
      id: target,
      name: target,
      status: failedLog ? "failed" : warningLog ? "needs-review" : submittedLog ? "submitted" : readyLog ? "ready" : "running",
      latestAt: targetLogs[0]?.createdAt ?? "",
      explanation,
    };
  });
}

export function runnerLogExplanation(log: RunnerLog) {
  if (log.level !== "error" && log.level !== "warning") {
    return "";
  }

  const detailExplanation = stringDetail(log.details, "explanation") || stringDetail(log.details, "error");
  const message = detailExplanation || log.message;
  const normalized = message.toLowerCase();

  if (normalized.includes("captcha") || normalized.includes("login") || normalized.includes("log in")) {
    return "Tumblr asked for login, captcha, terms, or another manual checkpoint.";
  }
  if (normalized.includes("post type") || normalized.includes("photo")) {
    return "Tumblr did not expose the expected photo post controls.";
  }
  if (normalized.includes("browser") || normalized.includes("target page") || normalized.includes("new tab")) {
    return "The Playwright browser or tab closed before the runner finished.";
  }
  if (normalized.includes("submit button")) {
    return "The runner could not find a submit button after filling the form.";
  }

  return message || "The runner needs manual review before this item can continue.";
}

function stringDetail(details: Record<string, unknown>, key: string) {
  const value = details[key];
  return typeof value === "string" ? value.trim() : "";
}

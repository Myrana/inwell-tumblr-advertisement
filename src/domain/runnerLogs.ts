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
  warningCount: number;
  errorCount: number;
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
      return;
    }

    groups.set(groupId, {
      id: groupId,
      runId: log.runId,
      logs: [log],
      latestAt: log.createdAt,
      targetNames: targetName ? [targetName] : [],
      warningCount: log.level === "warning" ? 1 : 0,
      errorCount: log.level === "error" ? 1 : 0,
    });
  });

  return Array.from(groups.values());
}

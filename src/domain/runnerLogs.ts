import { RunnerLog, SubmissionQueueItem } from "./types";

export type QueueLogGroup = {
  item: SubmissionQueueItem;
  logs: RunnerLog[];
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

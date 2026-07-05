export type ScheduleRunnerReadiness = {
  ready: boolean;
  status: "ready" | "offline" | "needs-attention" | "idle" | "wrong-queue";
  label: string;
  detail: string;
};

type ScheduleLocalCompanionStatus = {
  ok: boolean;
  queueName: string;
  watching: boolean;
  running: boolean;
  status: string;
  lastError: string;
};

type ScheduleRunnerState = {
  local_runner?: {
    online: boolean;
    queue_name: string;
    watching: boolean;
    status: string;
  };
};

function runnerQueueMismatch(activeQueueName: string, runnerQueueName: string) {
  return Boolean(activeQueueName && runnerQueueName && runnerQueueName !== activeQueueName);
}

function readyScheduleRunner(activeQueueName: string): ScheduleRunnerReadiness {
  return {
    ready: true,
    status: "ready",
    label: "On",
    detail: activeQueueName ? `Ready for scheduled runs in ${activeQueueName}.` : "Ready for scheduled runs.",
  };
}

function wrongQueueScheduleRunner(activeQueueName: string, runnerQueueName: string): ScheduleRunnerReadiness {
  return {
    ready: false,
    status: "wrong-queue",
    label: "Wrong queue",
    detail: `Local runner is watching ${runnerQueueName}. Switch it to ${activeQueueName || "the selected queue"} before the daily run.`,
  };
}

export function scheduleRunnerReadinessFromState(options: {
  activeQueueName: string;
  offlineDetail: string;
  localCompanion: ScheduleLocalCompanionStatus | null;
  runnerState: ScheduleRunnerState | null;
}): ScheduleRunnerReadiness {
  const { activeQueueName, localCompanion, offlineDetail, runnerState } = options;
  if (localCompanion?.ok) {
    const companionQueueName = localCompanion.queueName || "";
    if (localCompanion.status === "error") {
      return {
        ready: false,
        status: "needs-attention",
        label: "Needs attention",
        detail: localCompanion.lastError || "Last local companion run failed. Check Runner controls before the daily run.",
      };
    }
    if (localCompanion.running || localCompanion.watching || localCompanion.status === "watching") {
      return runnerQueueMismatch(activeQueueName, companionQueueName)
        ? wrongQueueScheduleRunner(activeQueueName, companionQueueName)
        : readyScheduleRunner(activeQueueName);
    }
    return {
      ready: false,
      status: "idle",
      label: "Runner idle",
      detail: "Local companion is connected but is not watching this queue. Open Runner controls and start the watcher before the daily run.",
    };
  }

  const localRunner = runnerState?.local_runner;
  if (localRunner?.online) {
    const runnerQueueName = localRunner.queue_name || "";
    const status = localRunner.status || "";
    if (status === "error") {
      return {
        ready: false,
        status: "needs-attention",
        label: "Needs attention",
        detail: "Local runner reported an error. Check Runner controls before the daily run.",
      };
    }
    if (localRunner.watching || status === "watching" || status === "running") {
      return runnerQueueMismatch(activeQueueName, runnerQueueName)
        ? wrongQueueScheduleRunner(activeQueueName, runnerQueueName)
        : readyScheduleRunner(activeQueueName);
    }
    return {
      ready: false,
      status: "idle",
      label: "Runner idle",
      detail: "Local runner is online but is not watching this queue. Open Runner controls and start the watcher before the daily run.",
    };
  }

  return {
    ready: false,
    status: "offline",
    label: "Runner offline",
    detail: offlineDetail,
  };
}

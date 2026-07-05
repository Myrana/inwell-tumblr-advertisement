import assert from "node:assert/strict";
import test from "node:test";
import { scheduleRunnerReadinessFromState } from "../../src/domain/localRunnerReadiness.ts";

const baseRunnerState = {
  running: false,
  pid: null,
  plan_path: "",
  command: [],
  local_runner: {
    online: true,
    last_seen_at: "2026-06-20T01:00:00.000Z",
    workspace_id: "workspace-test",
    queue_name: "Default queue",
    watching: true,
    status: "watching",
    version: "local-runner-test",
  },
};

const baseCompanion = {
  ok: true,
  version: "local-runner-test",
  apiBaseUrl: "https://inkwell-production-f037.up.railway.app/api",
  workspaceId: "workspace-test",
  queueName: "Default queue",
  watching: true,
  running: false,
  status: "watching",
  lastStartedAt: "",
  lastFinishedAt: "",
  lastExitCode: null,
  lastExitSignal: "",
  lastBlockerCode: "",
  lastError: "",
  lastRun: null,
};

function readiness(overrides = {}) {
  return scheduleRunnerReadinessFromState({
    activeQueueName: "Default queue",
    offlineDetail: "Start the local runner on this computer.",
    localCompanion: null,
    runnerState: baseRunnerState,
    ...overrides,
  });
}

test("schedule runner readiness accepts a watcher for the selected queue", () => {
  assert.deepEqual(readiness(), {
    ready: true,
    status: "ready",
    label: "On",
    detail: "Ready for scheduled runs in Default queue.",
  });
});

test("schedule runner readiness blocks backend runner states that are online but idle", () => {
  const result = readiness({
    runnerState: {
      ...baseRunnerState,
      local_runner: {
        ...baseRunnerState.local_runner,
        watching: false,
        status: "idle",
      },
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.status, "idle");
  assert.equal(result.label, "Runner idle");
  assert.match(result.detail, /not watching this queue/);
});

test("schedule runner readiness blocks backend watcher for a different queue", () => {
  const result = readiness({
    runnerState: {
      ...baseRunnerState,
      local_runner: {
        ...baseRunnerState.local_runner,
        queue_name: "Other queue",
      },
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.status, "wrong-queue");
  assert.equal(result.label, "Wrong queue");
  assert.match(result.detail, /Other queue/);
});

test("schedule runner readiness prioritizes local companion idle and error states", () => {
  const idle = readiness({
    localCompanion: {
      ...baseCompanion,
      watching: false,
      status: "idle",
    },
  });
  const error = readiness({
    localCompanion: {
      ...baseCompanion,
      watching: false,
      status: "error",
      lastError: "Runner failed.",
    },
  });

  assert.equal(idle.ready, false);
  assert.equal(idle.status, "idle");
  assert.match(idle.detail, /Local companion is connected/);
  assert.equal(error.ready, false);
  assert.equal(error.status, "needs-attention");
  assert.equal(error.detail, "Runner failed.");
});

test("schedule runner readiness blocks local companion watcher for a different queue", () => {
  const result = readiness({
    localCompanion: {
      ...baseCompanion,
      queueName: "Other queue",
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.status, "wrong-queue");
  assert.match(result.detail, /Switch it to Default queue/);
});

test("schedule runner readiness reports offline when no companion or backend runner is online", () => {
  const result = readiness({
    runnerState: {
      ...baseRunnerState,
      local_runner: {
        ...baseRunnerState.local_runner,
        online: false,
        watching: false,
        status: "offline",
      },
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.status, "offline");
  assert.equal(result.label, "Runner offline");
  assert.equal(result.detail, "Start the local runner on this computer.");
});

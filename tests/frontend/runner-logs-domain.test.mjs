import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadRunnerLogsDomain() {
  const source = await readFile("src/domain/runnerLogs.ts", "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`);
}

function runnerLog(overrides) {
  return {
    id: "log",
    runId: "run-identity",
    queueItemId: "queue-item",
    targetName: "target-blog",
    level: "info",
    message: "Opening target-blog.",
    details: {},
    createdAt: "2026-07-04T12:00:00.000Z",
    ...overrides,
  };
}

test("runner log summaries keep same target name submissions separate by queue item", async () => {
  const { runnerLogRunGroups } = await loadRunnerLogsDomain();

  const [group] = runnerLogRunGroups([
    runnerLog({
      id: "queue-one-open",
      queueItemId: "queue-one",
      targetName: "same-blog",
      message: "Opening same-blog.",
      createdAt: "2026-07-04T12:00:00.000Z",
    }),
    runnerLog({
      id: "queue-two-open",
      queueItemId: "queue-two",
      targetName: "same-blog",
      message: "Opening same-blog.",
      createdAt: "2026-07-04T12:01:00.000Z",
    }),
    runnerLog({
      id: "queue-two-submit",
      queueItemId: "queue-two",
      targetName: "same-blog",
      message: "Submit button clicked.",
      createdAt: "2026-07-04T12:02:00.000Z",
    }),
  ]);

  assert.deepEqual(group.targetSummaries.map((summary) => summary.id), ["queue-one", "queue-two"]);
  assert.deepEqual(group.targetSummaries.map((summary) => summary.name), ["same-blog", "same-blog"]);
  assert.deepEqual(group.targetSummaries.map((summary) => summary.timeline.length), [1, 2]);
  assert.equal(group.targetSummaries[1].status, "submitted");
});

test("runner logs without submission identity use the run-level timeline fallback", async () => {
  const { runnerLogRunGroups } = await loadRunnerLogsDomain();

  const [group] = runnerLogRunGroups([
    runnerLog({
      id: "unscoped-open",
      queueItemId: "",
      targetName: "",
      message: "Runner launched.",
      createdAt: "2026-07-04T12:00:00.000Z",
    }),
    runnerLog({
      id: "unscoped-warning",
      queueItemId: "",
      targetName: "",
      level: "warning",
      message: "Needs manual review.",
      createdAt: "2026-07-04T12:01:00.000Z",
    }),
  ]);

  assert.equal(group.targetSummaries.length, 0);
  assert.deepEqual(group.timeline.map((step) => step.id), ["unscoped-open", "unscoped-warning"]);
  assert.deepEqual(group.timeline.map((step) => step.targetName), ["Queue item", "Queue item"]);
});

test("runner log groups keep unscoped run steps when submission timelines exist", async () => {
  const { runnerLogRunGroups } = await loadRunnerLogsDomain();

  const [group] = runnerLogRunGroups([
    runnerLog({
      id: "run-launched",
      queueItemId: "",
      targetName: "",
      message: "Runner launched.",
      createdAt: "2026-07-04T12:00:00.000Z",
    }),
    runnerLog({
      id: "queue-one-open",
      queueItemId: "queue-one",
      targetName: "same-blog",
      message: "Opening same-blog.",
      createdAt: "2026-07-04T12:01:00.000Z",
    }),
    runnerLog({
      id: "run-complete",
      queueItemId: "",
      targetName: "",
      message: "Runner finished.",
      createdAt: "2026-07-04T12:02:00.000Z",
    }),
  ]);

  assert.deepEqual(group.targetSummaries.map((summary) => summary.id), ["queue-one"]);
  assert.deepEqual(group.targetSummaries[0].timeline.map((step) => step.id), ["queue-one-open"]);
  assert.deepEqual(group.unscopedTimeline.map((step) => step.id), ["run-launched", "run-complete"]);
  assert.deepEqual(group.timeline.map((step) => step.id), ["run-launched", "queue-one-open", "run-complete"]);
});

test("runner log outside-queue detection ignores unscoped run lifecycle logs", async () => {
  const { runnerLogsOutsideQueue } = await loadRunnerLogsDomain();

  const outsideLogs = runnerLogsOutsideQueue(
    [{ id: "queue-one" }],
    [
      runnerLog({ id: "queue-one-open", queueItemId: "queue-one" }),
      runnerLog({ id: "run-launched", queueItemId: "", targetName: "" }),
      runnerLog({ id: "other-queue-open", queueItemId: "queue-two" }),
    ],
  );

  assert.deepEqual(outsideLogs.map((log) => log.id), ["other-queue-open"]);
});

test("runner log screenshot URLs only expose http and https links", async () => {
  const { runnerLogTimeline } = await loadRunnerLogsDomain();

  const steps = runnerLogTimeline([
    runnerLog({ id: "http", details: { screenshotUrl: "http://example.test/screen.png" } }),
    runnerLog({ id: "https", details: { screenshot_url: "https://example.test/screen.png" } }),
    runnerLog({ id: "javascript", details: { screenshotUrl: "javascript:alert(1)" } }),
    runnerLog({ id: "data", details: { screenshotUrl: "data:text/html;base64,PGgxPkE8L2gxPg==" } }),
    runnerLog({ id: "relative", details: { screenshotUrl: "/screenshots/local.png" } }),
  ]);

  assert.deepEqual(
    steps.map((step) => [step.id, step.screenshotUrl]),
    [
      ["http", "http://example.test/screen.png"],
      ["https", "https://example.test/screen.png"],
      ["javascript", ""],
      ["data", ""],
      ["relative", ""],
    ],
  );
});

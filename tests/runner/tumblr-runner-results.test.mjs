import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectRunnerTargetResults,
  normalizeRunnerTargetStatus,
  recordFailedTargetResult,
  recordTargetResult,
  writeRunnerResult,
} from "../../scripts/tumblr-runner-results.mjs";

test("runner result helpers record submitted needs-review and failed target statuses", async () => {
  const targetResults = [];
  recordTargetResult(targetResults, { id: "queue-item-1", targetName: "allthingsroleplay" }, { status: "submitted" });
  recordTargetResult(targetResults, { id: "queue-item-2", targetName: "rpneedsreview" }, { status: "needs-review" });
  recordFailedTargetResult(targetResults, { id: "queue-item-3", targetName: "rpadverts" });

  assert.deepEqual(targetResults, [
    { id: "queue-item-1", targetName: "allthingsroleplay", status: "submitted" },
    { id: "queue-item-2", targetName: "rpneedsreview", status: "needs-review" },
    { id: "queue-item-3", targetName: "rpadverts", status: "failed" },
  ]);

  const resultPath = path.join(os.tmpdir(), `inwell-runner-result-${process.pid}-${Date.now()}.json`);
  try {
    await writeRunnerResult({ resultPath }, { status: "success", targetResults });
    const written = JSON.parse(await fs.readFile(resultPath, "utf8"));
    assert.deepEqual(written.targetResults, targetResults);
  } finally {
    await fs.unlink(resultPath).catch(() => undefined);
  }
});

test("runner target status normalization keeps the runner contract conservative", () => {
  assert.equal(normalizeRunnerTargetStatus("submitted"), "submitted");
  assert.equal(normalizeRunnerTargetStatus("needs-review"), "needs-review");
  assert.equal(normalizeRunnerTargetStatus("failed"), "failed");
  assert.equal(normalizeRunnerTargetStatus("unexpected"), "unknown");

  const targetResults = [];
  recordTargetResult(targetResults, { id: "queue-item-1", targetName: "rpadverts" }, { status: "unexpected" });
  assert.deepEqual(targetResults, [{ id: "queue-item-1", targetName: "rpadverts", status: "unknown" }]);
});

test("runner result collection writes mixed per-target outcomes from runner control flow", async () => {
  const items = [
    { id: "queue-item-1", targetName: "allthingsroleplay" },
    { id: "queue-item-2", targetName: "rpneedsreview" },
    { id: "queue-item-3", targetName: "rpadverts" },
  ];
  const reportedErrors = [];
  const page = { label: "review-page" };

  const result = await collectRunnerTargetResults(
    items,
    async (item) => {
      if (item.id === "queue-item-1") {
        return { status: "submitted" };
      }
      if (item.id === "queue-item-2") {
        return { status: "needs-review", readyForReview: true, page };
      }
      throw new Error("submit failed");
    },
    async (item, error, message) => {
      reportedErrors.push({ id: item.id, message, error: error.message });
    },
  );

  assert.deepEqual(result.targetResults, [
    { id: "queue-item-1", targetName: "allthingsroleplay", status: "submitted" },
    { id: "queue-item-2", targetName: "rpneedsreview", status: "needs-review" },
    { id: "queue-item-3", targetName: "rpadverts", status: "failed" },
  ]);
  assert.deepEqual(result.reviewPages, [page]);
  assert.equal(result.failureCount, 1);
  assert.equal(result.firstFailureMessage, "submit failed");
  assert.deepEqual(reportedErrors, [{ id: "queue-item-3", message: "submit failed", error: "submit failed" }]);
});

test("runner result writes are best-effort and observable when resultPath fails", async () => {
  const logs = [];
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "inwell-runner-result-dir-"));
  try {
    await assert.doesNotReject(() => writeRunnerResult({ resultPath: directoryPath }, { status: "success" }, (message) => logs.push(message)));
    assert.equal(logs.length, 1);
    assert.match(logs[0], /Could not write runner result file/);
    assert.match(logs[0], /target results as unknown/);
  } finally {
    await fs.rmdir(directoryPath).catch(() => undefined);
  }
});

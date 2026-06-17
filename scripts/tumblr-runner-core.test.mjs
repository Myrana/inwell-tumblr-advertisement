import assert from "node:assert/strict";
import test from "node:test";
import {
  dataUrlToBuffer,
  fieldsForItem,
  normalizeRunnerPlan,
  parseArgs,
  shouldPauseForManualAction,
} from "./tumblr-runner-core.mjs";

test("parseArgs accepts a plan and safety defaults", () => {
  const options = parseArgs(["--plan", "queue.json"]);
  assert.equal(options.planPath, "queue.json");
  assert.equal(options.submit, false);
  assert.equal(options.headless, false);
});

test("normalizeRunnerPlan decodes queue item runner payload", () => {
  const plan = normalizeRunnerPlan({
    version: 1,
    workflow: "tumblr-submission-queue",
    items: [
      {
        id: "ad-target",
        targetName: "target",
        submitUrl: "https://example.tumblr.com/submit",
        postType: "photo",
        runnerPayload: JSON.stringify({
          target: { name: "target" },
          advertisement: { postType: "photo", tags: ["one", "two"], imageName: "ad.png" },
          fields: { caption: "<p>Hello</p>", imageDataUrl: "data:image/png;base64,aGVsbG8=" },
        }),
      },
    ],
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].postType, "photo");
  assert.deepEqual(fieldsForItem(plan.items[0]).tags, ["one", "two"]);
});

test("manual action detection catches login and captcha states", () => {
  assert.equal(shouldPauseForManualAction("Please log in to continue"), true);
  assert.equal(shouldPauseForManualAction("Complete this captcha"), true);
  assert.equal(shouldPauseForManualAction("Public submit form"), false);
});

test("dataUrlToBuffer decodes embedded media", () => {
  const decoded = dataUrlToBuffer("data:text/plain;base64,aGVsbG8=");
  assert.equal(decoded?.mimeType, "text/plain");
  assert.equal(decoded?.buffer.toString("utf8"), "hello");
});

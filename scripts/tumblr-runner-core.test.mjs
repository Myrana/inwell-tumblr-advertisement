import assert from "node:assert/strict";
import test from "node:test";
import {
  dataUrlToBuffer,
  fieldsForItem,
  frameCandidateScore,
  normalizeRunnerPlan,
  parseArgs,
  shouldPauseForManualAction,
  summarizeFrames,
} from "./tumblr-runner-core.mjs";

test("parseArgs accepts a plan and safety defaults", () => {
  const options = parseArgs(["--plan", "queue.json", "--no-pause"]);
  assert.equal(options.planPath, "queue.json");
  assert.equal(options.submit, false);
  assert.equal(options.headless, false);
  assert.equal(options.noPause, true);
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

test("frameCandidateScore prefers Tumblr submit iframe", () => {
  const submitFrame = frameCandidateScore({
    name: "submit_form",
    url: "https://www.tumblr.com/submit_form/example.tumblr.com",
    controlCount: 0,
  });
  const themeFrame = frameCandidateScore({
    name: "",
    url: "https://example.tumblr.com/submit",
    controlCount: 3,
  });

  assert.ok(submitFrame > themeFrame);
});

test("summarizeFrames reports blockers and form frames", () => {
  const summary = summarizeFrames([
    {
      name: "",
      title: "Login",
      url: "https://www.tumblr.com/login",
      inputs: 2,
      textareas: 0,
      contenteditable: 0,
      buttons: 1,
      hasLoginText: true,
      hasDeniedText: false,
      hasCaptchaText: false,
      sample: "Log in to continue",
    },
    {
      name: "submit_form",
      title: "Submit",
      url: "https://www.tumblr.com/submit_form/example.tumblr.com",
      inputs: 2,
      textareas: 1,
      contenteditable: 1,
      buttons: 2,
      hasLoginText: false,
      hasDeniedText: false,
      hasCaptchaText: false,
      sample: "Submit a post",
    },
  ]);

  assert.equal(summary.likelyLoggedIn, false);
  assert.equal(summary.blocker, "Log in to continue");
  assert.equal(summary.formFrame?.name, "submit_form");
});

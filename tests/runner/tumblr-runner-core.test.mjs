import assert from "node:assert/strict";
import test from "node:test";
import {
  appearsLoggedInToTumblr,
  dataUrlToBuffer,
  fieldsForItem,
  frameCandidateScore,
  htmlToPlainText,
  loginWaitMessage,
  normalizeRunnerPlan,
  parseArgs,
  postTypeCandidateIndex,
  reviewPagesOpenMessage,
  shouldDeferReadyReview,
  shouldPauseForManualAction,
  summarizeFrames,
} from "../../scripts/tumblr-runner-core.mjs";

test("parseArgs accepts a plan and safety defaults", () => {
  const options = parseArgs(["--plan", "queue.json", "--no-pause"]);
  assert.equal(options.planPath, "queue.json");
  assert.equal(options.submit, false);
  assert.equal(options.headless, false);
  assert.equal(options.loginFirst, false);
  assert.equal(options.noPause, true);
});

test("parseArgs supports same-session login before queue execution", () => {
  const options = parseArgs(["--plan", "queue.json", "--login-first", "--media-dir", "media", "--slow-mo", "125"]);
  assert.equal(options.planPath, "queue.json");
  assert.equal(options.loginFirst, true);
  assert.equal(options.mediaDir, "media");
  assert.equal(options.slowMo, 125);
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
  assert.equal(fieldsForItem(plan.items[0]).title, "");
  assert.match(fieldsForItem(plan.items[0]).bodyHtml, /<p>Hello<\/p>/);
  assert.deepEqual(fieldsForItem(plan.items[0]).tags, ["one", "two"]);
});

test("fieldsForItem includes the saved option name as a title hint", () => {
  const fields = fieldsForItem({
    payload: {
      fields: { body: "Body" },
      advertisement: { savedOptionName: "Saved title", tags: [] },
    },
  });

  assert.equal(fields.title, "Saved title");
});

test("manual action detection catches login and captcha states", () => {
  assert.equal(shouldPauseForManualAction("Please log in to continue"), true);
  assert.equal(shouldPauseForManualAction("Complete this captcha"), true);
  assert.equal(shouldPauseForManualAction("Public submit form"), false);
});

test("Tumblr login detection skips prompt for active dashboard sessions", () => {
  assert.equal(appearsLoggedInToTumblr("Dashboard Following For you Activity Account", "https://www.tumblr.com/dashboard"), true);
  assert.equal(appearsLoggedInToTumblr("Log in to continue", "https://www.tumblr.com/login"), false);
});

test("login wait message does not require an Enter prompt", () => {
  const message = loginWaitMessage(300);
  assert.match(message, /continue automatically/);
  assert.doesNotMatch(message, /Enter/);
});

test("ready queue pages defer review until the full queue is processed", () => {
  assert.equal(shouldDeferReadyReview({ submit: false, headless: false, noPause: false }), true);
  assert.equal(shouldDeferReadyReview({ submit: true, headless: false, noPause: false }), false);
  assert.equal(shouldDeferReadyReview({ submit: false, headless: true, noPause: false }), false);
  assert.equal(shouldDeferReadyReview({ submit: false, headless: false, noPause: true }), false);
});

test("postTypeCandidateIndex prefers the visible unselected requested post type", () => {
  const candidates = [
    { text: "Text", visible: true, selected: true },
    { text: "Text", visible: true, selected: false },
    { text: "Photo", visible: false, selected: false },
    { text: "Photo", visible: true, selected: false },
  ];

  assert.equal(postTypeCandidateIndex(candidates, "photo"), 3);
});

test("review page message keeps browser review controlled by the operator", () => {
  const message = reviewPagesOpenMessage(2);
  assert.match(message, /2 queued pages are open for review/);
  assert.match(message, /close those browser tabs when done/);
  assert.doesNotMatch(message, /Enter/);
});

test("dataUrlToBuffer decodes embedded media", () => {
  const decoded = dataUrlToBuffer("data:text/plain;base64,aGVsbG8=");
  assert.equal(decoded?.mimeType, "text/plain");
  assert.equal(decoded?.buffer.toString("utf8"), "hello");
});

test("htmlToPlainText converts exported rich text to editor text", () => {
  assert.equal(htmlToPlainText("<p>Hello&nbsp;<strong>world</strong></p><p>Next &amp; final</p>"), "Hello world\n\nNext & final");
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

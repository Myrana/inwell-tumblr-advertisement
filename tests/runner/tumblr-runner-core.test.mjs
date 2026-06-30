import assert from "node:assert/strict";
import test from "node:test";
import {
  appearsLoggedInToTumblr,
  appearsRateLimitedByTumblr,
  dataUrlToBuffer,
  fieldsForItem,
  fillRichTextEditorInDocument,
  frameCandidateScore,
  htmlToPlainText,
  isPhotoClickThroughContext,
  isReusableRemotePage,
  loginWaitMessage,
  manualActionReason,
  normalizeRunnerPlan,
  parseArgs,
  postTypeCandidateIndex,
  reviewPagesOpenMessage,
  shouldDeferReadyReview,
  shouldPauseForManualAction,
  summarizeFrames,
  tumblrPostSelectOptionSelector,
} from "../../scripts/tumblr-runner-core.mjs";

test("parseArgs accepts a plan and safety defaults", () => {
  const options = parseArgs(["--plan", "queue.json", "--no-pause", "--no-review-pause"]);
  assert.equal(options.planPath, "queue.json");
  assert.equal(options.submit, false);
  assert.equal(options.headless, false);
  assert.equal(options.loginFirst, false);
  assert.equal(options.noPause, true);
  assert.equal(options.noReviewPause, true);
});

test("parseArgs supports same-session login before queue execution", () => {
  const options = parseArgs([
    "--plan",
    "queue.json",
    "--login-first",
    "--media-dir",
    "media",
    "--slow-mo",
    "125",
    "--api-base",
    "http://127.0.0.1:8021/api/",
    "--api-token",
    "local-token",
    "--run-id",
    "run-123",
    "--workspace-id",
    "workspace-local",
    "--remote-cdp-url",
    "wss://browser.example/session-123",
    "--remote-live-url",
    "https://browser.example/live/session-123",
  ]);
  assert.equal(options.planPath, "queue.json");
  assert.equal(options.loginFirst, true);
  assert.equal(options.mediaDir, "media");
  assert.equal(options.slowMo, 125);
  assert.equal(options.apiBaseUrl, "http://127.0.0.1:8021/api");
  assert.equal(options.apiToken, "local-token");
  assert.equal(options.runId, "run-123");
  assert.equal(options.workspaceId, "workspace-local");
  assert.equal(options.remoteCdpUrl, "wss://browser.example/session-123");
  assert.equal(options.remoteLiveUrl, "https://browser.example/live/session-123");
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
          advertisement: { postType: "photo", forumUrl: "https://forum.example/thread", tags: ["one", "two"], imageName: "ad.png" },
          fields: { caption: "<p>Hello</p>", imageDataUrl: "data:image/png;base64,aGVsbG8=" },
        }),
      },
    ],
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].postType, "photo");
  assert.equal(fieldsForItem(plan.items[0]).title, "");
  assert.match(fieldsForItem(plan.items[0]).bodyHtml, /<p>Hello<\/p>/);
  assert.equal(fieldsForItem(plan.items[0]).imageLinkUrl, "https://forum.example/thread");
  assert.deepEqual(fieldsForItem(plan.items[0]).tags, ["one", "two"]);
});

test("fieldsForItem prefers explicit image click-through URL", () => {
  const fields = fieldsForItem({
    payload: {
      fields: { body: "Body", imageLinkUrl: "https://forum.example/photo-link" },
      advertisement: { forumUrl: "https://forum.example/fallback", tags: [] },
    },
  });

  assert.equal(fields.imageLinkUrl, "https://forum.example/photo-link");
});

test("photo click-through context matching avoids unrelated URL fields", () => {
  assert.equal(isPhotoClickThroughContext("Photo link URL"), true);
  assert.equal(isPhotoClickThroughContext("Click-through URL"), true);
  assert.equal(isPhotoClickThroughContext("URL", true), true);
  assert.equal(isPhotoClickThroughContext("Video URL", true), false);
  assert.equal(isPhotoClickThroughContext("Tag URL", true), false);
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

test("fillRichTextEditorInDocument clears and blurs editor selection after fill", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalInputEvent = globalThis.InputEvent;
  const originalEvent = globalThis.Event;
  const events = [];
  const calls = {
    addRange: 0,
    blur: 0,
    collapse: 0,
    focus: 0,
    removeAllRanges: 0,
    selectNodeContents: 0,
  };
  const editable = {
    innerHTML: "",
    textContent: "",
    focus() {
      calls.focus += 1;
    },
    blur() {
      calls.blur += 1;
    },
    dispatchEvent(event) {
      events.push(event.type);
    },
  };

  globalThis.InputEvent = class {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.Event = class {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.window = {
    getSelection: () => ({
      addRange: () => {
        calls.addRange += 1;
      },
      removeAllRanges: () => {
        calls.removeAllRanges += 1;
      },
    }),
  };
  globalThis.document = {
    activeElement: editable,
    body: {},
    designMode: "off",
    querySelector: (selector) => (selector === "[contenteditable='true']" ? editable : null),
    createRange: () => ({
      collapse: (toStart) => {
        if (toStart === false) {
          calls.collapse += 1;
        }
      },
      selectNodeContents: (node) => {
        if (node === editable) {
          calls.selectNodeContents += 1;
        }
      },
    }),
  };

  try {
    assert.equal(fillRichTextEditorInDocument({ value: "<p>Body</p>", isHtml: true }), true);
    assert.equal(editable.innerHTML, "<p>Body</p>");
    assert.deepEqual(events, ["input", "change"]);
    assert.equal(calls.focus, 1);
    assert.equal(calls.selectNodeContents, 1);
    assert.equal(calls.collapse, 1);
    assert.equal(calls.addRange, 1);
    assert.ok(calls.removeAllRanges >= 3);
    assert.ok(calls.blur >= 1);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.InputEvent = originalInputEvent;
    globalThis.Event = originalEvent;
  }
});

test("manual action detection catches login and captcha states", () => {
  assert.equal(shouldPauseForManualAction("Please log in to continue"), true);
  assert.equal(shouldPauseForManualAction("Complete this captcha"), true);
  assert.equal(shouldPauseForManualAction("Request denied"), true);
  assert.equal(shouldPauseForManualAction("Public submit form"), false);
  assert.match(manualActionReason("Request denied"), /denied this request/);
});

test("Tumblr rate-limit detection catches Tumblr rate-limit pages only", () => {
  assert.equal(appearsRateLimitedByTumblr("Rate limit exceeded.", "https://inkwell-test.tumblr.com/submit"), true);
  assert.equal(appearsRateLimitedByTumblr("Find out why you may have encountered the rate limit.", "https://www.tumblr.com/submit_form/inkwell-test.tumblr.com"), true);
  assert.equal(appearsRateLimitedByTumblr("Rate limit exceeded.", "https://example.com"), false);
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

test("remote browser page reuse accepts open blank and Tumblr session pages", () => {
  assert.equal(isReusableRemotePage({ isClosed: () => false, url: () => "about:blank" }), true);
  assert.equal(isReusableRemotePage({ isClosed: () => false, url: () => "" }), true);
  assert.equal(isReusableRemotePage({ isClosed: () => false, url: () => "https://www.tumblr.com/dashboard" }), true);
  assert.equal(isReusableRemotePage({ isClosed: () => false, url: () => "https://www.tumblr.com/login?redirect_to=%2Fdashboard" }), true);
  assert.equal(isReusableRemotePage({ isClosed: () => false, url: () => "https://example.tumblr.com/submit" }), false);
  assert.equal(isReusableRemotePage({ isClosed: () => true, url: () => "about:blank" }), false);
  assert.equal(isReusableRemotePage(null), false);
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

test("tumblrPostSelectOptionSelector targets Tumblr legacy post type options", () => {
  assert.equal(tumblrPostSelectOptionSelector("photo"), '#post_select [data-option-value="photo"]');
  assert.equal(tumblrPostSelectOptionSelector("unknown"), '#post_select [data-option-value="photo"]');
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

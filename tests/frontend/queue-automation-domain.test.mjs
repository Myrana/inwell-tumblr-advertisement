import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

function queueItem(overrides = {}) {
  return {
    id: "queue-source-refillblog",
    adId: "ad-source",
    targetId: "refillblog",
    targetName: "Refill Blog",
    tumblrAccountId: "tumblr-default",
    queueName: "Default queue",
    submitUrl: "https://refillblog.tumblr.com/submit",
    postType: "text",
    status: "queued",
    scheduledFor: "",
    timezone: "America/New_York",
    createdAt: "2026-06-20T12:00:00.000Z",
    updatedAt: "2026-06-20T12:00:00.000Z",
    lastRunAt: "",
    postedAt: "",
    failedAt: "",
    notes: "Ready.",
    runnerPayload: "",
    ...overrides,
  };
}

function readyAd(id, title, destinationBlog = "refillblog") {
  return {
    id,
    postType: "text",
    title,
    campaignName: "",
    content: `<p>${title}</p>`,
    destinationBlog,
    forumUrl: "https://forum.example/refill",
    tags: ["refill"],
    imageCaption: "",
    imageName: "",
    imageDataUrl: "",
    videoUrl: "",
    videoName: "",
    status: "ready",
    archived: false,
    updatedAt: "2026-06-20T12:00:00.000Z",
  };
}

async function withQueueAutomationModule(t) {
  const outDir = mkdtempSync(join(tmpdir(), "inwell-queue-automation-"));
  t.after(() => {
    rmSync(outDir, { force: true, recursive: true });
  });

  const compiled = new Set();
  function compileDomainModule(moduleName) {
    if (compiled.has(moduleName)) {
      return;
    }
    compiled.add(moduleName);
    const sourcePath = join(process.cwd(), "src", "domain", `${moduleName}.ts`);
    const source = readFileSync(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["']\.\/([^"']+)["']/g)) {
      if (match[1] !== "types") {
        compileDomainModule(match[1]);
      }
    }
    let output = ts.transpileModule(source, {
      compilerOptions: {
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ES2020,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: sourcePath,
    }).outputText;
    output = output
      .replace(/^import\s+\{[^}]+\}\s+from\s+["']\.\/types["'];\r?\n/gm, "")
      .replace(/import\.meta\.env/g, "({})")
      .replace(/from\s+["']\.\/([^"']+)["']/g, 'from "./$1.js"');
    writeFileSync(join(outDir, `${moduleName}.js`), output);
  }

  compileDomainModule("queueAutomation");
  return import(pathToFileURL(join(outDir, "queueAutomation.js")).href);
}

test("runner readiness skips parked review items when runnable work exists", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const mixedQueue = [
    queueItem({ id: "queue-ready" }),
    queueItem({ id: "queue-failed", status: "failed" }),
  ];
  const readiness = queueAutomation.runnerExecutionReadiness({
    activeQueueName: "Default queue",
    activeQueue: mixedQueue,
    connectedAccountCount: 1,
    scheduledRunnerReady: true,
    scheduledRunnerDetail: "Watching.",
    selectedAccountName: "Runner Tumblr",
    selectedConnectedAccount: true,
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.manualCanRun, true);
  assert.equal(readiness.scheduledCanRun, true);
  assert.equal(readiness.detail, "Runner Tumblr can run 1 queued advertisement while 1 item stays in review.");
});

test("runner readiness blocks when only review items are available", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const readiness = queueAutomation.runnerExecutionReadiness({
    activeQueueName: "Default queue",
    activeQueue: [queueItem({ id: "queue-failed", status: "failed" })],
    connectedAccountCount: 1,
    scheduledRunnerReady: true,
    scheduledRunnerDetail: "Watching.",
    selectedConnectedAccount: true,
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.manualCanRun, false);
  assert.equal(readiness.title, "Automation needs queue review");
});

test("ready ad refill keeps duplicate and cooldown protections", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const refill = queueAutomation.refillQueueFromReadyDrafts({
    queue: [
      queueItem({ id: "queue-active", adId: "ad-active" }),
      queueItem({
        id: "queue-recent",
        adId: "ad-recent",
        status: "posted",
        postedAt: "2026-06-19T12:00:00.000Z",
      }),
    ],
    sourceAds: [
      readyAd("ad-active", "Already active"),
      readyAd("ad-recent", "Recently posted"),
      readyAd("ad-new", "New ready ad"),
    ],
    submitTargets: [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }],
    queueName: "Default queue",
    tumblrAccountId: "tumblr-default",
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.deepEqual(refill.addedItems.map((item) => item.adId), ["ad-new"]);
  assert.equal(refill.skippedReasons.length, 2);
});

test("ready ad refill ignores parked review items when filling runnable capacity", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const parkedQueue = [
    queueItem({ id: "queue-failed", adId: "ad-failed", status: "failed" }),
    queueItem({ id: "queue-review", adId: "ad-review", status: "needs-review" }),
  ];
  const sourceAds = [
    readyAd("ad-new-one", "New ready ad one"),
    readyAd("ad-new-two", "New ready ad two"),
  ];
  const submitTargets = [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }];

  const refill = queueAutomation.refillQueueFromReadyDrafts({
    queue: parkedQueue,
    sourceAds,
    submitTargets,
    queueName: "Default queue",
    tumblrAccountId: "tumblr-default",
    targetDepth: 2,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.deepEqual(refill.addedItems.map((item) => item.adId), ["ad-new-one", "ad-new-two"]);

  const savedItems = [];
  const preparation = await queueAutomation.prepareAutomationQueueForRun({
    queue: parkedQueue,
    sourceAds,
    submitTargets,
    queueName: "Default queue",
    tumblrAccountId: "tumblr-default",
    targetDepth: 2,
    saveQueueItem: async (item) => {
      savedItems.push(item);
      return item;
    },
  });

  assert.equal(preparation.status, "ready");
  assert.equal(preparation.preparedQueue.addedCount, 2);
  assert.equal(preparation.preparedQueue.readyCount, 2);
  assert.equal(preparation.preparedQueue.attentionCount, 2);
  assert.deepEqual(savedItems.map((item) => item.adId), ["ad-new-one", "ad-new-two"]);
});

test("auto-fill partial save failure returns reconciled queue for retry planning", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const sourceAds = [
    readyAd("ad-new-one", "New ready ad one"),
    readyAd("ad-new-two", "New ready ad two"),
  ];
  const submitTargets = [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }];
  const savedItems = [];

  const preparation = await queueAutomation.prepareAutomationQueueForRun({
    queue: [],
    sourceAds,
    submitTargets,
    queueName: "Default queue",
    tumblrAccountId: "tumblr-default",
    targetDepth: 2,
    saveQueueItem: async (item) => {
      if (savedItems.length) {
        return null;
      }
      savedItems.push(item);
      return item;
    },
  });

  assert.equal(preparation.status, "blocked");
  assert.equal(preparation.savedItems.length, 1);
  assert.deepEqual(preparation.reconciledQueue.map((item) => item.adId), ["ad-new-one"]);

  const retry = queueAutomation.refillQueueFromReadyDrafts({
    queue: preparation.reconciledQueue,
    sourceAds,
    submitTargets,
    queueName: "Default queue",
    tumblrAccountId: "tumblr-default",
    targetDepth: 2,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.deepEqual(retry.addedItems.map((item) => item.adId), ["ad-new-two"]);
});

test("queue flow summary splits lanes and exposes refill activity", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const summary = queueAutomation.queueFlowSummary({
    activeQueueName: "Default queue",
    activeQueue: [
      queueItem({ id: "queue-ready", targetName: "Ready Blog", status: "queued" }),
      queueItem({ id: "queue-running", targetName: "Running Blog", status: "running" }),
      queueItem({ id: "queue-failed", targetName: "Review Blog", status: "failed" }),
      queueItem({
        id: "ad-refill-default-queue-refillblog-refill-1",
        adId: "ad-refill",
        targetName: "Refill Blog",
        notes: "Auto-added to keep this queue stocked after a completed submission.",
      }),
    ],
    queueScheduleEnabled: true,
    runnerDetail: "Watching.",
    runnerReady: true,
    savedDraftCount: 2,
    selectedConnectedAccount: true,
    sourceAds: [readyAd("ad-next", "Next ready ad")],
    submitTargets: [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }],
  });

  assert.equal(summary.statusLabels.queued, "Ready");
  assert.equal(summary.automation.label, "Automation ready");
  assert.equal(summary.lanes.runnable.length, 2);
  assert.equal(summary.lanes.running.length, 1);
  assert.equal(summary.lanes.attention.length, 1);
  assert.match(summary.refillActivity, /Latest refill added Refill Blog/);
  assert.deepEqual(summary.timeline.map((step) => step.label), ["Ready", "Running", "Completed", "Replacement"]);
});

test("queue flow summary explains empty automation blockers", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const summary = queueAutomation.queueFlowSummary({
    activeQueueName: "Default queue",
    activeQueue: [queueItem({ id: "queue-review", status: "needs-review" })],
    queueScheduleEnabled: false,
    runnerDetail: "Runner is offline.",
    runnerReady: false,
    savedDraftCount: 1,
    selectedConnectedAccount: false,
    sourceAds: [readyAd("ad-missing-body", "", "refillblog")],
    submitTargets: [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }],
  });

  assert.equal(summary.automation.label, "Automation off");
  assert.equal(summary.emptyReasons[0], "Choose a connected Tumblr account for runner work.");
  assert.ok(summary.emptyReasons.includes("Runner is offline."));
  assert.ok(summary.emptyReasons.includes("Daily automation is disabled for this queue."));
  assert.ok(summary.emptyReasons.some((reason) => reason.includes("parked for manual review")));
  assert.equal(summary.healthStats.find((stat) => stat.label === "Review").tone, "blocked");
});

test("queue flow summary uses lightweight refill preview without runner payloads", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const largeImageDataUrl = `data:image/png;base64,${"a".repeat(8000)}`;
  const photoAd = {
    ...readyAd("ad-photo-large", "Large photo ready ad"),
    postType: "photo",
    imageDataUrl: largeImageDataUrl,
    imageName: "large.png",
  };
  const submitTargets = [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }];
  const preview = queueAutomation.previewQueueRefillFromReadyDrafts({
    queue: [],
    sourceAds: [photoAd],
    submitTargets,
    queueName: "Default queue",
    targetDepth: 1,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const summary = queueAutomation.queueFlowSummary({
    activeQueueName: "Default queue",
    activeQueue: [],
    queueScheduleEnabled: true,
    runnerDetail: "Watching.",
    runnerReady: true,
    savedDraftCount: 1,
    selectedConnectedAccount: true,
    sourceAds: [photoAd],
    submitTargets,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.equal(preview.availableCount, 1);
  assert.deepEqual(preview.candidateLabels, ["Large photo ready ad"]);
  assert.equal("addedItems" in preview, false);
  assert.match(summary.refillActivity, /1 ready ad can refill this queue/);
  assert.equal(JSON.stringify(summary).includes(largeImageDataUrl), false);
  assert.equal(JSON.stringify(summary).includes("runnerPayload"), false);
});

test("queue refill availability preview stays display-only for app render checks", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const largeImageDataUrl = `data:image/png;base64,${"b".repeat(8000)}`;
  const photoAd = {
    ...readyAd("ad-photo-preview", "Preview photo ready ad"),
    postType: "photo",
    imageDataUrl: largeImageDataUrl,
    imageName: "preview.png",
  };
  const preview = queueAutomation.queueRefillAvailabilityPreview({
    queue: [],
    sourceAds: [photoAd],
    submitTargets: [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }],
    queueName: "Default queue",
    targetDepth: 1,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.equal(preview.availableCount, 1);
  assert.equal("addedItems" in preview, false);
  assert.equal("queue" in preview, false);
  assert.equal(JSON.stringify(preview).includes(largeImageDataUrl), false);
  assert.equal(JSON.stringify(preview).includes("runnerPayload"), false);
});

test("queue refill preview and execution share candidate and skip planning", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const submitTargets = [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }];
  const sourceAds = [
    readyAd("ad-active", "Already active"),
    readyAd("ad-recent", "Recently posted"),
    readyAd("ad-new", "New ready ad"),
  ];
  const duplicateAndCooldownQueue = [
    queueItem({ id: "queue-active", adId: "ad-active" }),
    queueItem({
      id: "queue-recent",
      adId: "ad-recent",
      status: "posted",
      postedAt: "2026-06-19T12:00:00.000Z",
    }),
  ];

  const refillablePreview = queueAutomation.previewQueueRefillFromReadyDrafts({
    queue: duplicateAndCooldownQueue,
    sourceAds,
    submitTargets,
    queueName: "Default queue",
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const refillableExecution = queueAutomation.refillQueueFromReadyDrafts({
    queue: duplicateAndCooldownQueue,
    sourceAds,
    submitTargets,
    queueName: "Default queue",
    tumblrAccountId: "tumblr-default",
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.deepEqual(refillablePreview.candidateAdIds, refillableExecution.addedItems.map((item) => item.adId));
  assert.deepEqual(refillablePreview.skippedReasons, refillableExecution.skippedReasons);

  const atCapacityPreview = queueAutomation.previewQueueRefillFromReadyDrafts({
    queue: [
      queueItem({ id: "queue-one", adId: "ad-one" }),
      queueItem({ id: "queue-two", adId: "ad-two" }),
      queueItem({ id: "queue-three", adId: "ad-three" }),
    ],
    sourceAds: [readyAd("ad-new", "New ready ad")],
    submitTargets,
    queueName: "Default queue",
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const atCapacityExecution = queueAutomation.refillQueueFromReadyDrafts({
    queue: [
      queueItem({ id: "queue-one", adId: "ad-one" }),
      queueItem({ id: "queue-two", adId: "ad-two" }),
      queueItem({ id: "queue-three", adId: "ad-three" }),
    ],
    sourceAds: [readyAd("ad-new", "New ready ad")],
    submitTargets,
    queueName: "Default queue",
    tumblrAccountId: "tumblr-default",
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.equal(atCapacityPreview.state, "at-capacity");
  assert.deepEqual(atCapacityPreview.candidateAdIds, ["ad-new"]);
  assert.deepEqual(atCapacityExecution.addedItems, []);
  assert.deepEqual(atCapacityPreview.skippedReasons, atCapacityExecution.skippedReasons);

  const missingQueuePreview = queueAutomation.previewQueueRefillFromReadyDrafts({
    queue: [],
    sourceAds: [readyAd("ad-new", "New ready ad")],
    submitTargets,
    queueName: "",
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const missingQueueExecution = queueAutomation.refillQueueFromReadyDrafts({
    queue: [],
    sourceAds: [readyAd("ad-new", "New ready ad")],
    submitTargets,
    queueName: "",
    tumblrAccountId: "tumblr-default",
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.equal(missingQueuePreview.state, "no-queue");
  assert.deepEqual(missingQueuePreview.candidateAdIds, missingQueueExecution.addedItems.map((item) => item.adId));
  assert.deepEqual(missingQueuePreview.skippedReasons, missingQueueExecution.skippedReasons);
});

test("queue flow summary does not advertise skipped refill candidates", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const submitTargets = [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }];
  const summary = queueAutomation.queueFlowSummary({
    activeQueueName: "Default queue",
    activeQueue: [
      queueItem({
        id: "queue-active",
        adId: "ad-active",
        status: "running",
      }),
      queueItem({
        id: "queue-recent",
        adId: "ad-recent",
        status: "posted",
        postedAt: "2026-06-19T12:00:00.000Z",
      }),
    ],
    queueScheduleEnabled: true,
    runnerDetail: "Watching.",
    runnerReady: true,
    savedDraftCount: 2,
    selectedConnectedAccount: true,
    sourceAds: [
      readyAd("ad-active", "Already active"),
      readyAd("ad-recent", "Recently posted"),
    ],
    submitTargets,
    targetDepth: 2,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const readyAds = summary.healthStats.find((stat) => stat.label === "Ready ads");

  assert.equal(readyAds.value, "0");
  assert.equal(readyAds.tone, "warning");
  assert.match(readyAds.detail, /recently ran for Refill Blog/);
  assert.equal(summary.refillActivity.includes("can refill this queue"), false);
  assert.ok(summary.emptyReasons.some((reason) => reason.includes("recently ran for Refill Blog")));
  assert.equal(summary.timeline.find((step) => step.label === "Replacement").value, "0");
});

test("queue flow summary and refill planning agree on fallback submit targets", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const sourceAds = [readyAd("ad-unsaved-target", "Unsaved target ready ad", "unsavedblog")];
  const submitTargets = [];
  const preview = queueAutomation.previewQueueRefillFromReadyDrafts({
    queue: [],
    sourceAds,
    submitTargets,
    queueName: "Default queue",
    targetDepth: 1,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const refill = queueAutomation.refillQueueFromReadyDrafts({
    queue: [],
    sourceAds,
    submitTargets,
    queueName: "Default queue",
    tumblrAccountId: "tumblr-default",
    targetDepth: 1,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const summary = queueAutomation.queueFlowSummary({
    activeQueueName: "Default queue",
    activeQueue: [],
    queueScheduleEnabled: true,
    runnerDetail: "Watching.",
    runnerReady: true,
    savedDraftCount: 1,
    selectedConnectedAccount: true,
    sourceAds,
    submitTargets,
    targetDepth: 1,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });

  assert.deepEqual(preview.candidateAdIds, ["ad-unsaved-target"]);
  assert.deepEqual(refill.addedItems.map((item) => item.adId), preview.candidateAdIds);
  assert.match(summary.refillActivity, /1 ready ad can refill this queue/);
  assert.equal(summary.emptyReasons.some((reason) => reason.includes("no matching submit target")), false);
});

test("queue flow summary reports stocked queues without hiding ready drafts", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const summary = queueAutomation.queueFlowSummary({
    activeQueueName: "Default queue",
    activeQueue: [
      queueItem({ id: "queue-one", adId: "ad-one", targetName: "Refill Blog one" }),
      queueItem({ id: "queue-two", adId: "ad-two", targetName: "Refill Blog two" }),
      queueItem({ id: "queue-three", adId: "ad-three", targetName: "Refill Blog three" }),
    ],
    queueScheduleEnabled: true,
    runnerDetail: "Watching.",
    runnerReady: true,
    savedDraftCount: 1,
    selectedConnectedAccount: true,
    sourceAds: [readyAd("ad-next", "Next ready ad")],
    submitTargets: [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }],
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const readyAds = summary.healthStats.find((stat) => stat.label === "Ready ads");
  const replacement = summary.timeline.find((step) => step.label === "Replacement");

  assert.equal(readyAds.value, "1");
  assert.equal(readyAds.tone, "ready");
  assert.match(readyAds.detail, /stocked/);
  assert.match(summary.refillActivity, /stocked/);
  assert.doesNotMatch(summary.refillActivity, /No eligible ready ads/);
  assert.equal(replacement.value, "1");
  assert.match(replacement.detail, /target depth/);
});

test("queue flow summary does not treat missing queue selection as stocked", async (t) => {
  const queueAutomation = await withQueueAutomationModule(t);
  const summary = queueAutomation.queueFlowSummary({
    activeQueueName: "",
    activeQueue: [],
    queueScheduleEnabled: true,
    runnerDetail: "Watching.",
    runnerReady: true,
    savedDraftCount: 1,
    selectedConnectedAccount: true,
    sourceAds: [readyAd("ad-next", "Next ready ad")],
    submitTargets: [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }],
    targetDepth: 3,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  const readyAds = summary.healthStats.find((stat) => stat.label === "Ready ads");
  const replacement = summary.timeline.find((step) => step.label === "Replacement");

  assert.equal(summary.emptyReasons[0], "Select or create a queue before automation can run.");
  assert.equal(readyAds.value, "0");
  assert.doesNotMatch(readyAds.detail, /stocked|capacity/i);
  assert.doesNotMatch(summary.refillActivity, /stocked|capacity/i);
  assert.equal(replacement.value, "0");
  assert.doesNotMatch(replacement.detail, /target depth|stocked|capacity/i);
});

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

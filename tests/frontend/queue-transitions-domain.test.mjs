import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

const submitTargets = [
  { id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" },
  { id: "otherblog", name: "Other Blog", submitUrl: "https://otherblog.tumblr.com/submit" },
];

async function withQueueTransitionModules(t) {
  const outDir = mkdtempSync(join(tmpdir(), "inwell-queue-domain-"));
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

  compileDomainModule("queueTransitions");
  compileDomainModule("queueCommit");
  compileDomainModule("queueTransitionController");
  return {
    queueCommit: await import(pathToFileURL(join(outDir, "queueCommit.js")).href),
    queueTransitionController: await import(pathToFileURL(join(outDir, "queueTransitionController.js")).href),
    queueTransitions: await import(pathToFileURL(join(outDir, "queueTransitions.js")).href),
  };
}

test("buildQueueItemUpdate updates status timestamps and clears queued recovery fields", async (t) => {
  const { queueTransitions } = await withQueueTransitionModules(t);
  const failed = queueItem({ status: "failed", failedAt: "2026-06-20T12:05:00.000Z", postedAt: "2026-06-20T12:04:00.000Z" });
  const result = {
    queued: queueTransitions.buildQueueItemUpdate(failed, "queued", "Retry.", "2026-06-20T12:10:00.000Z"),
    posted: queueTransitions.buildQueueItemUpdate(failed, "posted", "Done.", "2026-06-20T12:12:00.000Z"),
  };
  const { queued, posted } = result;
  assert.equal(queued.status, "queued");
  assert.equal(queued.notes, "Retry.");
  assert.equal(queued.updatedAt, "2026-06-20T12:10:00.000Z");
  assert.equal(queued.failedAt, "");
  assert.equal(queued.postedAt, "");
  assert.equal(posted.postedAt, "2026-06-20T12:12:00.000Z");
});

test("buildQueueTransition refills submitted bulk items per queue depth", async (t) => {
  const currentQueue = [
    queueItem({ id: "queue-one", adId: "ad-one" }),
    queueItem({ id: "queue-two", adId: "ad-two" }),
    queueItem({ id: "queue-other", adId: "ad-other", targetId: "otherblog", targetName: "Other Blog", queueName: "Other queue" }),
  ];
  const { queueTransitions } = await withQueueTransitionModules(t);
  const transition = queueTransitions.buildQueueTransition({
        currentQueue,
        ids: ["queue-one", "queue-two"],
        notes: "Bulk submitted.",
        sourceAds: [
          {
            id: "ad-one", postType: "text", title: "Source one", campaignName: "", content: "<p>Source one</p>",
            destinationBlog: "refillblog", forumUrl: "https://forum.example/refill", tags: ["refill"], imageCaption: "",
            imageName: "", imageDataUrl: "", videoUrl: "", videoName: "", status: "ready", archived: false, updatedAt: "2026-06-20T12:00:00.000Z",
          },
          {
            id: "ad-two", postType: "text", title: "Source two", campaignName: "", content: "<p>Source two</p>",
            destinationBlog: "refillblog", forumUrl: "https://forum.example/refill", tags: ["refill"], imageCaption: "",
            imageName: "", imageDataUrl: "", videoUrl: "", videoName: "", status: "ready", archived: false, updatedAt: "2026-06-20T12:00:00.000Z",
          },
          {
            id: "ad-refill-one", postType: "text", title: "Refill one", campaignName: "", content: "<p>Refill one</p>",
            destinationBlog: "refillblog", forumUrl: "https://forum.example/refill", tags: ["refill"], imageCaption: "",
            imageName: "", imageDataUrl: "", videoUrl: "", videoName: "", status: "ready", archived: false, updatedAt: "2026-06-20T12:00:00.000Z",
          },
          {
            id: "ad-refill-two", postType: "text", title: "Refill two", campaignName: "", content: "<p>Refill two</p>",
            destinationBlog: "refillblog", forumUrl: "https://forum.example/refill", tags: ["refill"], imageCaption: "",
            imageName: "", imageDataUrl: "", videoUrl: "", videoName: "", status: "ready", archived: false, updatedAt: "2026-06-20T12:00:00.000Z",
          },
          {
            id: "ad-other-refill", postType: "text", title: "Other refill", campaignName: "", content: "<p>Other refill</p>",
            destinationBlog: "otherblog", forumUrl: "https://forum.example/refill", tags: ["refill"], imageCaption: "",
            imageName: "", imageDataUrl: "", videoUrl: "", videoName: "", status: "ready", archived: false, updatedAt: "2026-06-20T12:00:00.000Z",
          },
        ],
        status: "submitted",
        submitTargets,
        timestamp: "2026-06-20T13:00:00.000Z",
        tumblrAccountId: "tumblr-default",
  });

  assert.deepEqual(transition.updatedItems.map((item) => item.id), ["queue-one", "queue-two"]);
  assert.deepEqual(transition.updatedItems.map((item) => item.status), ["submitted", "submitted"]);
  assert.deepEqual(transition.refillItems.map((item) => item.adId).sort(), ["ad-refill-one", "ad-refill-two"]);
  assert.equal(transition.nextQueue.filter((item) => item.queueName === "Default queue" && item.status === "queued").length, 2);
  assert.equal(transition.nextQueue.find((item) => item.id === "queue-other")?.status, "queued");
});

test("buildQueueTransition skips refills for non-completion statuses and missing ids", async (t) => {
  const currentQueue = [queueItem({ id: "queue-one", adId: "ad-one" })];
  const { queueTransitions } = await withQueueTransitionModules(t);
  const sourceAds = [{
        id: "ad-refill", postType: "text", title: "Refill", campaignName: "", content: "<p>Refill</p>",
        destinationBlog: "refillblog", forumUrl: "https://forum.example/refill", tags: ["refill"], imageCaption: "",
        imageName: "", imageDataUrl: "", videoUrl: "", videoName: "", status: "ready", archived: false, updatedAt: "2026-06-20T12:00:00.000Z",
  }];
  const failedTransition = queueTransitions.buildQueueTransition({
          currentQueue,
          ids: ["queue-one"],
          notes: "Needs repair.",
          sourceAds,
          status: "failed",
          submitTargets,
          timestamp: "2026-06-20T13:00:00.000Z",
          tumblrAccountId: "tumblr-default",
  });
  const missingTransition = queueTransitions.buildQueueTransition({
          currentQueue,
          ids: ["missing-id"],
          notes: "No-op.",
          sourceAds,
          status: "posted",
          submitTargets,
          timestamp: "2026-06-20T13:00:00.000Z",
          tumblrAccountId: "tumblr-default",
  });
  assert.equal(failedTransition.updatedItems[0].status, "failed");
  assert.equal(failedTransition.refillItems.length, 0);
  assert.equal(missingTransition.updatedItems.length, 0);
  assert.equal(missingTransition.refillItems.length, 0);
  assert.deepEqual(missingTransition.nextQueue, currentQueue);
});

test("commitQueueTransitionWithPersistence reports first-save and partial-save failures explicitly", async (t) => {
  const sourceQueue = [
    queueItem({ id: "queue-one", adId: "ad-one", targetName: "First Blog" }),
    queueItem({ id: "queue-two", adId: "ad-two", targetName: "Second Blog" }),
  ];
  const transition = {
    nextQueue: sourceQueue.map((item) => ({ ...item, status: "submitted", notes: "Done." })),
    updatedItems: sourceQueue.map((item) => ({ ...item, status: "submitted", notes: "Done." })),
    refillItems: [queueItem({ id: "queue-refill", adId: "ad-refill", targetName: "Refill Blog" })],
  };

  const { queueCommit } = await withQueueTransitionModules(t);
  const firstSaveFailure = await queueCommit.commitQueueTransitionWithPersistence({
        backendOwnsWorkspaceState: true,
        transition,
        setSubmissionQueue: () => {},
        reconcileBackendQueueAfterPartialSave: async () => true,
        syncQueueItem: async () => null,
  });
  const savedIds = [];
  const partialFailure = await queueCommit.commitQueueTransitionWithPersistence({
        backendOwnsWorkspaceState: true,
        transition,
        setSubmissionQueue: () => {},
        reconcileBackendQueueAfterPartialSave: async () => false,
        syncQueueItem: async (item) => {
          if (savedIds.length === 1) {
            return null;
          }
          savedIds.push(item.id);
          return item;
        },
  });
  const result = { firstSaveFailure, partialFailure };

  assert.equal(result.firstSaveFailure.ok, false);
  assert.equal(result.firstSaveFailure.kind, "failed");
  assert.equal(result.firstSaveFailure.savedItems.length, 0);
  assert.equal(result.firstSaveFailure.reloadAttempted, false);
  assert.equal(result.partialFailure.ok, false);
  assert.equal(result.partialFailure.kind, "partial");
  assert.deepEqual(result.partialFailure.savedItems.map((item) => item.id), ["queue-one"]);
  assert.equal(result.partialFailure.failedItem.id, "queue-two");
  assert.equal(result.partialFailure.reloadAttempted, true);
  assert.equal(result.partialFailure.reloaded, false);
});

test("queue transition controller derives queue-wide locks and failure messages", async (t) => {
  const { queueTransitionController } = await withQueueTransitionModules(t);
  const queue = [
    queueItem({ id: "queue-one", queueName: "Default queue" }),
    queueItem({ id: "queue-two", queueName: "Default queue" }),
    queueItem({ id: "queue-other", queueName: "Other queue" }),
  ];

  assert.deepEqual(queueTransitionController.queueTransitionLockScopes(queue, ["queue-one"]), ["queue:Default queue"]);
  assert.deepEqual(
    queueTransitionController.queueTransitionLockScopes(queue, ["queue-one", "queue-other"]).sort(),
    ["queue:Default queue", "queue:Other queue"],
  );
  assert.deepEqual(queueTransitionController.queueTransitionLockScopes(queue, ["missing-id"]), ["item:missing-id"]);

  assert.equal(
    queueTransitionController.queueCommitFailureMessage({
      kind: "failed",
      ok: false,
      reloadAttempted: false,
      savedItems: [],
    }),
    "Could not save queue update. Try again.",
  );
  assert.equal(
    queueTransitionController.queueCommitFailureMessage({
      failedItem: queueItem({ id: "failed-id", targetName: "Failed Blog" }),
      kind: "partial",
      ok: false,
      reloaded: false,
      reloadAttempted: true,
      savedItems: [queueItem({ id: "saved-id" })],
    }),
    "Saved 1 queue change, but syncing stopped before Failed Blog. The backend queue could not be reloaded, so refresh before retrying.",
  );
});

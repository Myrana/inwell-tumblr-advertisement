import assert from "node:assert/strict";

export async function setupBackendQueueBulkCompletionPage(t, deps, options = {}) {
  const page = await deps.openFrontendTestPage(t);
  const pageErrors = [];
  const runnerRequests = { companionRun: 0, localCommand: 0 };
  const savedQueuePayloads = [];
  const saveRequestWaiters = [];
  const failureMode = createQueueBulkFailureMode(options);
  const queueState = createQueueBulkState(options);

  page.on("pageerror", (error) => pageErrors.push(error));
  await routeQueueBulkApis(page, deps, queueState, failureMode, runnerRequests, savedQueuePayloads, saveRequestWaiters);

  await page.goto(deps.appUrl);
  await openBulkQueueEditor(page, deps.openWorkspaceView);

  return {
    failureMode,
    page,
    pageErrors,
    savedQueuePayloads,
    getQueueItems: () => queueState.getItems(),
    getRunnerRequests: () => ({ ...runnerRequests }),
    waitForSaveRequestCount: async (count) => waitForSaveRequestCount(savedQueuePayloads, saveRequestWaiters, count),
    resetQueue: async () => {
      queueState.reset();
      savedQueuePayloads.length = 0;
      await page.reload();
      await openBulkQueueEditor(page, deps.openWorkspaceView);
    },
  };
}

export async function submitBulkQueueCompletion(page, buttonName = "Update 2") {
  await page.getByLabel("Queue bulk editor").getByRole("button", { name: buttonName }).click();
}

function createQueueBulkFailureMode(options) {
  return {
    firstCompletionSave: false,
    completedItemPartialAfter: null,
    refillPartialAfter: null,
    queueListReloadFails: false,
    delayCompletionSaveMs: options.delayCompletionSaveMs ?? 0,
  };
}

function createQueueBulkState(options) {
  let queueItems = defaultQueueItems(options);

  return {
    getItems: () => queueItems,
    reset: () => {
      queueItems = defaultQueueItems(options);
    },
    save: (payload) => {
      const existingIndex = queueItems.findIndex((item) => item.id === payload.id);
      queueItems = existingIndex >= 0
        ? queueItems.map((item) => (item.id === payload.id ? payload : item))
        : [...queueItems, payload];
    },
  };
}

function defaultQueueItems(options) {
  return [
    buildQueueItem("queue-bulk-one", "ad-bulk-one", "refillblog", "Refill Blog"),
    buildQueueItem("queue-bulk-two", "ad-bulk-two", "refillblog", "Refill Blog second"),
  ].map((item, index) =>
    index === 0 && options.firstItemStatus
      ? { ...item, status: options.firstItemStatus, notes: options.firstItemNotes ?? item.notes }
      : item,
  );
}

function buildQueueItem(id, adId, targetId, targetName) {
  return {
    id,
    ad_id: adId,
    target_id: targetId,
    target_name: targetName,
    tumblr_account_id: "",
    queue_name: "Default queue",
    submit_url: `https://${targetId}.tumblr.com/submit`,
    post_type: "text",
    status: "queued",
    scheduled_for: null,
    timezone: "America/New_York",
    created_at: "2026-06-20T12:00:00.000Z",
    updated_at: "2026-06-20T12:00:00.000Z",
    last_run_at: null,
    posted_at: null,
    failed_at: null,
    notes: "Ready for local browser runner.",
    runner_payload: JSON.stringify({ fields: { body: `${targetName} body` } }),
  };
}

function buildAd(id, title, destinationBlog) {
  return {
    id,
    post_type: "text",
    title,
    campaign_name: "",
    content: `<p>${title} body</p>`,
    destination_blog: destinationBlog,
    forum_url: "https://forum.example/refill",
    tags: ["refill"],
    image_caption: "",
    image_name: "",
    image_data_url: "",
    video_url: "",
    video_name: "",
    status: "ready",
    archived: false,
    updated_at: "2026-06-20T12:00:00.000Z",
  };
}

async function routeQueueBulkApis(page, deps, queueState, failureMode, runnerRequests, savedQueuePayloads, saveRequestWaiters) {
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeQueueBulkRunnerSideEffects(page, deps.apiHeaders, runnerRequests);
  await deps.routeAuthenticatedSession(page);
  await routeQueueList(page, deps.apiHeaders, queueState, failureMode);
  await routeQueueSaves(page, deps.apiHeaders, queueState, failureMode, savedQueuePayloads, saveRequestWaiters);
  await routeQueueBulkWorkspaceApis(page, deps.apiHeaders);
}

async function routeQueueBulkRunnerSideEffects(page, apiHeaders, runnerRequests) {
  await page.route("http://127.0.0.1:17842/run", (route) => {
    runnerRequests.companionRun += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, accepted: true, running: true }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/runner/local-command?**", (route) => {
    runnerRequests.localCommand += 1;
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command: "npm.cmd run tumblr:runner:local -- --queue 'Default queue'",
          autoStartCommand: "",
          tokenConfigured: true,
          usesDeviceToken: true,
          tokenEnv: "INWELL_LOCAL_RUNNER_TOKEN",
          message: "Run this command locally.",
        },
      }),
    });
  });
}

async function routeQueueList(page, apiHeaders, queueState, failureMode) {
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    failureMode.queueListReloadFails
      ? route.fulfill({
          contentType: "application/json",
          headers: apiHeaders,
          status: 500,
          body: JSON.stringify({ error: "Could not reload queue." }),
        })
      : route.fulfill({
          contentType: "application/json",
          headers: apiHeaders,
          body: JSON.stringify({ queue: queueState.getItems() }),
        }),
  );
}

async function routeQueueSaves(page, apiHeaders, queueState, failureMode, savedQueuePayloads, saveRequestWaiters) {
  await page.route("http://127.0.0.1:8021/api/queue/*", async (route) => {
    const payload = route.request().postDataJSON();
    savedQueuePayloads.push(payload);
    saveRequestWaiters.splice(0).forEach((resolve) => resolve());
    if (failureMode.delayCompletionSaveMs && (payload.status === "submitted" || payload.status === "posted")) {
      await new Promise((resolve) => setTimeout(resolve, failureMode.delayCompletionSaveMs));
    }
    const failure = nextQueueSaveFailure(failureMode, payload);
    if (failure) {
      return route.fulfill({
        contentType: "application/json",
        headers: apiHeaders,
        status: 500,
        body: JSON.stringify({ error: failure }),
      });
    }
    queueState.save(payload);
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ queue_item: payload }),
    });
  });
}

function nextQueueSaveFailure(failureMode, payload) {
  if (failureMode.firstCompletionSave && payload.status === "submitted") {
    failureMode.firstCompletionSave = false;
    return "Could not save completed item.";
  }
  if (failureMode.completedItemPartialAfter !== null && payload.status === "submitted") {
    if (failureMode.completedItemPartialAfter <= 0) {
      failureMode.completedItemPartialAfter = null;
      return "Could not save later completed item.";
    }
    failureMode.completedItemPartialAfter -= 1;
  }
  if (failureMode.refillPartialAfter !== null && payload.status === "queued") {
    if (failureMode.refillPartialAfter <= 0) {
      failureMode.refillPartialAfter = null;
      return "Could not save later refill item.";
    }
    failureMode.refillPartialAfter -= 1;
  }
  return null;
}

async function routeQueueBulkWorkspaceApis(page, apiHeaders) {
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        advertisements: [
          buildAd("ad-bulk-one", "Bulk source one", "refillblog"),
          buildAd("ad-bulk-two", "Bulk source two", "refillblog"),
          buildAd("ad-refill-one", "Refill source one", "refillblog"),
          buildAd("ad-refill-two", "Refill source two", "refillblog"),
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          submitTargets: [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }],
          queueDefinitions: [],
          tagProfiles: {},
          runnerSettings: {},
          scheduleSettings: {},
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/status", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ runner: { running: false } }) }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
  );
}

async function openBulkQueueEditor(page, openWorkspaceView) {
  await openWorkspaceView(page, "Queues");
  await page.locator(".queue-management-row", { hasText: "Default queue" }).getByRole("button", { name: "Open queue" }).click();
  await page.getByLabel("Queue bulk editor").getByLabel("Select all pending items").check();
  await page.getByLabel("Queue bulk editor").getByLabel("Status").selectOption("submitted");
}

async function waitForSaveRequestCount(savedQueuePayloads, saveRequestWaiters, count) {
  while (savedQueuePayloads.length < count) {
    await new Promise((resolve) => saveRequestWaiters.push(resolve));
  }
}

export function assertQueueSaveStatuses(payloads, expectedStatuses) {
  assert.deepEqual(payloads.map((item) => item.status).sort(), expectedStatuses);
}

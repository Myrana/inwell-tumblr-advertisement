import assert from "node:assert/strict";

export async function setupRetryRecoveryPage(t, deps) {
  const page = await deps.openFrontendTestPage(t);
  const pageErrors = [];
  const companionState = createCompanionState();
  const queueState = createRetryQueueState();

  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await deps.routeAuthenticatedSession(page);
  await routeLocalCompanion(page, companionState);
  await routeRetryBackendApis(page, deps.apiHeaders, queueState, companionState);
  await installRetryClipboardAndLocalState(page);

  await page.goto(deps.appUrl);
  await openRetryQueue(page, deps.openWorkspaceView);

  return {
    page,
    pageErrors,
    companionRunPayloads: companionState.runPayloads,
    failNextRetryQueueSave() {
      queueState.failNextRetryQueueSave();
    },
    getLocalCommandRequestCount() {
      return companionState.localCommandRequestCount;
    },
    setCompanionAvailable(value) {
      companionState.available = value;
    },
    requireQueueSaveBeforeRun() {
      companionState.requireQueueSaveBeforeRun = true;
      queueState.markRetryQueueSaveIncomplete();
    },
    resetFailedQueue() {
      queueState.reset();
    },
    async reopenQueue() {
      await page.reload();
      await openRetryQueue(page, deps.openWorkspaceView);
    },
  };
}

function createCompanionState() {
  return {
    available: true,
    requireQueueSaveBeforeRun: false,
    localCommandRequestCount: 0,
    runPayloads: [],
  };
}

function createRetryQueueState() {
  const failedQueueItem = buildFailedQueueItem();
  let queueItems = [{ ...failedQueueItem }];
  let failNextQueuedRetrySave = false;
  let retryQueueSaveCompleted = false;

  return {
    failedQueueItem,
    getItems: () => queueItems,
    reset: () => {
      queueItems = [{ ...failedQueueItem }];
    },
    failNextRetryQueueSave: () => {
      failNextQueuedRetrySave = true;
    },
    markRetryQueueSaveIncomplete: () => {
      retryQueueSaveCompleted = false;
    },
    wasRetryQueueSaveCompleted: () => retryQueueSaveCompleted,
    save: (updatedItem) => {
      if (failNextQueuedRetrySave && updatedItem.id === failedQueueItem.id && updatedItem.status === "queued") {
        failNextQueuedRetrySave = false;
        return { ok: false, error: "Could not save queued retry." };
      }
      queueItems = queueItems.map((item) => (item.id === updatedItem.id ? updatedItem : item));
      if (updatedItem.id === failedQueueItem.id && updatedItem.status === "queued") {
        retryQueueSaveCompleted = true;
      }
      return { ok: true };
    },
  };
}

function buildFailedQueueItem() {
  return {
    id: "queue-run-allthingsroleplay",
    ad_id: "ad-run",
    target_id: "allthingsroleplay",
    target_name: "allthingsroleplay",
    tumblr_account_id: "snowleopardx",
    submit_url: "https://allthingsroleplay.tumblr.com/submit",
    post_type: "photo",
    status: "failed",
    scheduled_for: null,
    timezone: "America/New_York",
    created_at: "2026-06-18T21:00:00.000Z",
    updated_at: "2026-06-18T21:00:00.000Z",
    last_run_at: null,
    posted_at: null,
    failed_at: "2026-06-18T21:04:00.000Z",
    notes: "Runner failed: browserContext.newPage: Target page, context or browser has been closed",
    runner_payload: JSON.stringify({ fields: { body: "Queue body" } }),
  };
}

async function routeLocalCompanion(page, companionState) {
  await page.route("http://127.0.0.1:17842/status", (route) => {
    if (!companionState.available) {
      return route.abort();
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        version: "local-runner-test",
        apiBaseUrl: "https://inkwell-production-f037.up.railway.app/api",
        workspaceId: "workspace-test",
        queueName: "Default queue",
        watching: true,
        running: false,
        status: "error",
        lastStartedAt: "2026-06-20T01:00:00.000Z",
        lastFinishedAt: "2026-06-20T01:00:10.000Z",
        lastExitCode: 1,
        lastError: "Local runner exited with code 1. Close any open Inkwell Tumblr browser windows, then try again.",
      }),
    });
  });
}

async function routeRetryBackendApis(page, apiHeaders, queueState, companionState) {
  await routeCompanionRun(page, queueState, companionState);
  await routeLocalCommand(page, apiHeaders, companionState);
  await routeTumblrAccounts(page, apiHeaders);
  await routeRunnerStatus(page, apiHeaders);
  await routeRunnerLogs(page, apiHeaders);
  await routeRetryQueue(page, apiHeaders, queueState);
  await routeRetryWorkspaceApis(page, apiHeaders);
}

async function routeCompanionRun(page, queueState, companionState) {
  await page.route("http://127.0.0.1:17842/run", (route) => {
    const payload = route.request().postDataJSON();
    if (companionState.requireQueueSaveBeforeRun && payload.submit === false) {
      assert.equal(queueState.wasRetryQueueSaveCompleted(), true);
    }
    companionState.runPayloads.push(payload);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        accepted: true,
        version: "local-runner-test",
        apiBaseUrl: "https://inkwell-production-f037.up.railway.app/api",
        workspaceId: "workspace-test",
        queueName: "Default queue",
        watching: true,
        running: true,
        status: "running",
      }),
    });
  });
}

async function routeLocalCommand(page, apiHeaders, companionState) {
  await page.route("http://127.0.0.1:8021/api/runner/local-command?**", (route) => {
    companionState.localCommandRequestCount += 1;
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command:
            "npm.cmd run tumblr:runner:local -- --api-base 'https://inkwell-production-f037.up.railway.app/api' --token 'ilr_private_token' --workspace-id 'workspace-test' --queue 'Default queue' --watch --serve",
          autoStartCommand: "",
          tokenConfigured: true,
          usesDeviceToken: true,
          tokenEnv: "INWELL_LOCAL_RUNNER_TOKEN",
          message: "Run this on your Windows computer from the repo checkout. The copied command includes a device token.",
        },
      }),
    });
  });
}

async function routeTumblrAccounts(page, apiHeaders) {
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        accounts: [
          {
            id: "snowleopardx",
            display_name: "Myrana Tumblr",
            blog_name: "snowleopardx",
            user_data_dir: "C:/sessions/snowleopardx",
            status: "connected",
            last_checked_at: new Date().toISOString(),
            last_login_at: new Date().toISOString(),
            notes: "Saved Tumblr login is healthy.",
            updated_at: "2026-06-18T21:00:00.000Z",
          },
        ],
      }),
    }),
  );
}

async function routeRunnerStatus(page, apiHeaders) {
  await page.route("http://127.0.0.1:8021/api/runner/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        runner: {
          running: false,
          pid: null,
          plan_path: "",
          command: [],
          run_id: "",
          local_runner: {
            online: true,
            last_seen_at: "2026-06-19T22:00:00.000Z",
            workspace_id: "workspace-test",
            queue_name: "Default queue",
            watching: true,
            status: "watching",
            version: "local-runner-test",
          },
        },
      }),
    }),
  );
}

async function routeRunnerLogs(page, apiHeaders) {
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
  );
}

async function routeRetryQueue(page, apiHeaders, queueState) {
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: queueState.getItems() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue/*", (route) => {
    const updatedItem = route.request().postDataJSON();
    const result = queueState.save(updatedItem);
    if (!result.ok) {
      return route.fulfill({
        contentType: "application/json",
        headers: apiHeaders,
        status: 500,
        body: JSON.stringify({ error: result.error }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ queue_item: updatedItem }),
    });
  });
}

async function routeRetryWorkspaceApis(page, apiHeaders) {
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          runnerSettings: {
            mediaDir: "",
            slowMo: 500,
            headless: false,
            submit: false,
            tumblrAccountId: "snowleopardx",
          },
          queueDefinitions: [{ id: "default-queue", name: "Default queue" }],
        },
      }),
    }),
  );
}

async function installRetryClipboardAndLocalState(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedText = String(value);
        },
      },
    });
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "ad-run",
        ads: [
          {
            id: "ad-run",
            postType: "photo",
            title: "Run queue ad",
            content: "<p>Queue body</p>",
            destinationBlog: "allthingsroleplay",
            forumUrl: "https://forum.example",
            tags: [],
            imageCaption: "",
            imageName: "sample-forum-ad.png",
            imageDataUrl: "/sample-forum-ad.png",
            videoUrl: "",
            videoName: "",
            status: "draft",
            updatedAt: "2026-06-18T21:00:00.000Z",
          },
        ],
      }),
    );
    localStorage.setItem(
      "inwell-tumblr-submit-targets",
      JSON.stringify([
        { id: "allthingsroleplay", name: "allthingsroleplay", submitUrl: "https://allthingsroleplay.tumblr.com/submit" },
      ]),
    );
  });
}

async function openRetryQueue(page, openWorkspaceView) {
  await openWorkspaceView(page, "Queues");
  await page.locator(".queue-management-row", { hasText: "Default queue" }).getByRole("button", { name: "Open queue" }).click();
  await page.getByText("Why this failed").waitFor();
}

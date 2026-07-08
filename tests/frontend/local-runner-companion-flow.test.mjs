import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";

const appUrl = "http://127.0.0.1:8123";
const apiHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
  "Access-Control-Allow-Origin": appUrl,
};

test("local companion run errors do not fall back to copied runner commands", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  let localCommandRequestCount = 0;

  await routeRunnerWorkspace(page, {
    accounts: [apiTumblrAccount()],
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "tumblr-runner" },
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "ad-run-focused",
        ads: [
          {
            id: "ad-run-focused",
            postType: "photo",
            title: "Focused runner ad",
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
            updatedAt: "2026-06-20T00:00:00.000Z",
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
  await page.route("http://127.0.0.1:8021/api/runner/local-command?**", (route) => {
    localCommandRequestCount += 1;
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command: "npm.cmd run tumblr:runner:local -- --token private",
          autoStartCommand: "",
          tokenConfigured: true,
          usesDeviceToken: true,
          tokenEnv: "INWELL_LOCAL_RUNNER_TOKEN",
          message: "Run this on your Windows computer from the repo checkout.",
        },
      }),
    });
  });
  await page.route("http://127.0.0.1:17842/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(localCompanionStatus({ status: "watching", running: false })),
    }),
  );
  await page.route("http://127.0.0.1:17842/run", (route) => route.abort());

  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner");
  await page.getByLabel("Runner controls").getByRole("button", { name: "Test run", exact: true }).waitFor();
  const approveLivePosting = page.getByLabel("Runner browser session").getByLabel("Approve live posting");
  if ((await approveLivePosting.count()) > 0 && !(await approveLivePosting.isChecked())) {
    await approveLivePosting.check();
  }
  await page.unroute("http://127.0.0.1:17842/status");
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await page.getByLabel("Runner controls").getByRole("button", { name: "Test run", exact: true }).click();

  await page.getByText("Local companion could not start the runner. Local companion did not respond to the run request.").waitFor();
  await page.getByText("Local companion was not detected on this computer", { exact: false }).waitFor({ state: "detached" });
  assert.equal(localCommandRequestCount, 0);
});

test("normal runner actions stop when queued items need review", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  let companionRunRequestCount = 0;
  let localCommandRequestCount = 0;

  await routeRunnerWorkspace(page, {
    accounts: [apiTumblrAccount()],
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "tumblr-runner" },
    queueItems: [
      defaultApiQueueItem({ id: "queue-ready", status: "queued" }),
      defaultApiQueueItem({ id: "queue-failed", status: "failed", notes: "Runner failed." }),
    ],
    localCompanion: localCompanionStatus({ status: "watching", running: false }),
  });
  await page.route("http://127.0.0.1:17842/run", (route) => {
    companionRunRequestCount += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, accepted: true }) });
  });
  await page.route("http://127.0.0.1:8021/api/runner/local-command?**", (route) => {
    localCommandRequestCount += 1;
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command: "npm.cmd run tumblr:runner:local -- --token private",
          autoStartCommand: "",
          tokenConfigured: true,
          usesDeviceToken: true,
          tokenEnv: "INWELL_LOCAL_RUNNER_TOKEN",
          message: "Run this on your Windows computer from the repo checkout.",
        },
      }),
    });
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner");
  const runnerControls = page.getByLabel("Runner controls");
  assert.equal(await runnerControls.getByRole("button", { name: "Run", exact: true }).isDisabled(), true);
  assert.equal(await runnerControls.getByRole("button", { name: "Test run", exact: true }).isDisabled(), true);
  await page.getByLabel("Runner status").getByRole("heading", { name: "Automation needs queue review" }).waitFor();
  assert.equal(companionRunRequestCount, 0);
  assert.equal(localCommandRequestCount, 0);
});

test("unavailable companion live run copies a live local command fallback", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  let companionRunRequestCount = 0;
  let localCommandHeadless = "";
  let localCommandSubmit = "";

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedText = String(value);
        },
      },
    });
  });
  await routeRunnerWorkspace(page, {
    accounts: [apiTumblrAccount()],
    runnerOnline: false,
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "tumblr-runner", discordWebhookConfigured: true },
  });
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/run", (route) => {
    companionRunRequestCount += 1;
    return route.abort();
  });
  await page.route("http://127.0.0.1:8021/api/runner/local-command?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    localCommandHeadless = params.get("headless") || "";
    localCommandSubmit = params.get("submit") || "";
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command: "npm.cmd run tumblr:runner:local -- --token private --headless --submit",
          autoStartCommand: "",
          tokenConfigured: true,
          usesDeviceToken: true,
          tokenEnv: "INWELL_LOCAL_RUNNER_TOKEN",
          message: "Run this on your Windows computer from the repo checkout.",
        },
      }),
    });
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner");
  const localCommandResponse = page.waitForResponse((response) => response.url().includes("/api/runner/local-command"));
  const runnerControls = page.getByLabel("Runner controls");
  assert.equal(await runnerControls.getByRole("button", { name: "Run", exact: true }).isDisabled(), false);
  assert.equal(await runnerControls.getByRole("button", { name: "Test run", exact: true }).isDisabled(), false);
  await runnerControls.getByRole("button", { name: "Run", exact: true }).click();
  await localCommandResponse;

  await page.getByText("Local runner command copied. Local companion was not detected on this computer, so the queue was not started", { exact: false }).waitFor();
  assert.equal(localCommandHeadless, "true");
  assert.equal(localCommandSubmit, "true");
  assert.equal(companionRunRequestCount, 0);
  assert.match(await page.evaluate(() => window.__copiedText), /--headless/);
  assert.match(await page.evaluate(() => window.__copiedText), /--submit/);
});

test("unavailable companion test run copies a prep local command fallback", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  let companionRunRequestCount = 0;
  let localCommandHeadless = "";
  let localCommandSubmit = "";

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedText = String(value);
        },
      },
    });
  });
  await routeRunnerWorkspace(page, {
    accounts: [apiTumblrAccount()],
    runnerOnline: false,
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: false, tumblrAccountId: "tumblr-runner", discordWebhookConfigured: true },
  });
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/run", (route) => {
    companionRunRequestCount += 1;
    return route.abort();
  });
  await page.route("http://127.0.0.1:8021/api/runner/local-command?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    localCommandHeadless = params.get("headless") || "";
    localCommandSubmit = params.get("submit") || "";
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command: "npm.cmd run tumblr:runner:local -- --token private --headless",
          autoStartCommand: "",
          tokenConfigured: true,
          usesDeviceToken: true,
          tokenEnv: "INWELL_LOCAL_RUNNER_TOKEN",
          message: "Run this on your Windows computer from the repo checkout.",
        },
      }),
    });
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner");
  const localCommandResponse = page.waitForResponse((response) => response.url().includes("/api/runner/local-command"));
  const runnerControls = page.getByLabel("Runner controls");
  assert.equal(await runnerControls.getByRole("button", { name: "Run", exact: true }).isDisabled(), false);
  assert.equal(await runnerControls.getByRole("button", { name: "Test run", exact: true }).isDisabled(), false);
  await runnerControls.getByRole("button", { name: "Test run", exact: true }).click();
  await localCommandResponse;

  await page.getByText("Local runner command copied. Local companion was not detected on this computer, so the test run was not started.", { exact: false }).waitFor();
  await page.getByText("Discord will not post until a live local runner command runs.", { exact: false }).waitFor({ state: "detached" });
  assert.equal(localCommandHeadless, "true");
  assert.equal(localCommandSubmit, "false");
  assert.equal(companionRunRequestCount, 0);
  assert.match(await page.evaluate(() => window.__copiedText), /--headless/);
  assert.doesNotMatch(await page.evaluate(() => window.__copiedText), /--submit/);
});

test("headless runner download requests a headless local package", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  let localPackageHeadless = "";
  let localPackageSubmit = "";

  await page.addInitScript(() => {
    URL.createObjectURL = () => "blob:http://127.0.0.1:8123/local-runner.zip";
    URL.revokeObjectURL = () => undefined;
  });
  await routeRunnerWorkspace(page, {
    accounts: [apiTumblrAccount()],
    runnerOnline: false,
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: false, tumblrAccountId: "tumblr-runner", discordWebhookConfigured: true },
  });
  await page.route("http://127.0.0.1:8021/api/runner/local-package?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    localPackageHeadless = params.get("headless") || "";
    localPackageSubmit = params.get("submit") || "";
    return route.fulfill({
      contentType: "application/zip",
      headers: {
        ...apiHeaders,
        "Content-Disposition": 'attachment; filename="inkwell-local-runner.zip"',
      },
      body: "zip",
    });
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner");
  const packageResponse = page.waitForResponse((response) => response.url().includes("/api/runner/local-package"));
  await page.getByLabel("Runner controls").getByRole("button", { name: "Download" }).click();
  await packageResponse;

  await page.getByText("Local runner installer downloaded.").waitFor();
  assert.equal(localPackageHeadless, "true");
  assert.equal(localPackageSubmit, "false");
});

test("scheduled queue shows runner recovery when daily automation is blocked offline", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  await routeRunnerWorkspace(page, { runnerOnline: false, scheduleEnabled: true });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Queue");
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Toggle schedule section" }).click();

  await page.getByText("Daily automation is waiting for the local runner").waitFor();
  await page.getByText("Headless mode is enabled. Start the local runner to run in the background.").waitFor();
  await page.getByText("If the scheduled time already passed today", { exact: false }).waitFor();

  await page.getByRole("button", { name: "Open runner" }).click();
  await page.getByLabel("Runner controls").getByRole("button", { name: "Test run", exact: true }).waitFor();
});

test("scheduled queue shows recovery when local runner is online but not watching", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  await routeRunnerWorkspace(page, { runnerOnline: true, runnerWatching: false, runnerStatus: "idle", scheduleEnabled: true });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Queue");
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Toggle schedule section" }).click();

  await page.getByText("Runner idle").waitFor();
  await page.getByText("Local runner is online but is not watching this queue.").waitFor();
  await page.getByText("Daily automation is waiting for the local runner").waitFor();
});

test("scheduled queue shows recovery when local runner watches a different queue", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  await routeRunnerWorkspace(page, { runnerQueueName: "Other queue", scheduleEnabled: true });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Queue");
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Toggle schedule section" }).click();

  await page.getByText("Wrong queue").waitFor();
  await page.getByText("Local runner is watching Other queue. Switch it to Default queue before the daily run.").waitFor();
  await page.getByText("Daily automation is waiting for the local runner").waitFor();
});

test("scheduled queue prioritizes local companion recovery states", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const cases = [
    {
      companion: localCompanionStatus({ watching: false, status: "idle" }),
      label: "Runner idle",
      detail: "Local companion is connected but is not watching this queue.",
    },
    {
      companion: localCompanionStatus({ watching: false, status: "error", lastError: "Runner failed." }),
      label: "Needs attention",
      detail: "Runner failed.",
    },
    {
      companion: localCompanionStatus({ queueName: "Other queue", watching: true, status: "watching" }),
      label: "Wrong queue",
      detail: "Local runner is watching Other queue. Switch it to Default queue before the daily run.",
    },
  ];

  for (const scenario of cases) {
    const page = await browser.newPage();
    await routeRunnerWorkspace(page, { localCompanion: scenario.companion, scheduleEnabled: true });

    await page.goto(appUrl);
    await openWorkspaceView(page, "Queue");
    await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
    await page.getByRole("button", { name: "Toggle schedule section" }).click();

    await page.getByText(scenario.label).waitFor();
    await page.getByText(scenario.detail).waitFor();
    await page.getByText("Daily automation is waiting for the local runner").waitFor();
    await page.getByRole("button", { name: "Open runner" }).click();
    await page.getByLabel("Runner controls").getByRole("button", { name: "Test run", exact: true }).waitFor();
    await page.close();
  }
});

async function routeRunnerWorkspace(page, options = {}) {
  const runnerOnline = options.runnerOnline ?? true;
  const runnerWatching = options.runnerWatching ?? runnerOnline;
  const runnerQueueName = options.runnerQueueName ?? "Default queue";
  const runnerStatus = options.runnerStatus ?? (runnerWatching ? "watching" : "offline");
  const runnerVersion = options.runnerVersion ?? "local-runner-test";
  const scheduleEnabled = options.scheduleEnabled ?? false;
  const runnerSettings = options.runnerSettings ?? { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "" };
  const accounts = options.accounts ?? [];
  const queueItems = options.queueItems ?? [defaultApiQueueItem()];
  const runnerLogs = options.runnerLogs ?? [];
  await page.route("http://127.0.0.1:8021/api/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        authenticated: true,
        bootstrapRequired: false,
        user: {
          id: "user-test",
          email: "myrana@example.test",
          displayName: "Myrana",
          workspace: { id: "workspace-test", name: "Myrana workspace" },
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts }) }),
  );
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
          runnerSettings,
          queueScheduleSettings: {
            enabled: scheduleEnabled,
            dailyTime: "09:00",
            timezone: "America/New_York",
            perQueue: {
              "Default queue": {
                enabled: scheduleEnabled,
                dailyTime: "09:00",
                timezone: "America/New_York",
              },
            },
          },
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: runnerLogs }) }),
  );
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
            online: runnerOnline,
            last_seen_at: "2026-06-20T01:00:00.000Z",
            workspace_id: "workspace-test",
            queue_name: runnerQueueName,
            watching: runnerWatching,
            status: runnerOnline ? runnerStatus : "offline",
            version: runnerVersion,
          },
        },
      }),
    }),
  );
  if (options.localCompanion) {
    await page.route("http://127.0.0.1:17842/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(options.localCompanion),
      }),
    );
  } else {
    await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  }
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        queue: queueItems,
      }),
    }),
  );
}

function defaultApiQueueItem(overrides = {}) {
  return {
    id: "queue-run-focused",
    queue_name: "Default queue",
    ad_id: "ad-run-focused",
    target_id: "allthingsroleplay",
    target_name: "allthingsroleplay",
    submit_url: "https://allthingsroleplay.tumblr.com/submit",
    post_type: "photo",
    status: "queued",
    notes: "Ready for local browser runner.",
    runner_payload: "{}",
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
    last_run_at: null,
    ...overrides,
  };
}

function apiRunnerLog(overrides = {}) {
  return {
    id: "log-flow",
    run_id: "run-flow",
    queue_item_id: "queue-run-focused",
    target_name: "allthingsroleplay",
    level: "info",
    message: "Runner event.",
    details: {},
    created_at: "2026-06-20T00:01:00.000Z",
    ...overrides,
  };
}

function apiTumblrAccount(overrides = {}) {
  return {
    id: "tumblr-runner",
    display_name: "Runner Tumblr",
    blog_name: "runnerblog",
    user_data_dir: "C:/tumblr/runner",
    status: "connected",
    last_checked_at: new Date().toISOString(),
    last_login_at: "2026-06-20T00:00:00.000Z",
    notes: "",
    updated_at: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function localCompanionStatus(overrides = {}) {
  return {
    ok: true,
    version: "local-runner-test",
    apiBaseUrl: "https://inkwell-production-f037.up.railway.app/api",
    workspaceId: "workspace-test",
    queueName: "Default queue",
    watching: true,
    running: false,
    status: "watching",
    lastStartedAt: "",
    lastFinishedAt: "",
    lastExitCode: null,
    lastExitSignal: "",
    lastBlockerCode: "",
    lastDiscordSummary: null,
    lastError: "",
    lastRun: null,
    ...overrides,
  };
}

function discordCompanionLastRun(overrides = {}) {
  return {
    queueName: "Default queue",
    headless: true,
    submit: false,
    itemCount: 1,
    runId: "discord-status-test",
    startedAt: "2026-06-20T00:00:00.000Z",
    finishedAt: "2026-06-20T00:01:00.000Z",
    exitCode: 0,
    exitSignal: "",
    blockerCode: "",
    status: "idle",
    ...overrides,
  };
}

async function openWorkspaceView(page, viewName) {
  const workspaceViews = page.getByLabel("Workspace views");
  await workspaceViews.waitFor();
  const directButton = workspaceViews.getByRole("button", { name: viewName, exact: true });
  if ((await directButton.count()) > 0 && await directButton.first().isVisible()) {
    await directButton.first().click();
    return;
  }

  const operationCardNames = {
    Queue: "Submission queue",
    Runner: "Runner controls",
  };

  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByRole("button", { name: operationCardNames[viewName] ?? viewName, exact: true }).first().click();
}

function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    async function poll() {
      try {
        const response = await fetch(url);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Vite is still starting.
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }

      setTimeout(poll, 250);
    }

    void poll();
  });
}

function stopProcessTree(childProcess) {
  if (!childProcess.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(childProcess.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  childProcess.kill();
}

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
test("daily automation readiness grid reflects blocked, empty, and runnable states", { timeout: 40000 }, async (t) => {
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
      options: { runnerOnline: false, scheduleEnabled: false },
      expected: ["Runner readiness", "Off", "Enable daily automation to check runner readiness.", "Queue readiness", "1 runnable", "Automation state", "Off"],
      rejected: ["Fix the blocked readiness item first.", "Use the recovery panel below."],
    },
    {
      options: { runnerOnline: false, scheduleEnabled: true },
      expected: ["Runner readiness", "Blocked", "Queue readiness", "1 runnable", "Automation state", "Will not run yet"],
    },
    {
      options: { runnerOnline: true, runnerWatching: true, scheduleEnabled: true, queueItems: [] },
      expected: ["Runner readiness", "Ready", "Queue readiness", "0 runnable", "Automation state", "Will not run yet"],
    },
    {
      options: { runnerOnline: true, runnerWatching: true, scheduleEnabled: true, queueItems: [defaultApiQueueItem({ status: "failed" })] },
      expected: ["Runner readiness", "Ready", "Queue readiness", "0 runnable", "Automation state", "Needs review"],
      rejected: ["Will run"],
    },
    {
      options: {
        runnerOnline: true,
        runnerWatching: true,
        scheduleEnabled: true,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-failed", status: "failed" })],
      },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Needs review", "Clear failed or review-needed submissions first."],
      rejected: ["Will run"],
    },
    {
      options: { runnerOnline: true, runnerWatching: true, scheduleEnabled: true, queueItems: [defaultApiQueueItem({ status: "needs-review" })] },
      expected: ["Runner readiness", "Ready", "Queue readiness", "0 runnable", "Automation state", "Needs review"],
      rejected: ["Will run"],
    },
    {
      options: {
        runnerOnline: true,
        runnerWatching: true,
        scheduleEnabled: true,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-review", status: "needs-review" })],
      },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Needs review", "Clear failed or review-needed submissions first."],
      rejected: ["Will run"],
    },
    {
      options: { runnerOnline: true, runnerWatching: true, scheduleEnabled: true, queueItems: [defaultApiQueueItem({ status: "running" })] },
      expected: ["Runner readiness", "Ready", "Queue readiness", "0 runnable", "Automation state", "Will not run yet"],
      rejected: ["Will run"],
    },
    {
      options: { runnerOnline: true, runnerWatching: true, scheduleEnabled: true },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Will run"],
    },
  ];

  for (const scenario of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await routeRunnerWorkspace(page, scenario.options);
    await page.goto(appUrl);
    await openWorkspaceView(page, "Queue");
    await page.getByRole("button", { name: "Toggle schedule section" }).click();

    const readiness = page.getByLabel("Daily automation readiness");
    await readiness.getByText("Next run", { exact: true }).first().waitFor();
    for (const expectedText of scenario.expected) {
      await readiness.getByText(expectedText, { exact: true }).first().waitFor();
    }
    for (const rejectedText of scenario.rejected ?? []) {
      await readiness.getByText(rejectedText, { exact: true }).waitFor({ state: "detached" });
    }
    await context.close();
  }
});

test("runner flow strip summarizes readiness, live approval, and latest run outcomes", { timeout: 40000 }, async (t) => {
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

  const connectedAccounts = [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr" })];
  const liveRunnerSettings = {
    mediaDir: "",
    slowMo: 500,
    headless: true,
    submit: true,
    tumblrAccountId: "tumblr-runner",
    discordWebhookConfigured: false,
  };
  const cases = [
    {
      options: {
        runnerOnline: false,
        queueItems: [],
        runnerSettings: { ...liveRunnerSettings, submit: false, tumblrAccountId: "" },
      },
      expected: ["Check runner, account, or queue content.", "Prep mode until live posting is approved.", "No run - run the queue to record logs."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerOnline: true,
        runnerWatching: false,
        runnerStatus: "idle",
        runnerSettings: liveRunnerSettings,
      },
      expected: ["Check runner, account, or queue content."],
      rejected: ["Runner, account, and queue are ready."],
    },
    {
      options: {
        accounts: connectedAccounts,
        localCompanion: localCompanionStatus({ watching: false, status: "idle" }),
        runnerSettings: liveRunnerSettings,
      },
      expected: ["Check runner, account, or queue content."],
      rejected: ["Runner, account, and queue are ready."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: liveRunnerSettings,
      },
      expected: ["Runner, account, and queue are ready.", "Live posting approved.", "No run - run the queue to record logs."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: liveRunnerSettings,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-failed", status: "failed" })],
      },
      expected: ["Review failed or needs-review queue items first."],
      rejected: ["Runner, account, and queue are ready."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: liveRunnerSettings,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-review", status: "needs-review" })],
      },
      expected: ["Review failed or needs-review queue items first."],
      rejected: ["Runner, account, and queue are ready."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: liveRunnerSettings,
        runnerLogs: [apiRunnerLog({ level: "error", message: "Tumblr rejected the post." })],
      },
      expected: ["Failed"],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: liveRunnerSettings,
        runnerLogs: [apiRunnerLog({ id: "log-warning", level: "warning", message: "Manual review needed." })],
      },
      expected: ["Needs review"],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: liveRunnerSettings,
        runnerLogs: [apiRunnerLog({ id: "log-success", level: "info", message: "Posted successfully." })],
      },
      expected: ["Recorded"],
    },
  ];

  for (const scenario of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await routeRunnerWorkspace(page, scenario.options);
    await page.goto(appUrl);
    await openWorkspaceView(page, "Runner");

    const flow = page.getByLabel("Runner flow");
    await flow.getByText("Readiness", { exact: true }).waitFor();
    await flow.getByText("Run controls", { exact: true }).waitFor();
    await flow.getByText("Latest result", { exact: true }).waitFor();
    for (const expectedText of scenario.expected) {
      await flow.getByText(expectedText, { exact: false }).waitFor();
    }
    if (scenario.expected.some((text) => text.includes("No run"))) {
      await flow.locator(".runner-flow-step.warning", { hasText: "No run" }).waitFor();
    }
    for (const rejectedText of scenario.rejected ?? []) {
      await flow.getByText(rejectedText, { exact: true }).waitFor({ state: "detached" });
    }
    await context.close();
  }
});

test("runner workspace shows Discord webhook runner diagnostics", { timeout: 40000 }, async (t) => {
  await withRunnerDiagnosticsPage(
    t,
    {
      localCompanion: localCompanionStatus({
        version: "local-runner-2",
        lastDiscordSummary: {
          status: "skipped",
          reason: "not-live-run",
          message: "Discord summary skipped because this was a test run.",
        },
        lastRun: discordCompanionLastRun({
          discordSummary: {
            status: "skipped",
            reason: "not-live-run",
            message: "Discord summary skipped because this was a test run.",
          },
        }),
      }),
    },
    async (page) => {
      const runnerSession = page.getByLabel("Runner browser session");
      await runnerSession.getByText("Discord webhook saved, but this local runner is older.", { exact: false }).waitFor();
      await runnerSession.getByText("Restart or download the runner before expecting Discord summaries.", { exact: false }).waitFor();
    },
  );
});

test("runner workspace warns for older backend runner heartbeat when companion status is unavailable", { timeout: 40000 }, async (t) => {
  await withRunnerDiagnosticsPage(t, { runnerVersion: "local-runner-2" }, async (page) => {
    const runnerSession = page.getByLabel("Runner browser session");
    await runnerSession.getByText("Version local-runner-2", { exact: false }).waitFor();
    await runnerSession.getByText("Discord webhook saved, but this local runner is older.", { exact: false }).waitFor();
  });
});

test("runner workspace accepts newer local runner versions for Discord webhooks", { timeout: 40000 }, async (t) => {
  await withRunnerDiagnosticsPage(t, { runnerVersion: "local-runner-4" }, async (page) => {
    const runnerSession = page.getByLabel("Runner browser session");
    await runnerSession.getByText("Version local-runner-4", { exact: false }).waitFor();
    await runnerSession.getByText("Discord webhook saved, but this local runner is older.", { exact: false }).waitFor({ state: "detached" });
    await page.getByLabel("Runner readiness").getByText("Discord summaries will post after live runs.").waitFor();
  });
});

test("runner workspace warns when Discord webhook runner version is unverified", { timeout: 40000 }, async (t) => {
  await withRunnerDiagnosticsPage(t, { runnerVersion: "local-runner-test" }, async (page) => {
    const runnerSession = page.getByLabel("Runner browser session");
    await runnerSession.getByText("Version local-runner-test", { exact: false }).waitFor();
    await runnerSession.getByText("Discord webhook saved, but this runner version could not be verified.", { exact: false }).waitFor();
    await page.getByLabel("Runner readiness").getByText("Discord summaries will post after live runs.").waitFor({ state: "detached" });
  });
});

async function withRunnerDiagnosticsPage(t, routeOptions, assertion) {
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
  await routeRunnerWorkspace(page, {
    ...routeOptions,
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "", discordWebhookConfigured: true },
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner");
  await assertion(page);
}

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
    last_checked_at: "2026-06-20T00:00:00.000Z",
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

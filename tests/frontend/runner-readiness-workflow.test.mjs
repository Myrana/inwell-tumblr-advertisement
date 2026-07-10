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

  const connectedAccounts = [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr" })];
  const selectedRunnerSettings = { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "tumblr-runner" };
  const cases = [
    {
      options: { runnerOnline: false, scheduleEnabled: false },
      expected: ["Runner readiness", "Off", "Enable daily automation to check runner readiness.", "Queue readiness", "1 runnable", "Automation state", "Off"],
      rejected: ["Fix the blocked readiness item first.", "Use the recovery panel below."],
    },
    {
      options: { runnerOnline: false, scheduleEnabled: true },
      expected: ["Runner readiness", "Blocked", "Queue readiness", "1 runnable", "Automation state", "Runner offline"],
    },
    {
      options: { accounts: connectedAccounts, runnerSettings: selectedRunnerSettings, runnerOnline: true, runnerWatching: true, scheduleEnabled: true, queueItems: [] },
      expected: ["Runner readiness", "Ready", "Queue readiness", "0 runnable", "Automation state", "Will not run yet"],
    },
    {
      options: { accounts: connectedAccounts, runnerSettings: selectedRunnerSettings, runnerOnline: true, runnerWatching: true, scheduleEnabled: true, queueItems: [defaultApiQueueItem({ status: "failed" })] },
      expected: ["Runner readiness", "Ready", "Queue readiness", "0 runnable", "Automation state", "Needs review"],
      rejected: ["Will run"],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: selectedRunnerSettings,
        runnerOnline: true,
        runnerWatching: true,
        scheduleEnabled: true,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-failed", status: "failed" })],
      },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Will run", "Daily automation will skip 1 review item."],
      rejected: ["Clear failed or review-needed submissions first."],
    },
    {
      options: { accounts: connectedAccounts, runnerSettings: selectedRunnerSettings, runnerOnline: true, runnerWatching: true, scheduleEnabled: true, queueItems: [defaultApiQueueItem({ status: "needs-review" })] },
      expected: ["Runner readiness", "Ready", "Queue readiness", "0 runnable", "Automation state", "Needs review"],
      rejected: ["Will run"],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: selectedRunnerSettings,
        runnerOnline: true,
        runnerWatching: true,
        scheduleEnabled: true,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-review", status: "needs-review" })],
      },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Will run", "Daily automation will skip 1 review item."],
      rejected: ["Clear failed or review-needed submissions first."],
    },
    {
      options: { accounts: connectedAccounts, runnerSettings: selectedRunnerSettings, runnerOnline: true, runnerWatching: true, scheduleEnabled: true, queueItems: [defaultApiQueueItem({ status: "running" })] },
      expected: ["Runner readiness", "Ready", "Queue readiness", "0 runnable", "Automation state", "Will not run yet"],
      rejected: ["Will run"],
    },
    {
      options: { accounts: connectedAccounts, runnerSettings: selectedRunnerSettings, runnerOnline: true, runnerWatching: true, scheduleEnabled: true },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Will run"],
    },
    {
      options: { accounts: connectedAccounts, runnerOnline: true, runnerWatching: true, scheduleEnabled: true },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Needs account", "Select a connected Tumblr account."],
      rejected: ["Will run"],
    },
    {
      options: {
        accounts: [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr", status: "needs-login" })],
        runnerSettings: selectedRunnerSettings,
        runnerOnline: true,
        runnerWatching: true,
        scheduleEnabled: true,
      },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Needs account", "Connect a Tumblr account."],
      rejected: ["Will run"],
    },
    {
      options: {
        accounts: [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr", status: "needs-login" })],
        runnerSettings: selectedRunnerSettings,
        runnerOnline: true,
        runnerWatching: true,
        scheduleEnabled: true,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-failed", status: "failed" })],
      },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Needs account", "Connect a Tumblr account."],
      rejected: ["Will run", "Needs review", "Clear failed or review-needed submissions first."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: { ...selectedRunnerSettings, tumblrAccountId: "" },
        runnerOnline: true,
        runnerWatching: true,
        scheduleEnabled: true,
      },
      expected: ["Runner readiness", "Ready", "Queue readiness", "1 runnable", "Automation state", "Needs account", "Select a connected Tumblr account."],
      rejected: ["Will run"],
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
      expected: ["Connect a Tumblr account.", "Prep mode until live posting is approved.", "No run - run the queue to record logs."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerOnline: true,
        runnerWatching: false,
        runnerStatus: "idle",
        runnerSettings: liveRunnerSettings,
      },
      expected: ["Local runner is online but is not watching this queue. Open Runner controls and start the watcher before the daily run."],
      rejected: ["Runner, account, and queue are ready."],
    },
    {
      options: {
        accounts: connectedAccounts,
        localCompanion: localCompanionStatus({ watching: false, status: "idle" }),
        runnerSettings: liveRunnerSettings,
      },
      expected: ["Local companion is connected but is not watching this queue. Open Runner controls and start the watcher before the daily run."],
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
      expected: ["Runner can continue with runnable items while review items stay parked."],
      rejected: ["Review failed or needs-review queue items first."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: liveRunnerSettings,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-review", status: "needs-review" })],
      },
      expected: ["Runner can continue with runnable items while review items stay parked."],
      rejected: ["Review failed or needs-review queue items first."],
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings: { ...liveRunnerSettings, tumblrAccountId: "" },
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-review", status: "needs-review" })],
      },
      expected: ["Select a connected Tumblr account."],
      rejected: ["Only review-needed queue items are available."],
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

    await page.getByLabel("Runner health summary").getByText("Runner state").waitFor();
    await page.getByLabel("System diagnostics").getByText("Runner version").waitFor();
    await page.getByLabel("Automation timeline").getByText("Validate queue").waitFor();
    await page.getByLabel("Automation timeline").getByText("Authenticate Tumblr").waitFor();
    await page.getByLabel("System diagnostics").getByText("Queue integrity").waitFor();
    if (scenario.expected.includes("Runner, account, and queue are ready.")) {
      await page.getByLabel("System diagnostics").getByText("Healthy", { exact: true }).waitFor();
      await page.getByLabel("System diagnostics").getByText("Optional", { exact: true }).waitFor();
    }
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

test("runner hero and health summary require full execution readiness", { timeout: 40000 }, async (t) => {
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
  const staleConnectedAccounts = [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr", last_checked_at: "2026-06-20T00:00:00.000Z" })];
  const selectedRunnerSettings = { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "tumblr-runner" };
  const cases = [
    {
      name: "empty queue",
      options: { accounts: connectedAccounts, runnerSettings: selectedRunnerSettings, queueItems: [] },
      title: "Automation needs queued advertisements",
      detail: "Add ready advertisements to Default queue before starting the runner.",
      ready: false,
    },
    {
      name: "attention-blocked queue",
      options: {
        accounts: connectedAccounts,
        runnerSettings: selectedRunnerSettings,
        queueItems: [defaultApiQueueItem({ id: "queue-failed", status: "failed" })],
      },
      title: "Automation needs queue review",
      detail: "Clear 1 failed or review-needed item before running Default queue.",
      ready: false,
    },
    {
      name: "runnable queue with parked review item",
      options: {
        accounts: connectedAccounts,
        runnerSettings: selectedRunnerSettings,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-failed", status: "failed" })],
      },
      title: "Automation is ready to watch the queue",
      detail: "Runner Tumblr can run 1 queued advertisement while 1 item stays in review.",
      ready: true,
    },
    {
      name: "missing selected account",
      options: { accounts: connectedAccounts, runnerSettings: { ...selectedRunnerSettings, tumblrAccountId: "" } },
      title: "Automation needs a selected Tumblr account",
      detail: "Select a connected Tumblr account.",
      ready: false,
      assertNoCommand: true,
      diagnostics: {
        status: "Check",
        detail: "Select a connected Tumblr account.",
      },
    },
    {
      name: "stale selected account",
      options: { accounts: staleConnectedAccounts, runnerSettings: selectedRunnerSettings },
      title: "Automation needs a selected Tumblr account",
      detail: "Check saved Tumblr login before starting the runner.",
      ready: false,
      setupReady: false,
      assertNoCommand: true,
      diagnostics: {
        status: "Check",
        detail: "Check saved Tumblr login before starting the runner.",
      },
    },
    {
      name: "unready local runner",
      options: { accounts: connectedAccounts, runnerOnline: false, runnerSettings: selectedRunnerSettings },
      title: "Automation needs local runner recovery",
      detail: "Headless mode is enabled. Start the local runner to run in the background.",
      ready: false,
      manualReady: true,
    },
    {
      name: "full execution readiness",
      options: { accounts: connectedAccounts, runnerSettings: selectedRunnerSettings },
      title: "Automation is ready to watch the queue",
      detail: "Runner Tumblr can run 1 queued advertisement.",
      ready: true,
    },
  ];

  for (const scenario of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const runnerRequests = { companionRun: 0, localCommand: 0 };
    await routeRunnerWorkspace(page, { ...scenario.options, runnerRequests });
    await page.goto(appUrl);
    await openWorkspaceView(page, "Runner");

    const hero = page.getByLabel("Runner status");
    await hero.getByRole("heading", { name: scenario.title }).waitFor();
    await hero.getByText(scenario.detail, { exact: false }).waitFor();
    const runnerStateCard = page.getByLabel("Runner health summary").locator("article", { hasText: "Runner state" });
    const lowerControls = page.getByLabel("Runner controls");
    const runnerStateClass = await runnerStateCard.getAttribute("class");
    if (scenario.ready) {
      assert.match(runnerStateClass ?? "", /\bready\b/, scenario.name);
      await hero.getByRole("button", { name: "Run queue" }).waitFor({ state: "visible" });
      assert.equal(await hero.getByRole("button", { name: "Run queue" }).isDisabled(), false, scenario.name);
      assert.equal(await lowerControls.getByRole("button", { name: "Run", exact: true }).isDisabled(), false, scenario.name);
      assert.equal(await lowerControls.getByRole("button", { name: "Test run" }).isDisabled(), false, scenario.name);
      if (scenario.name === "runnable queue with parked review item") {
        await page.getByLabel("System diagnostics").getByText("1 runnable; 1 review item parked").waitFor();
        await page.getByLabel("Automation timeline").getByText("1 runnable; 1 review item parked").waitFor();
      }
    } else {
      assert.doesNotMatch(runnerStateClass ?? "", /\bready\b/, scenario.name);
      await hero.getByRole("heading", { name: "Automation is ready to watch the queue" }).waitFor({ state: "detached" });
      assert.equal(await hero.getByRole("button", { name: "Run queue" }).isDisabled(), !scenario.manualReady, scenario.name);
      assert.equal(await lowerControls.getByRole("button", { name: "Run", exact: true }).isDisabled(), !scenario.manualReady, scenario.name);
      assert.equal(await lowerControls.getByRole("button", { name: "Test run" }).isDisabled(), !scenario.manualReady, scenario.name);
      const selectedAccountId = scenario.options?.runnerSettings?.tumblrAccountId ?? "";
      const setupReady = scenario.setupReady ?? Boolean(selectedAccountId && scenario.options?.accounts?.some((account) => account.id === selectedAccountId && account.status === "connected"));
      assert.equal(await lowerControls.getByRole("button", { name: "Setup" }).isDisabled(), !setupReady, scenario.name);
      if (scenario.diagnostics) {
        const diagnostics = page.getByLabel("System diagnostics");
        await diagnostics.getByText(scenario.diagnostics.status, { exact: true }).waitFor();
        await diagnostics.getByText(scenario.diagnostics.detail, { exact: true }).waitFor();
        await diagnostics.getByText("Healthy", { exact: true }).waitFor({ state: "detached" });
      }
      if (scenario.assertNoCommand) {
        assert.deepEqual(runnerRequests, { companionRun: 0, localCommand: 0 }, scenario.name);
      }
    }
    await context.close();
  }
});

test("manual runner controls stay available for recoverable scheduled-run blockers", { timeout: 40000 }, async (t) => {
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
  const staleConnectedAccounts = [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr", last_checked_at: "2026-06-20T00:00:00.000Z" })];
  const runnerSettings = { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "tumblr-runner" };
  const cases = [
    {
      name: "offline runner",
      options: { accounts: connectedAccounts, runnerOnline: false, runnerSettings },
      detail: "Headless mode is enabled. Start the local runner to run in the background.",
    },
    {
      name: "idle runner",
      options: { accounts: connectedAccounts, runnerWatching: false, runnerStatus: "idle", runnerSettings },
      detail: "Local runner is online but is not watching this queue.",
    },
    {
      name: "wrong queue",
      options: { accounts: connectedAccounts, runnerQueueName: "Other queue", runnerSettings },
      detail: "Local runner is watching Other queue. Switch it to Default queue before the daily run.",
    },
  ];

  for (const scenario of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await routeRunnerWorkspace(page, scenario.options);
    await page.goto(appUrl);
    await openWorkspaceView(page, "Runner");

    await page.getByLabel("Runner status").getByRole("heading", { name: "Automation needs local runner recovery" }).waitFor();
    await page.getByLabel("Runner status").getByText(scenario.detail, { exact: false }).waitFor();
    const runnerStateClass = await page.getByLabel("Runner health summary").locator("article", { hasText: "Runner state" }).getAttribute("class");
    assert.doesNotMatch(runnerStateClass ?? "", /\bready\b/, scenario.name);
    const lowerControls = page.getByLabel("Runner controls");
    assert.equal(await lowerControls.getByRole("button", { name: "Run", exact: true }).isDisabled(), false, scenario.name);
    assert.equal(await lowerControls.getByRole("button", { name: "Test run" }).isDisabled(), false, scenario.name);
    await context.close();
  }
});

test("runner auto-fills an empty queue from ready ads before preparing automation", { timeout: 40000 }, async (t) => {
  const { page, runnerRequests, savedQueueItems } = await openRunnerWorkspaceScenario(t, {
    accounts: [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr" })],
    advertisements: [apiAdvertisement({ id: "ad-auto-fill", title: "Auto fill ad", status: "ready" })],
    queueItems: [],
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: false, tumblrAccountId: "tumblr-runner" },
  });

  const runnerControls = page.getByLabel("Runner controls");
  await runnerControls.getByRole("button", { name: "Run", exact: true }).waitFor();
  assert.equal(await runnerControls.getByRole("button", { name: "Run", exact: true }).isDisabled(), false);
  await runnerControls.getByRole("button", { name: "Run", exact: true }).click();

  await page.getByText("Auto-filled 1 ready ad before running.").waitFor();
  await page.getByText("Run this command locally.").waitFor();
  assert.equal(savedQueueItems.length, 1);
  assert.equal(savedQueueItems[0].ad_id, "ad-auto-fill");
  assert.equal(savedQueueItems[0].status, "queued");
  assert.equal(savedQueueItems[0].tumblr_account_id, "tumblr-runner");
  assert.equal(runnerRequests.localCommand, 1);
});

test("runner setup does not auto-fill an empty queue", { timeout: 40000 }, async (t) => {
  const { page, runnerRequests, savedQueueItems } = await openRunnerWorkspaceScenario(t, {
    accounts: [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr" })],
    advertisements: [apiAdvertisement({ id: "ad-auto-fill", title: "Auto fill ad", status: "ready" })],
    queueItems: [],
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: false, tumblrAccountId: "tumblr-runner" },
  });

  const runnerControls = page.getByLabel("Runner controls");
  await runnerControls.getByRole("button", { name: "Setup" }).waitFor();
  assert.equal(await runnerControls.getByRole("button", { name: "Setup" }).isDisabled(), false);
  await runnerControls.getByRole("button", { name: "Setup" }).click();

  await page.getByText("Run this command locally.").waitFor();
  assert.equal(savedQueueItems.length, 0);
  assert.equal(runnerRequests.localCommand, 1);
  assert.equal(await page.getByText("Auto-filled 1 ready ad before running.").count(), 0);
});

test("runner stops when auto-fill cannot save a ready ad", { timeout: 40000 }, async (t) => {
  const { page, runnerRequests, savedQueueItems } = await openRunnerWorkspaceScenario(t, {
    accounts: [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr" })],
    advertisements: [apiAdvertisement({ id: "ad-auto-fill", title: "Auto fill ad", status: "ready" })],
    queueItems: [],
    queueSaveFails: true,
    runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: false, tumblrAccountId: "tumblr-runner" },
  });

  const runnerControls = page.getByLabel("Runner controls");
  await runnerControls.getByRole("button", { name: "Run", exact: true }).waitFor();
  assert.equal(await runnerControls.getByRole("button", { name: "Run", exact: true }).isDisabled(), false);
  await runnerControls.getByRole("button", { name: "Run", exact: true }).click();

  await page.getByText("Auto-fill stopped before runnerblog because the queue item could not be saved.").waitFor();
  assert.equal(savedQueueItems.length, 0);
  assert.equal(runnerRequests.companionRun, 0);
  assert.equal(runnerRequests.localCommand, 0);
});

test("queue runner banner follows queue execution readiness", { timeout: 40000 }, async (t) => {
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
  const staleConnectedAccounts = [apiTumblrAccount({ id: "tumblr-runner", display_name: "Runner Tumblr", last_checked_at: "2026-06-20T00:00:00.000Z" })];
  const runnerSettings = { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "tumblr-runner" };
  const cases = [
    {
      options: { accounts: connectedAccounts, runnerSettings },
      expected: "Runner is available for this queue",
      ready: true,
    },
    {
      options: { accounts: connectedAccounts, runnerSettings, queueItems: [] },
      expected: "Queue needs content",
      ready: false,
    },
    {
      options: { accounts: connectedAccounts, runnerSettings, queueItems: [], advertisements: [apiAdvertisement()] },
      expected: "Queue needs content",
      detail: "Queue saved drafts before starting the runner.",
      action: "Open content",
      opensHeading: "Content library",
      opensHeadingLevel: 1,
      ready: false,
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings,
        queueItems: [defaultApiQueueItem({ id: "queue-failed", status: "failed" })],
      },
      expected: "Clear failed or review-needed submissions before relying on automation.",
      action: "Review queue",
      opensHeading: "Submission queue",
      opensHeadingLevel: 2,
      ready: false,
    },
    {
      options: {
        accounts: connectedAccounts,
        runnerSettings,
        queueItems: [defaultApiQueueItem(), defaultApiQueueItem({ id: "queue-failed", status: "failed" })],
      },
      expected: "Runner is available for this queue",
      detail: "1 runnable item can post while 1 item stays in review.",
      ready: true,
    },
    {
      options: { accounts: staleConnectedAccounts, runnerSettings },
      expected: "Automation needs a selected Tumblr account",
      detail: "Check saved Tumblr login before starting the runner.",
      rejected: "Runner is available for this queue",
      ready: false,
    },
    {
      options: { accounts: connectedAccounts, runnerSettings: { ...runnerSettings, tumblrAccountId: "" } },
      expected: "Automation needs a selected Tumblr account",
      detail: "Select a connected Tumblr account.",
      rejected: "Runner is available for this queue",
      ready: false,
    },
    {
      options: { accounts: connectedAccounts, runnerSettings: { ...runnerSettings, tumblrAccountId: "stale-account" } },
      expected: "Automation needs a selected Tumblr account",
      detail: "Select a connected Tumblr account.",
      rejected: "Runner is available for this queue",
      ready: false,
    },
  ];

  for (const scenario of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await routeRunnerWorkspace(page, scenario.options);
    await page.goto(appUrl);
    await openWorkspaceView(page, "Queue");
    const banner = page.getByLabel("Queue runner status");
    await banner.getByText(scenario.expected).waitFor();
    if (scenario.detail) {
      await banner.getByText(scenario.detail).waitFor();
    }
    if (scenario.rejected) {
      await banner.getByText(scenario.rejected).waitFor({ state: "detached" });
    }
    if (scenario.ready) {
      assert.match(await banner.getAttribute("class"), /\bready\b/);
      if (scenario.detail?.includes("stays in review")) {
        await page.getByLabel("Queue review required").getByText("Review items are parked; runnable submissions can continue.").waitFor();
        await page.getByLabel("Queue review required").getByText("Clear failed or review-needed submissions before relying on automation.").waitFor({ state: "detached" });
      }
    } else {
      assert.doesNotMatch(await banner.getAttribute("class"), /\bready\b/);
    }
    if (scenario.action) {
      await banner.getByRole("button", { name: scenario.action, exact: true }).click();
      await page.getByRole("heading", { name: scenario.opensHeading, level: scenario.opensHeadingLevel }).waitFor();
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

async function openRunnerWorkspaceScenario(t, routeOptions) {
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

  const context = await browser.newContext();
  t.after(async () => {
    await context.close();
  });

  const page = await context.newPage();
  const runnerRequests = routeOptions.runnerRequests ?? { companionRun: 0, localCommand: 0 };
  const savedQueueItems = routeOptions.savedQueueItems ?? [];
  await routeRunnerWorkspace(page, {
    ...routeOptions,
    runnerRequests,
    savedQueueItems,
  });
  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner");

  return { page, runnerRequests, savedQueueItems };
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
  const advertisements = options.advertisements ?? [];
  const queueItems = options.queueItems ?? [defaultApiQueueItem()];
  let currentQueueItems = [...queueItems];
  const savedQueueItems = options.savedQueueItems ?? [];
  const runnerLogs = options.runnerLogs ?? [];
  const runnerRequests = options.runnerRequests ?? { companionRun: 0, localCommand: 0 };
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
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements }) }),
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
          queueDefinitions: [{ id: "default-queue", name: "Default queue" }],
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
  await page.route("http://127.0.0.1:17842/run", (route) => {
    runnerRequests.companionRun += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, accepted: true, running: true }) });
  });
  await page.route("http://127.0.0.1:8021/api/runner/local-command?**", (route) => {
    runnerRequests.localCommand += 1;
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command: "npm.cmd run tumblr:runner:local -- --queue \"Default queue\"",
          autoStartCommand: "npm.cmd run tumblr:runner:local -- --watch",
          tokenConfigured: true,
          usesDeviceToken: true,
          message: "Run this command locally.",
        },
      }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        queue: currentQueueItems,
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/queue/*", (route) => {
    if (options.queueSaveFails) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        headers: apiHeaders,
        body: JSON.stringify({ error: "queue save failed" }),
      });
    }
    const payload = route.request().postDataJSON();
    savedQueueItems.push(payload);
    currentQueueItems = [payload, ...currentQueueItems.filter((item) => item.id !== payload.id)];
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ queue_item: payload }),
    });
  });
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

function apiAdvertisement(overrides = {}) {
  return {
    id: "saved-runner-draft",
    post_type: "text",
    title: "Saved runner draft",
    campaign_name: "Runner campaign",
    content: "Saved queue copy.",
    destination_blog: "runnerblog",
    forum_url: "https://forum.example/saved-runner-draft",
    tags: ["runner"],
    image_caption: "",
    image_name: "",
    image_data_url: "",
    video_url: "",
    video_name: "",
    status: "draft",
    archived: false,
    updated_at: "2026-06-20T00:00:00.000Z",
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

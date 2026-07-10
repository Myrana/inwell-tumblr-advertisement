import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";
import {
  createFrontendTestContext,
  stopProcessTree,
  waitForServer,
} from "./helpers/appTestServer.mjs";
import { openWorkspaceView } from "./helpers/workspaceNavigation.mjs";

const {
  apiHeaders,
  appUrl,
  port,
  routeAuthenticatedSession,
  routeEmptyWorkspaceApis,
} = createFrontendTestContext(8131);

function startVite(t) {
  const server = spawn(`npx vite --host 127.0.0.1 --port ${port} --strictPort`, {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  return server;
}

async function openPage(browser, configureRoutes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  if (configureRoutes) {
    await configureRoutes(page);
  }
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  return page;
}

async function expectButtonClass(button, expectedClass, label) {
  await button.waitFor({ state: "visible" });
  const className = await button.evaluate((element) => element.className);
  assert.match(className, new RegExp(`\\b${expectedClass}\\b`), label);
}

async function expectTertiaryButton(button, label) {
  await button.waitFor({ state: "visible" });
  const styles = await button.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      className: element.className,
      borderStyle: computed.borderStyle,
      backgroundColor: computed.backgroundColor,
    };
  });
  assert.match(styles.className, /\btertiary-action\b/, label);
  assert.equal(styles.borderStyle, "none", label);
  assert.equal(styles.backgroundColor, "rgba(0, 0, 0, 0)", label);
}

test("runner and queue action hierarchy keeps repeated navigation tertiary", { timeout: 50000 }, async (t) => {
  startVite(t);
  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const emptyPage = await openPage(browser);
  await emptyPage.getByLabel("Workspace views").getByRole("button", { name: "Runner", exact: true }).click();
  await emptyPage.getByLabel("Runner controls").waitFor();

  const installGuide = emptyPage.getByLabel("Install local runner");
  const runnerControls = emptyPage.getByLabel("Runner controls");
  const runnerLogSummary = emptyPage.getByLabel("Runner log summary");
  await expectButtonClass(runnerControls.getByRole("button", { name: "Run", exact: true }), "primary", "Runner Run remains primary");
  await expectButtonClass(runnerControls.getByRole("button", { name: "Test run", exact: true }), "secondary", "Runner Test run remains secondary");
  for (const [label, button] of [
    ["Install guide Manage accounts", installGuide.getByRole("button", { name: "Manage accounts", exact: true })],
    ["Install guide Open queue", installGuide.getByRole("button", { name: "Open queue", exact: true })],
    ["Runner controls Start", runnerControls.getByRole("button", { name: "Start", exact: true })],
    ["Runner controls Download", runnerControls.getByRole("button", { name: "Download", exact: true })],
    ["Runner controls Setup", runnerControls.getByRole("button", { name: "Setup", exact: true })],
    ["Runner logs Open queue", runnerLogSummary.getByRole("button", { name: "Open queue", exact: true })],
    ["Runner logs Manage accounts", runnerLogSummary.getByRole("button", { name: "Manage accounts", exact: true })],
  ]) {
    await expectTertiaryButton(button, label);
  }

  await openWorkspaceView(emptyPage, "Queue");
  await emptyPage.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();

  const queueOperations = emptyPage.getByLabel("Queue operations summary");
  const queueRunnerStatus = emptyPage.getByLabel("Queue runner status");
  const queuedSubmissions = emptyPage.getByText("No submissions queued").locator("..");
  const postHistory = emptyPage.getByLabel("Post history archive");
  await expectButtonClass(queueOperations.getByRole("button", { name: "Write Advertisement", exact: true }), "primary", "Queue Write Advertisement remains primary");
  await expectTertiaryButton(queueOperations.getByRole("button", { name: "Runner Controls", exact: true }), "Queue command center Runner Controls");
  await expectButtonClass(queueRunnerStatus.getByRole("button"), "primary", "Blocked queue runner action remains primary");
  await expectButtonClass(queuedSubmissions.getByRole("button", { name: "Write advertisement", exact: true }), "primary", "Empty queue Write advertisement remains primary");
  for (const [label, button] of [
    ["Empty queue Blog tracker", queuedSubmissions.getByRole("button", { name: "Blog tracker", exact: true })],
    ["Empty history Runner controls", postHistory.getByRole("button", { name: "Runner controls", exact: true })],
    ["Empty history Write advertisement", postHistory.getByRole("button", { name: "Write advertisement", exact: true })],
  ]) {
    await expectTertiaryButton(button, label);
  }

  const readyPage = await openPage(browser, routeReadyQueueApis);
  await openWorkspaceView(readyPage, "Queue");
  await readyPage.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  const readyRunnerStatus = readyPage.getByLabel("Queue runner status");
  await readyRunnerStatus.getByText("Runner is available for this queue").waitFor();
  await expectTertiaryButton(readyRunnerStatus.getByRole("button", { name: "Runner Controls", exact: true }), "Ready queue Runner Controls");
});

async function routeReadyQueueApis(page) {
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [apiTumblrAccount()] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [apiAdvertisement()] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "tumblr-runner" },
          queueDefinitions: [{ id: "default-queue", name: "Default queue" }],
          queueScheduleSettings: {
            enabled: false,
            dailyTime: "09:00",
            timezone: "America/New_York",
            perQueue: {},
          },
        },
      }),
    }),
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
            online: true,
            last_seen_at: "2026-06-20T01:00:00.000Z",
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
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: [apiQueueItem()] }) }),
  );
}

function apiQueueItem(overrides = {}) {
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
    id: "ad-run-focused",
    post_type: "text",
    title: "Ready runner draft",
    campaign_name: "Runner campaign",
    content: "Ready queue copy.",
    destination_blog: "runnerblog",
    forum_url: "https://forum.example/ready-runner-draft",
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

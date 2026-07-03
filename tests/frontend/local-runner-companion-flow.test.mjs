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

  await routeRunnerWorkspace(page);
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

async function routeRunnerWorkspace(page) {
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
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
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
      body: JSON.stringify({ settings: { runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: true, tumblrAccountId: "" } } }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
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
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        queue: [
          {
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
          },
        ],
      }),
    }),
  );
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
    lastError: "",
    lastRun: null,
    ...overrides,
  };
}

async function openWorkspaceView(page, viewName) {
  const directButton = page.getByLabel("Workspace views").getByRole("button", { name: viewName, exact: true });
  if ((await directButton.count()) > 0 && await directButton.first().isVisible()) {
    await directButton.first().click();
    return;
  }

  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Runner controls", exact: true }).first().click();
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

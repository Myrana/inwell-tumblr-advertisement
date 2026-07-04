import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";

const appUrl = "http://127.0.0.1:8128";
const apiHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
  "Access-Control-Allow-Origin": appUrl,
};

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

async function fulfillJson(route, body) {
  await route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify(body) });
}

test("runner log submission timelines have unique labels for duplicate target names", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8128 --strictPort", {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/auth/session", (route) =>
    fulfillJson(route, {
      authenticated: true,
      bootstrapRequired: false,
      user: {
        id: "user-test",
        email: "myrana@example.test",
        displayName: "Myrana",
        workspace: { id: "workspace-test", name: "Myrana workspace" },
      },
    }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) => fulfillJson(route, { accounts: [] }));
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) => fulfillJson(route, { advertisements: [] }));
  await page.route("http://127.0.0.1:8021/api/templates", (route) => fulfillJson(route, { templates: [] }));
  await page.route("http://127.0.0.1:8021/api/settings", (route) => fulfillJson(route, { settings: {} }));
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    fulfillJson(route, { settings: route.request().postDataJSON() }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/status", (route) =>
    fulfillJson(route, {
      runner: {
        running: false,
        pid: null,
        plan_path: "",
        command: [],
        run_id: "run-duplicate-targets",
      },
    }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    fulfillJson(route, {
      queue: [
        {
          id: "queue-one",
          ad_id: "ad-one",
          target_id: "same-blog",
          target_name: "same-blog",
          tumblr_account_id: "tumblr-account",
          queue_name: "Default queue",
          submit_url: "https://same-blog.tumblr.com/submit",
          post_type: "photo",
          status: "queued",
          scheduled_for: null,
          timezone: "America/New_York",
          created_at: "2026-07-04T12:00:00.000Z",
          updated_at: "2026-07-04T12:00:00.000Z",
          last_run_at: null,
          posted_at: null,
          failed_at: null,
          notes: "",
          runner_payload: "{}",
        },
        {
          id: "queue-two",
          ad_id: "ad-two",
          target_id: "same-blog",
          target_name: "same-blog",
          tumblr_account_id: "tumblr-account",
          queue_name: "Default queue",
          submit_url: "https://same-blog.tumblr.com/submit",
          post_type: "photo",
          status: "queued",
          scheduled_for: null,
          timezone: "America/New_York",
          created_at: "2026-07-04T12:00:00.000Z",
          updated_at: "2026-07-04T12:00:00.000Z",
          last_run_at: null,
          posted_at: null,
          failed_at: null,
          notes: "",
          runner_payload: "{}",
        },
      ],
    }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    fulfillJson(route, {
      logs: [
        {
          id: "run-launched",
          run_id: "run-duplicate-targets",
          queue_item_id: "",
          target_name: "",
          level: "info",
          message: "Runner launched.",
          details: {},
          created_at: "2026-07-04T11:59:00.000Z",
        },
        {
          id: "queue-one-open",
          run_id: "run-duplicate-targets",
          queue_item_id: "queue-one",
          target_name: "same-blog",
          level: "info",
          message: "Opening first same-blog submission.",
          details: {},
          created_at: "2026-07-04T12:00:00.000Z",
        },
        {
          id: "queue-two-open",
          run_id: "run-duplicate-targets",
          queue_item_id: "queue-two",
          target_name: "same-blog",
          level: "info",
          message: "Opening second same-blog submission.",
          details: {},
          created_at: "2026-07-04T12:01:00.000Z",
        },
        {
          id: "run-finished",
          run_id: "run-duplicate-targets",
          queue_item_id: "",
          target_name: "",
          level: "info",
          message: "Runner finished.",
          details: {},
          created_at: "2026-07-04T12:02:00.000Z",
        },
      ],
    }),
  );

  await page.goto(appUrl);
  await page.getByLabel("Workspace views").getByRole("button", { name: "Runner Logs", exact: true }).click();
  await page.getByLabel("Run run-duplicate-targets submission timelines").getByText("same-blog").first().waitFor();
  await page.getByLabel("Run run-duplicate-targets general timeline").getByText("Runner launched.").waitFor();
  await page.getByLabel("Run run-duplicate-targets general timeline").getByText("Runner finished.").waitFor();
  await page.getByLabel("same-blog submission 1 timeline").getByText("Opening first same-blog submission.").waitFor();
  await page.getByLabel("same-blog submission 2 timeline").getByText("Opening second same-blog submission.").waitFor();
  assert.equal(await page.getByLabel("same-blog timeline", { exact: true }).count(), 0);
  assert.equal(await page.getByText(/belong to another content library item/i).count(), 0);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

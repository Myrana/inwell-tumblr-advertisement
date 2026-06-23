import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const appUrl = "http://127.0.0.1:8123";
const apiHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
  "Access-Control-Allow-Origin": appUrl,
};
const authenticatedSession = {
  authenticated: true,
  bootstrapRequired: false,
  user: {
    id: "user-test",
    email: "myrana@example.test",
    displayName: "Myrana",
    workspace: { id: "workspace-test", name: "Myrana workspace" },
  },
};

test("site background uses CSS overlays without remote image artifacts", () => {
  const styles = readFileSync("src/styles.css", "utf8");

  assert.doesNotMatch(styles, /rawpixel|site-overlay-image|image_png_800/);
  assert.match(styles, /\.app-shell::before\s*\{/);
  assert.match(styles, /\.app-shell::after\s*\{/);
  assert.match(styles, /\.app-shell\s*\{[\s\S]*radial-gradient/);
  assert.match(styles, /ellipse 72px 420px/);
  assert.match(styles, /html\[data-theme="dark"\]\s+\.app-shell::before\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\]\s+\.app-shell::after\s*\{/);
  assert.match(styles, /\.queue-workspace::before\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\]\s+\.queue-workspace::before\s*\{/);
  assert.match(styles, /ellipse 240px 110px/);
  assert.match(styles, /linear-gradient\(180deg, rgba\(0, 0, 0, 0\.36\)/);
});

test("render crashes show a recovery panel instead of a blank page", { timeout: 40000 }, async (t) => {
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
  await page.goto(`${appUrl}?forceCrash=1`);
  await page.getByRole("heading", { name: "Inkwell hit a startup error.", level: 1 }).waitFor();
  await page.getByText("Forced local render crash.").waitFor();
  await page.getByRole("button", { name: "Reset local cache" }).waitFor();
});

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

async function routeAuthenticatedSession(page) {
  await page.route("http://127.0.0.1:8021/api/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify(authenticatedSession),
    }),
  );
}

async function routeEmptyWorkspaceApis(page) {
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: {} }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
  );
}

async function openWorkspaceView(page, viewName) {
  const directButton = page.getByLabel("Workspace views").getByRole("button", { name: viewName, exact: true });
  if ((await directButton.count()) > 0 && await directButton.first().isVisible()) {
    await directButton.first().click();
    return;
  }

  const operationActions = {
    "Content Library": "Prep content",
    Templates: "Open templates",
    Queues: "Blog tracker",
    Runner: "Runner controls",
    "Tumblr Accounts": "Manage accounts",
    "Runner Logs": "Review logs",
    Docs: "Open docs",
  };
  const actionName = operationActions[viewName];
  if (!actionName) {
    throw new Error(`No Operations route is configured for ${viewName}.`);
  }

  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByRole("button", { name: actionName, exact: true }).first().click();
}

test("first user can create an Inkwell login before opening the workspace", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  let registerPayload = null;
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:8021/api/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ authenticated: false, user: null, bootstrapRequired: true }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/auth/register", (route) => {
    registerPayload = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      headers: { ...apiHeaders, "Set-Cookie": "inwell_session=test-session; Path=/; HttpOnly; SameSite=Lax" },
      body: JSON.stringify(authenticatedSession),
    });
  });
  await routeEmptyWorkspaceApis(page);

  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Create your Inkwell login" }).waitFor();
  await page.getByLabel("Name").fill("Myrana");
  await page.getByLabel("Workspace").fill("Myrana workspace");
  await page.getByLabel("Email").fill("myrana@example.test");
  await page.getByLabel("Password").fill("super-secret-password");
  await page.getByRole("button", { name: "Create login" }).click();
  await page.getByRole("button", { name: "Log out" }).waitFor();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByLabel("First-run checklist").getByText("Connect Tumblr account").waitFor();
  await page.getByLabel("First-run checklist").getByRole("button", { name: "Start with example ad" }).waitFor();
  await openWorkspaceView(page, "Content Library");
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
  await page.getByText("No content saved yet").waitFor();
  await page.getByRole("button", { name: "Create advertisement" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Edit" }).count(), 0);
  await page.getByRole("button", { name: "New Submission" }).click();
  await page.getByRole("heading", { name: "Untitled submission" }).waitFor();

  assert.equal(registerPayload?.email, "myrana@example.test");
  assert.equal(registerPayload?.displayName, "Myrana");
  assert.equal(registerPayload?.workspaceName, "Myrana workspace");
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("operations dashboard exports and imports workspace backups", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        advertisements: [
          {
            id: "local-draft",
            post_type: "text",
            title: "Local draft",
            campaign_name: "",
            content: "Saved copy",
            destination_blog: "localblog",
            forum_url: "",
            tags: ["local"],
            image_caption: "",
            image_name: "",
            image_data_url: "",
            video_url: "",
            video_name: "",
            status: "draft",
            updated_at: "2026-06-20T12:00:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        templates: [{ id: "local-template", name: "Local template", content: "Template", forum_url: "", queue_name: "", tags: [], updated_at: "2026-06-20T12:00:00.000Z" }],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: {} }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements/*", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisement: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/templates/*", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ template: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue/*", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue_item: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts/*", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ account: route.request().postDataJSON() }) }),
  );

  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByLabel("Run readiness").getByText("Queue needs content").waitFor();
  await page.getByLabel("Run blockers").getByText("Connect a Tumblr account.").waitFor();
  await page.getByLabel("Run blockers").getByText("Add queued or scheduled submissions.").waitFor();
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Templates", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Queues", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Tumblr Accounts", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Prep content", exact: true }).click();
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Back to Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const exported = JSON.parse(await readFile(downloadPath, "utf8"));
  assert.equal(exported.schema, "inkwell-workspace-export");
  assert.equal(exported.version, 1);
  assert.equal(exported.data.stored.ads[0].title, "Local draft");
  assert.equal(exported.data.templates[0].name, "Local template");

  const importedBackup = {
    schema: "inkwell-workspace-export",
    version: 1,
    exportedAt: "2026-06-20T13:00:00.000Z",
    data: {
      stored: {
        activeAdId: "imported-draft",
        ads: [
          {
            id: "imported-draft",
            postType: "photo",
            title: "Imported draft",
            campaignName: "Imported campaign",
            content: "",
            destinationBlog: "importedblog",
            forumUrl: "https://forum.example/imported",
            tags: ["imported"],
            imageCaption: "Imported caption",
            imageName: "",
            imageDataUrl: "",
            videoUrl: "",
            videoName: "",
            status: "ready",
            updatedAt: "2026-06-20T13:00:00.000Z",
          },
        ],
      },
      submitTargets: [{ id: "importedblog", name: "Imported Blog", profileName: "Imported Blog", submitUrl: "https://importedblog.tumblr.com/submit", forumUrl: "", postingRules: "" }],
      templates: [{ id: "imported-template", name: "Imported template", content: "Imported reusable copy", forumUrl: "", queueName: "Imported queue", tags: ["imported"], updatedAt: "2026-06-20T13:00:00.000Z" }],
      queueDefinitions: [{ id: "imported-queue", name: "Imported queue" }],
      submissionQueue: [
        {
          id: "imported-queue-item",
          adId: "imported-draft",
          targetId: "importedblog",
          targetName: "Imported Blog",
          tumblrAccountId: "",
          queueName: "Imported queue",
          submitUrl: "https://importedblog.tumblr.com/submit",
          postType: "photo",
          status: "queued",
          scheduledFor: "",
          timezone: "America/New_York",
          createdAt: "2026-06-20T13:00:00.000Z",
          updatedAt: "2026-06-20T13:00:00.000Z",
          lastRunAt: "",
          postedAt: "",
          failedAt: "",
          notes: "",
          runnerPayload: "{}",
        },
      ],
      queueScheduleSettings: { enabled: true, dailyTime: "10:30", timezone: "America/New_York", perQueue: {} },
      tagProfiles: { importedblog: ["imported"] },
      tumblrAccounts: [{ id: "imported-account", displayName: "Imported Account", blogName: "importedblog", userDataDir: "", status: "connected", lastCheckedAt: "", lastLoginAt: "", notes: "", browserbaseContextId: "", browserbaseSessionId: "", browserbaseLiveUrl: "", browserbaseSessionExpiresAt: "", updatedAt: "2026-06-20T13:00:00.000Z" }],
      runnerSettings: { mediaDir: "", slowMo: 500, headless: true, submit: false, tumblrAccountId: "imported-account", remoteBrowserProvider: "none", remoteBrowserLaunchUrl: "" },
    },
  };
  await page.locator('input[aria-label="Import workspace file"]').setInputFiles({
    name: "inkwell-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedBackup)),
  });
  await page.getByText("Imported 1 drafts, 1 templates, and 1 queue items.").waitFor();
  await page.getByLabel("Operations dashboard").getByText("1 saved drafts").waitFor();
  await page.getByLabel("Operations dashboard").getByText("1 saved", { exact: true }).waitFor();

  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("queue auto-refills from ready drafts when an item is marked posted", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.addInitScript(() => {
    const readyAd = (id, title) => ({
      id,
      postType: "text",
      title,
      campaignName: "",
      content: `<p>${title} body</p>`,
      destinationBlog: "refillblog",
      forumUrl: "https://forum.example/refill",
      tags: ["refill"],
      imageCaption: "",
      imageName: "",
      imageDataUrl: "",
      videoUrl: "",
      videoName: "",
      status: "ready",
      updatedAt: "2026-06-20T12:00:00.000Z",
    });
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "ad-posted",
        ads: [readyAd("ad-posted", "Posted source"), readyAd("ad-replacement", "Replacement source")],
      }),
    );
    localStorage.setItem(
      "inwell-tumblr-submit-targets",
      JSON.stringify([{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }]),
    );
    localStorage.setItem(
      "inwell-tumblr-submission-queue",
      JSON.stringify([
        {
          id: "ad-posted-default-queue-refillblog",
          adId: "ad-posted",
          targetId: "refillblog",
          targetName: "Refill Blog",
          tumblrAccountId: "",
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
          notes: "Ready for local browser runner.",
          runnerPayload: JSON.stringify({ fields: { body: "Posted source body" } }),
        },
      ]),
    );
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Queues");
  await page.locator(".queue-management-row", { hasText: "Default queue" }).getByRole("button", { name: "Open queue" }).click();
  await page.locator(".queue-item", { hasText: "Refill Blog" }).waitFor();
  await page.getByLabel("Queue bulk editor").getByLabel("Select all pending items").check();
  await page.getByLabel("Queue bulk editor").getByLabel("Status").selectOption("posted");
  await page.getByLabel("Queue bulk editor").getByRole("button", { name: "Update 1" }).click();

  await page.getByText("Auto-added 1 replacement.").waitFor();
  await page.locator(".queue-item", { hasText: "Auto-added to keep this queue stocked" }).waitFor();
  await page.getByLabel("Post history archive").getByText("Bulk updated from queue workspace.").waitFor();
  const savedQueue = JSON.parse(await page.evaluate(() => localStorage.getItem("inwell-tumblr-submission-queue")));
  assert.equal(savedQueue.filter((item) => item.status === "queued").length, 1);
  assert.equal(savedQueue.filter((item) => item.status === "posted").length, 1);
  assert.match(savedQueue.find((item) => item.status === "queued").id, /ad-replacement/);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("documentation page explains recent workflow changes", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);

  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await openWorkspaceView(page, "Docs");
  await page.getByRole("heading", { name: "Testing and change guide", level: 1 }).waitFor();
  await page.getByLabel("Inkwell documentation").getByRole("heading", { name: "Local runner" }).waitFor();
  await page.getByLabel("Inkwell documentation").getByRole("heading", { name: "Import and export" }).waitFor();
  await page.getByLabel("Inkwell documentation").getByRole("heading", { name: "Suggested testing flow" }).waitFor();
  await page.getByText("Only turn Submit approved on when the queue looks right and you are ready for real Tumblr submission.").waitFor();

  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("login lockout shows a wait message", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:8021/api/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ authenticated: false, user: null, bootstrapRequired: false }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { ...apiHeaders, "Retry-After": "120" },
      status: 429,
      body: JSON.stringify({ error: "Too many failed login attempts. Try again later.", retryAfterSeconds: 120 }),
    }),
  );

  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Log into Inkwell" }).waitFor();
  await page.getByLabel("Email").fill("myrana@example.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByText("Too many failed login attempts. Try again later. Wait about 2 minutes before trying again.").waitFor();

  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("content library rows can queue a saved submission", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  const savedQueueItems = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  await page.route("http://127.0.0.1:8021/api/queue/**", (route) => {
    const savedQueueItem = route.request().postDataJSON();
    savedQueueItems.push(savedQueueItem);
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ queue_item: savedQueueItem }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "saved-ad",
        ads: [
          {
            id: "saved-ad",
            postType: "text",
            title: "Saved queue post",
            campaignName: "Summer campaign",
            content: "<p>Saved content</p>",
            destinationBlog: "allthingsroleplay",
            forumUrl: "https://forum.example/thread",
            tags: ["wanted"],
            imageCaption: "",
            imageName: "",
            imageDataUrl: "",
            videoUrl: "",
            videoName: "",
            status: "draft",
            updatedAt: "2026-06-20T12:00:00.000Z",
          },
          {
            id: "saved-ad-two",
            postType: "text",
            title: "Second saved post",
            content: "<p>Saved content</p>",
            destinationBlog: "allthingsroleplay",
            forumUrl: "https://forum.example/thread",
            tags: ["wanted"],
            imageCaption: "",
            imageName: "",
            imageDataUrl: "",
            videoUrl: "",
            videoName: "",
            status: "draft",
            updatedAt: "2026-06-20T12:05:00.000Z",
          },
          {
            id: "saved-ad-needs-work",
            postType: "text",
            title: "Needs forum link",
            content: "<p>Missing forum URL</p>",
            destinationBlog: "allthingsroleplay",
            forumUrl: "",
            tags: [],
            imageCaption: "",
            imageName: "",
            imageDataUrl: "",
            videoUrl: "",
            videoName: "",
            status: "draft",
            updatedAt: "2026-06-20T12:10:00.000Z",
          },
        ],
      }),
    );
    localStorage.setItem(
      "inwell-tumblr-submit-targets",
      JSON.stringify([
        {
          id: "allthingsroleplay",
          name: "allthingsroleplay",
          profileName: "All Things Roleplay ads",
          submitUrl: "https://allthingsroleplay.tumblr.com/submit",
          forumUrl: "https://forum.example/thread",
          postingRules: "Use photo posts and credit the forum.",
        },
      ]),
    );
    localStorage.setItem(
      "inwell-tumblr-queue-definitions",
      JSON.stringify([
        { id: "default-queue", name: "Default queue" },
        { id: "want-ads", name: "Want ads" },
      ]),
    );
  });

  await page.goto(appUrl);
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByLabel("Operations dashboard").getByText("3 saved drafts").waitFor();
  await page.getByLabel("Operations dashboard").getByText("Local runner offline").waitFor();
  await openWorkspaceView(page, "Content Library");
  const savedRow = page.locator(".draft-row").filter({ has: page.locator("strong", { hasText: "Saved queue post" }) });
  await savedRow.getByText("Type").waitFor();
  await savedRow.getByText("Summer campaign").waitFor();
  await savedRow.getByText("Target").waitFor();
  await savedRow.getByText("Updated").waitFor();
  await savedRow.getByText("100% ready").waitFor();
  await page.getByLabel("Batch prep assistant").getByText("2 ready to queue - 1 need edits").waitFor();
  await page.getByLabel("Duplicate content check").getByText("2 possible duplicates in 1 group").waitFor();
  assert.equal(await page.locator(".duplicate-pill").count(), 2);
  await savedRow.getByLabel("Select saved item").check();
  await page.getByLabel("Saved bulk editor").getByLabel("Campaign").fill("Fall campaign");
  await page.getByLabel("Saved bulk editor").getByLabel("Add tag").fill("archive");
  await page.getByLabel("Saved bulk editor").getByRole("button", { name: "Update 1" }).click();
  await savedRow.getByText("Fall campaign").waitFor();
  await page.getByLabel("Batch queue destination").selectOption("Want ads");
  await page.getByRole("button", { name: "Queue ready drafts" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByText("Queued Second saved post in Want ads.").waitFor();
  assert.deepEqual(savedQueueItems.map((item) => item.ad_id).sort(), ["saved-ad", "saved-ad-two"]);
  assert.equal(JSON.parse(savedQueueItems.find((item) => item.ad_id === "saved-ad").runner_payload).advertisement.campaignName, "Fall campaign");
  assert.equal(JSON.parse(savedQueueItems.find((item) => item.ad_id === "saved-ad").runner_payload).targetProfile.name, "All Things Roleplay ads");
  assert.equal(
    JSON.parse(savedQueueItems.find((item) => item.ad_id === "saved-ad").runner_payload).targetProfile.postingRules,
    "Use photo posts and credit the forum.",
  );
  assert.equal(savedQueueItems.every((item) => item.target_id === "allthingsroleplay"), true);
  assert.equal(savedQueueItems.every((item) => item.queue_name === "Want ads"), true);
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Want ads");
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("content library tolerates nullable saved draft fields", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        advertisements: [
          null,
          {
            id: "backend-nullable-draft",
            post_type: null,
            title: "Backend nullable draft",
            campaign_name: null,
            content: null,
            destination_blog: null,
            forum_url: null,
            tags: [null, "Wanted"],
            image_caption: null,
            image_name: null,
            image_data_url: null,
            video_url: null,
            video_name: null,
            status: null,
            updated_at: null,
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        templates: [
          {
            id: null,
            name: null,
            content: null,
            forum_url: null,
            queue_name: null,
            tags: [null, "Template tag"],
            updated_at: null,
          },
        ],
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
            id: null,
            ad_id: null,
            target_id: null,
            target_name: null,
            submit_url: null,
            post_type: null,
            status: null,
            created_at: null,
            updated_at: null,
            notes: null,
            runner_payload: null,
          },
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
          submitTargets: [
            null,
            { id: null, name: null, submitUrl: null },
            {
              id: "nullable-blog",
              name: "nullable-blog",
              profileName: null,
              submitUrl: "https://nullable-blog.tumblr.com/submit",
              forumUrl: null,
              postingRules: null,
            },
          ],
          tagProfiles: {
            "nullable-blog": [null, "Wanted", "  premium ad  "],
            ignored: null,
          },
          queueDefinitions: [null, { id: null, name: null }],
          runnerSettings: { slowMo: null, tumblrAccountId: null },
          queueScheduleSettings: { perQueue: { "": {} } },
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        logs: [
          {
            id: null,
            run_id: null,
            queue_item_id: null,
            target_name: null,
            level: null,
            message: null,
            details: null,
            created_at: null,
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        accounts: [
          {
            id: null,
            display_name: null,
            blog_name: null,
            user_data_dir: null,
            status: null,
            last_checked_at: null,
            last_login_at: null,
            notes: null,
            browserbase_context_id: null,
            browserbase_session_id: null,
            browserbase_live_url: null,
            browserbase_session_expires_at: null,
            updated_at: null,
          },
        ],
      }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "nullable-draft",
        ads: [
          {
            id: "nullable-draft",
            postType: "photo",
            title: "Nullable saved draft",
            campaignName: null,
            content: null,
            destinationBlog: "nullable-blog",
            forumUrl: "https://forum.example/thread",
            tags: null,
            imageCaption: null,
            imageName: null,
            imageDataUrl: null,
            videoUrl: null,
            videoName: null,
            status: "draft",
            updatedAt: "not a date",
          },
        ],
      }),
    );
    localStorage.setItem(
      "inwell-tumblr-submit-targets",
      JSON.stringify([
        {
          id: "nullable-blog",
          name: "nullable-blog",
          profileName: "nullable-blog",
          submitUrl: "https://nullable-blog.tumblr.com/submit",
          forumUrl: "",
          postingRules: "",
        },
      ]),
    );
  });

  await page.goto(appUrl);
  await page.getByRole("button", { name: "Open content" }).click();
  await page.getByRole("heading", { name: "Content library", level: 2 }).waitFor();
  await page.getByText("Backend nullable draft").waitFor();
  await page.getByText("Updated").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("custom blog submission flow does not blank the editor", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": appUrl,
    "Access-Control-Allow-Credentials": "true" },
      body: JSON.stringify({ accounts: [] }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "inwell-tumblr-submit-targets",
      JSON.stringify([
        { id: "allthingsroleplay", name: "allthingsroleplay", submitUrl: "https://allthingsroleplay.tumblr.com/submit" },
      ]),
    );
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "ad-custom",
        ads: [
          {
            id: "ad-custom",
            postType: "photo",
            title: "Custom target ad",
            content: "<p>Existing body</p>",
            destinationBlog: "allthingsroleplay",
            forumUrl: "https://forum.example",
            tags: ["jcink site"],
            imageCaption: "",
            imageName: "sample-forum-ad.png",
            imageDataUrl: "/sample-forum-ad.png",
            videoUrl: "",
            videoName: "",
            status: "draft",
            updatedAt: "2026-06-17T00:00:00.000Z",
          },
          {
            id: "media-source",
            postType: "photo",
            title: "Reusable media source",
            content: "<p>Source body</p>",
            destinationBlog: "allthingsroleplay",
            forumUrl: "https://forum.example",
            tags: [],
            imageCaption: "",
            imageName: "forum-banner.png",
            imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
            videoUrl: "",
            videoName: "",
            status: "draft",
            updatedAt: "2026-06-18T00:00:00.000Z",
          },
        ],
      }),
    );
    localStorage.setItem(
      "inkwell-saved-templates",
      JSON.stringify([
        {
          id: "template-editor",
          name: "Editor quick template",
          content: "<p><strong>Quick saved copy</strong></p>",
          forumUrl: "",
          queueName: "Want ads",
          tags: [],
          updatedAt: "2026-06-17T00:00:00.000Z",
        },
      ]),
    );
    localStorage.setItem(
      "inwell-tumblr-queue-definitions",
      JSON.stringify([
        { id: "default-queue", name: "Default queue" },
        { id: "want-ads", name: "Want ads" },
      ]),
    );
  });

  await page.goto(appUrl);
  await page.getByRole("button", { name: "New Submission" }).click();
  await assert.doesNotReject(() => page.getByRole("heading", { name: "Custom target ad" }).waitFor());
  await page.getByLabel("Content quality checklist").getByText("6 of 6 ready").waitFor();
  await page.getByLabel("Content quality checklist").getByText("100% ready").waitFor();
  assert.equal(await page.getByRole("button", { name: "Log out" }).count(), 1);
  assert.equal(await page.getByLabel("Advertisement counts").count(), 0);
  await page.getByRole("button", { name: "Dark mode" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("inkwell-color-theme")), "dark");
  await page.reload();
  await page.getByRole("button", { name: "New Submission" }).click();
  await page.getByRole("heading", { name: "Custom target ad" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Light mode" }).count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");

  const targetSelect = page.locator('label:has-text("Target Tumblr blog") select');
  const addBlogInput = page.locator('label:has-text("Add Tumblr submit URL") input');
  const forumInput = page.getByLabel("Forum link");
  const savedNameInput = page.getByLabel("Submission name");
  assert.equal(await page.getByLabel("Tumblr post content").count(), 0);

  await addBlogInput.fill("https://another-rp.tumblr.com/submit");
  await page.getByRole("button", { name: "Add blog" }).click();
  assert.equal(await savedNameInput.inputValue(), "Custom target ad");
  await targetSelect.selectOption("another-rp");
  assert.equal(await forumInput.inputValue(), "https://forum.example");
  await page.getByRole("button", { name: "New", exact: true }).click();

  await page.getByRole("heading", { name: "Untitled submission" }).waitFor();
  assert.equal(await targetSelect.inputValue(), "");
  assert.equal(await forumInput.inputValue(), "");
  assert.equal(await savedNameInput.inputValue(), "");
  await targetSelect.selectOption("another-rp");
  assert.equal(await savedNameInput.inputValue(), "another-rp");
  assert.equal(await forumInput.inputValue(), "https://forum.example");
  assert.equal(await page.getByLabel("Target profile").count(), 0);
  assert.equal(await page.getByLabel("Profile label").count(), 0);
  assert.equal(await page.getByLabel("Posting rules").count(), 0);
  await savedNameInput.fill("");
  await addBlogInput.fill("https://blank-name.tumblr.com/submit");
  await page.getByRole("button", { name: "Add blog" }).click();
  assert.equal(await savedNameInput.inputValue(), "blank-name");
  await forumInput.fill("https://forum.example/updated");
  const persistedTargets = await page.evaluate(() => JSON.parse(localStorage.getItem("inwell-tumblr-submit-targets") ?? "[]"));
  assert.equal(persistedTargets.find((target) => target.id === "blank-name")?.forumUrl, "https://forum.example/updated");
  assert.equal(persistedTargets.find((target) => target.id === "another-rp")?.profileName, "another-rp");
  assert.equal(persistedTargets.find((target) => target.id === "another-rp")?.postingRules, "");
  await page.getByText("Saved templates").waitFor();
  await page.getByRole("button", { name: "Toggle reusable copy section" }).click();
  await page.getByRole("button", { name: /Editor quick template/ }).click();
  assert.equal(await page.getByLabel("Queue destination").inputValue(), "Want ads");
  await page.getByRole("button", { name: "Toggle post content section" }).click();
  await page.locator(".tumblr-rich-editor strong", { hasText: "Quick saved copy" }).waitFor();
  await page.getByLabel("Preview mode").getByText("Desktop", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Preview mode").getByText("Mobile", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Preview mode").getByText("Compact", { exact: true }).count(), 0);
  assert.equal(await page.locator(".tumblr-submit-shell").evaluate((node) => node.classList.contains("preview-desktop")), true);
  await page.getByLabel("Reusable media library").getByText("forum-banner.png").waitFor();
  await page.getByRole("button", { name: "Use forum-banner.png" }).click();
  await page.locator(".tumblr-photo-stage strong", { hasText: "forum-banner.png" }).waitFor();
  assert.equal(await page.getByText("Import this blog's tags from a screenshot").count(), 0);
  assert.equal(await page.getByLabel("jcink site").count(), 0);
  await page.getByPlaceholder("custom tag").fill("manual test tag");
  await page.getByRole("button", { name: "Add custom tag" }).click();
  assert.equal(await page.getByLabel("manual test tag").isChecked(), true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("status").getByText("Saved just now").waitFor();
  assert.equal(await page.getByRole("button", { name: "Keep editing" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Add to queue" }).count(), 1);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
  assert.match((await page.locator("main").textContent()) ?? "", /Submission workspace/);
});

test("templates can be edited on their page and applied from the submission workspace", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  const apiHeaders = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
    "Access-Control-Allow-Origin": appUrl,
    "Access-Control-Allow-Credentials": "true",
  };
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
  );

  await page.addInitScript(() => {
    localStorage.setItem(
      "inwell-tumblr-submit-targets",
      JSON.stringify([{ id: "custom-ads", name: "custom-ads", submitUrl: "https://custom-ads.tumblr.com/submit" }]),
    );
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "ad-template",
        ads: [
          {
            id: "ad-template",
            postType: "photo",
            title: "All Things Roleplay",
            content: "<p>Original copy</p>",
            destinationBlog: "custom-ads",
            forumUrl: "https://forum.example/original",
            tags: ["jcink site"],
            imageCaption: "",
            imageName: "sample-forum-ad.png",
            imageDataUrl: "/sample-forum-ad.png",
            videoUrl: "",
            videoName: "",
            status: "draft",
            updatedAt: "2026-06-17T00:00:00.000Z",
          },
        ],
      }),
    );
  });

  await page.goto(appUrl);
  await page.getByRole("button", { name: "New Submission" }).click();
  await page.getByLabel("Target Tumblr blog").selectOption("custom-ads");
  assert.equal(await page.getByText("Inkwell Ads").count(), 0);
  assert.equal(await page.getByText("jcink-directory").count(), 0);
  assert.equal(await page.getByText("roleplay-finder").count(), 0);

  await openWorkspaceView(page, "Templates");
  await page.getByRole("heading", { name: "Saved templates", level: 1 }).waitFor();

  await page.getByLabel("Template name").fill("Reusable premium ad");
  await page.locator(".template-rich-editor").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+B" : "Control+B");
  await page.keyboard.type("Template bold copy");
  await page.getByRole("button", { name: "Save template" }).click();
  await page.getByText("Saved Reusable premium ad.").waitFor();
  await page.locator(".template-preview strong", { hasText: "Template bold copy" }).waitFor();
  await page.getByRole("button", { name: /Reusable premium ad/ }).click();
  await page.getByText("Editing Reusable premium ad.").waitFor();
  await page.getByLabel("Template name").fill("Reusable premium ad updated");
  await page.locator(".template-rich-editor").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("Edited template copy");
  await page.getByRole("button", { name: "Update template" }).click();
  await page.getByText("Updated Reusable premium ad updated.").waitFor();
  await page.locator(".template-card", { hasText: "Reusable premium ad updated" }).locator(".template-preview", { hasText: "Edited template copy" }).waitFor();
  assert.equal(await page.locator(".template-card", { hasText: "Reusable premium ad updated" }).count(), 1);

  await page.getByRole("button", { name: "New Submission" }).click();
  await page.getByRole("heading", { name: "All Things Roleplay" }).waitFor();
  await page.getByRole("button", { name: "Toggle reusable copy section" }).click();
  await page.getByRole("button", { name: /Reusable premium ad updated/ }).click();
  await page.getByRole("button", { name: "Toggle post content section" }).click();
  assert.match((await page.locator(".tumblr-rich-editor").textContent()) ?? "", /Edited template copy/);
  assert.equal(await page.getByLabel("Forum link").inputValue(), "https://forum.example/original");
  assert.equal(await page.getByLabel("jcink site").isChecked(), true);
  assert.equal(await page.getByLabel("premium jcink").count(), 0);

  await openWorkspaceView(page, "Content Library");
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("heading", { name: "All Things Roleplay" }).waitFor();
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Queue", exact: true }).count(), 0);
  await openWorkspaceView(page, "Queues");
  await page.getByRole("heading", { name: "Queues", level: 1 }).waitFor();
  assert.equal(await page.getByText("Default queue").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export automation plan" }).count(), 0);
  assert.equal(await page.getByLabel("Schedule in Eastern time").count(), 0);
  await page.getByLabel("New queue name").fill("Want ads");
  await page.getByRole("button", { name: "Add queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Want ads");
  assert.equal(await page.getByLabel("Queue actions").count(), 0);
  await openWorkspaceView(page, "Runner");
  await page.getByLabel("Runner controls").getByRole("button", { name: "Run", exact: true }).waitFor();
  await page.getByLabel("Runner controls").getByRole("button", { name: "Test run" }).waitFor();
  assert.equal(await page.getByLabel("Media folder").count(), 0);
  await openWorkspaceView(page, "Queues");
  await page.locator(".queue-management-row", { hasText: "Want ads" }).getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.locator(".workflow-section", { hasText: "Schedule" }).locator(".section-state.warning", { hasText: "Off" }).waitFor();

  await openWorkspaceView(page, "Queues");
  await page.getByLabel("Content calendar").getByText("Want ads").waitFor();
  await page.getByLabel("Content calendar").getByText("Not scheduled").waitFor();
  await page.getByLabel("New queue name").fill("Site ads");
  await page.getByRole("button", { name: "Add queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Site ads");

  await page.getByRole("button", { name: "New Submission" }).click();
  await page.getByRole("heading", { name: "All Things Roleplay" }).waitFor();
  await page.getByLabel("Queue destination").selectOption("Want ads");
  await page.getByRole("button", { name: "Add to queue" }).click();
  await page.getByText("Added to Want ads").waitFor();
  await page.getByRole("button", { name: "View queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Want ads");

  await openWorkspaceView(page, "Queues");
  const wantAdsRow = page.locator(".queue-management-row", { hasText: "Want ads" });
  const emptySiteAdsRow = page.locator(".queue-management-row", { hasText: "Site ads" });
  await wantAdsRow.getByText("1 item - 0 complete").waitFor();
  await emptySiteAdsRow.getByText("0 items - 0 complete").waitFor();
  await emptySiteAdsRow.getByRole("button", { name: "Delete queue" }).click();
  await page.getByText("Deleted Site ads.").waitFor();
  await wantAdsRow.getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Want ads");
  assert.equal(await page.getByLabel("Queue actions").count(), 0);
  await page.getByRole("button", { name: "Toggle schedule section" }).click();
  assert.equal(await page.getByLabel("Daily run time").isDisabled(), true);
  await page.getByLabel("Run this queue daily").check();
  assert.equal(await page.getByLabel("Daily run time").isDisabled(), false);
  await page.getByLabel("Schedule presets").getByRole("button", { name: "Afternoon" }).click();
  assert.equal(await page.getByLabel("Daily run time").inputValue(), "13:00");
  await page.getByLabel("Daily run time").fill("09:30");
  await page.getByLabel("Daily automation schedule").getByText("Daily automation is on.").waitFor();
  await page.getByText("This schedule applies only to Want ads.").waitFor();
  await page.getByText("Next queued local run:").waitFor();
  const persistedSchedule = await page.evaluate(() => JSON.parse(localStorage.getItem("inwell-queue-schedule-settings") ?? "{}"));
  assert.equal(persistedSchedule.perQueue["Want ads"].enabled, true);
  assert.equal(persistedSchedule.perQueue["Want ads"].dailyTime, "09:30");
  await openWorkspaceView(page, "Queues");
  await page.getByLabel("New queue name").fill("Schedule check");
  await page.getByRole("button", { name: "Add queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Toggle schedule section" }).click();
  assert.equal(await page.getByLabel("Run this queue daily").isChecked(), false);
  assert.equal(await page.getByLabel("Daily run time").inputValue(), "09:00");
  await page.getByLabel("Run this queue daily").check();
  await page.getByLabel("Daily run time").fill("11:45");
  await page.getByLabel("Active queue").selectOption("Want ads");
  assert.equal(await page.getByLabel("Run this queue daily").isChecked(), true);
  assert.equal(await page.getByLabel("Daily run time").inputValue(), "09:30");
  await openWorkspaceView(page, "Queues");
  const scheduleCheckRow = page.locator(".queue-management-row", { hasText: "Schedule check" });
  await scheduleCheckRow.getByRole("button", { name: "Delete queue" }).click();
  await page.getByText("Deleted Schedule check.").waitFor();
  await wantAdsRow.getByText("1 item - 0 complete").waitFor();
  assert.equal(await wantAdsRow.getByLabel("Queue name").count(), 0);
  await wantAdsRow.getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByLabel("Queue name").fill("Site ads");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByText("Renamed Want ads to Site ads.").waitFor();
  await openWorkspaceView(page, "Queues");
  const siteAdsRow = page.locator(".queue-management-row", { hasText: "Site ads" });
  await siteAdsRow.getByText("1 item - 0 complete").waitFor();
  assert.equal(await wantAdsRow.getByRole("button", { name: "Clear queue" }).count(), 0);
  await siteAdsRow.getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Site ads");
  await page.getByRole("button", { name: "Toggle schedule section" }).click();
  assert.equal(await page.getByLabel("Run this queue daily").isChecked(), true);
  assert.equal(await page.getByLabel("Daily run time").inputValue(), "09:30");
  await page.getByRole("button", { name: "Edit submission" }).click();
  await page.getByRole("heading", { name: "All Things Roleplay" }).waitFor();
  await openWorkspaceView(page, "Queues");
  await siteAdsRow.getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Queue actions").count(), 0);
  await openWorkspaceView(page, "Runner Logs");
  await page.getByRole("heading", { name: "Runner logs", level: 1 }).waitFor();
  await page.getByText("No runner logs yet.").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("shared app settings load from and save to the backend", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  const apiHeaders = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
    "Access-Control-Allow-Origin": appUrl,
    "Access-Control-Allow-Credentials": "true",
  };
  let savedSettings = null;

  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          submitTargets: [
            {
              id: "backendblog",
              name: "backendblog",
              submitUrl: "https://backendblog.tumblr.com/submit",
              forumUrl: "https://backend.example",
            },
          ],
          queueDefinitions: [{ id: "backend-queue", name: "Backend queue" }],
          tagProfiles: { backendblog: ["jcink site"] },
          runnerSettings: { mediaDir: "C:/backend-media", slowMo: 900, submit: true },
          queueScheduleSettings: { enabled: true, dailyTime: "07:45", timezone: "America/New_York" },
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) => {
    savedSettings = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ settings: savedSettings }),
    });
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Queues");
  await page.locator(".queue-management-row", { hasText: "Backend queue" }).getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Backend queue");
  assert.equal(await page.getByLabel("Media folder").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Toggle runner settings section" }).count(), 0);
  await page.getByRole("button", { name: "Toggle schedule section" }).click();
  assert.equal(await page.getByLabel("Run this queue daily").isChecked(), true);
  assert.equal(await page.getByLabel("Daily run time").inputValue(), "07:45");

  await openWorkspaceView(page, "Queues");
  await page.getByLabel("New queue name").fill("Backend second queue");
  await page.getByRole("button", { name: "Add queue" }).click();
  await page.waitForTimeout(250);

  assert.equal(savedSettings?.submitTargets?.[0]?.id, "backendblog");
  assert.equal(savedSettings?.runnerSettings?.slowMo, 900);
  assert.ok(savedSettings?.queueDefinitions?.some((queue) => queue.name === "Backend second queue"));
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("tumblr accounts can be saved and selected for queue runs", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  const apiHeaders = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
    "Access-Control-Allow-Origin": appUrl,
    "Access-Control-Allow-Credentials": "true",
  };
  let savedAccount = null;
  let localLoginPayload = null;
  let deployedLoginPayload = null;
  const loginCheckPayloads = [];

  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: {} }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts/*", (route) => {
    savedAccount = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        account: {
          ...savedAccount,
          updated_at: "2026-06-19T01:00:00.000Z",
        },
      }),
    });
  });
  await page.route("http://127.0.0.1:17842/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        version: "local-runner-test",
        apiBaseUrl: "http://127.0.0.1:8021/api",
        workspaceId: "workspace-test",
        queueName: "Adverts",
        submit: false,
        watching: true,
        running: false,
        status: "watching",
        lastStartedAt: "",
        lastFinishedAt: "",
        lastExitCode: null,
        lastError: "",
      }),
    }),
  );
  await page.route("http://127.0.0.1:17842/login", (route) => {
    localLoginPayload = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        version: "local-runner-test",
        apiBaseUrl: "http://127.0.0.1:8021/api",
        workspaceId: "workspace-test",
        queueName: "Adverts",
        submit: false,
        watching: true,
        running: false,
        status: "watching",
        lastStartedAt: "2026-06-20T12:00:00.000Z",
        lastFinishedAt: "",
        lastExitCode: null,
        lastError: "",
        accepted: true,
        pid: 9191,
        message: "Tumblr login window opened on this computer.",
      }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/tumblr/login", (route) => {
    deployedLoginPayload = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        login: {
          mode: "local",
          pid: 9191,
          command: ["npm", "run", "tumblr:login"],
          message: "Login helper opened in process 9191. Finish Tumblr login in that browser.",
        },
      }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/tumblr/login-check", (route) => {
    const payload = route.request().postDataJSON();
    loginCheckPayloads.push(payload);
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        login: {
          mode: "remote",
          loggedIn: true,
          message: "Saved Tumblr login is healthy.",
          account: {
            id: payload.accountId,
            display_name: "Myrana Tumblr",
            blog_name: "snowleopardx",
            user_data_dir: "",
            status: "connected",
            last_checked_at: "2026-06-20T12:00:00.000Z",
            last_login_at: "2026-06-20T12:00:00.000Z",
            notes: "Saved Tumblr login is healthy.",
            updated_at: "2026-06-20T12:00:00.000Z",
          },
        },
      }),
    });
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Tumblr Accounts");
  await page.getByRole("heading", { name: "Tumblr accounts", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Dark mode" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.getByLabel("Account name").fill("Myrana Tumblr");
  await page.getByLabel("Tumblr blog name").fill("snowleopardx");
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByText("Added Myrana Tumblr.").waitFor();
  assert.equal(savedAccount?.id, "snowleopardx");
  assert.equal(savedAccount?.status, "needs-login");
  await page.getByText("Click Connect on an account to open Tumblr login through the local runner.").waitFor();
  await page.getByLabel("Tumblr account health").getByText("1 need attention out of 1").waitFor();
  await page.getByLabel("Tumblr account health").getByText("Stale check").waitFor();
  assert.equal(await page.getByLabel("Runner account").inputValue(), "");
  assert.equal(await page.getByLabel("Runner account").isDisabled(), true);

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator(".queue-status").getByText("Tumblr login window opened on this computer.", { exact: true }).waitFor();
  assert.equal(localLoginPayload?.accountId, "snowleopardx");
  assert.equal(deployedLoginPayload, null);

  await page.getByRole("button", { name: "Mark connected" }).click();
  await page.getByText("Myrana Tumblr is ready").waitFor();
  await page.getByLabel("Runner account").selectOption("snowleopardx");
  await page.getByText("Selected Myrana Tumblr for queue runs.").waitFor();
  assert.equal(await page.getByLabel("Runner account").inputValue(), "snowleopardx");
  const connectedAccountRow = page.locator(".account-session-row", { hasText: "Myrana Tumblr" });
  await connectedAccountRow.locator(".account-status-pill", { hasText: "Connected" }).waitFor();
  await page.getByRole("button", { name: "Check all saved logins" }).click();
  await page.getByText("Checked 1 account: 1 connected.").waitFor();
  assert.equal(loginCheckPayloads[0]?.accountId, "snowleopardx");
  await page.getByLabel("Tumblr account health").getByText("0 need attention out of 1").waitFor();
  await connectedAccountRow.getByText("Last checked").waitFor();
  assert.equal(await connectedAccountRow.getByRole("button", { name: "Connect", exact: true }).count(), 0);
  assert.equal(await connectedAccountRow.getByRole("button", { name: "Mark connected", exact: true }).count(), 0);
  assert.doesNotMatch(
    (await connectedAccountRow.textContent()) ?? "",
    /\.tumblr-sessions|\/sessions|C:\\sessions|C:\/sessions|userDataDir|user_data_dir/,
  );
  const noteBackground = await connectedAccountRow.locator(".account-session-note").evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(noteBackground, "rgb(255, 255, 255)");
  await connectedAccountRow.getByRole("button", { name: "Check saved login" }).waitFor();
  await page.getByRole("button", { name: "Create submission" }).click();
  await page.getByRole("heading", { name: "Untitled submission" }).waitFor();
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Queue", exact: true }).count(), 0);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("tumblr account connect uses local companion instead of deployed login helper", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  let loginCallCount = 0;
  let localLoginCallCount = 0;
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: {} }) }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        accounts: [
          {
            id: "snowleopardx",
            display_name: "Snow",
            blog_name: "snowleopardx",
            user_data_dir: "/app/.tumblr-sessions/snowleopardx",
            status: "needs-login",
            last_checked_at: null,
            last_login_at: null,
            notes: "Connect a browser session before queue runs.",
            updated_at: "2026-06-19T01:00:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/login", (route) =>
    {
      loginCallCount += 1;
      return route.fulfill({
        contentType: "application/json",
        headers: apiHeaders,
        status: 400,
        body: JSON.stringify({ error: "Deployed login helper should not be called." }),
      });
    },
  );
  await page.route("http://127.0.0.1:17842/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        version: "local-runner-test",
        apiBaseUrl: "http://127.0.0.1:8021/api",
        workspaceId: "workspace-test",
        queueName: "Adverts",
        submit: false,
        watching: false,
        running: false,
        status: "idle",
        lastStartedAt: "",
        lastFinishedAt: "",
        lastExitCode: null,
        lastError: "",
      }),
    }),
  );
  await page.route("http://127.0.0.1:17842/login", (route) => {
    localLoginCallCount += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        version: "local-runner-test",
        apiBaseUrl: "http://127.0.0.1:8021/api",
        workspaceId: "workspace-test",
        queueName: "Adverts",
        submit: false,
        watching: false,
        running: false,
        status: "idle",
        lastStartedAt: "2026-06-20T12:00:00.000Z",
        lastFinishedAt: "",
        lastExitCode: null,
        lastError: "",
        accepted: true,
        pid: 9191,
        message: "Tumblr login window opened on this computer.",
      }),
    });
  });

  await page.goto(appUrl);
  await openWorkspaceView(page, "Tumblr Accounts");
  await page.getByRole("heading", { name: "Tumblr accounts", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator(".queue-status").getByText("Tumblr login window opened on this computer.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Login helper launched. Complete Tumblr login in the visible browser.").count(), 0);
  assert.equal(loginCallCount, 0);
  assert.equal(localLoginCallCount, 1);
  await page.getByText("Finish login, leave Tumblr dashboard open, then mark this account connected.").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("tumblr account settings hide remote browser providers and ignore legacy values", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
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
            submit: false,
            tumblrAccountId: "snowleopardx",
            remoteBrowserProvider: "browserbase",
            remoteBrowserLaunchUrl: "",
          },
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        accounts: [
          {
            id: "snowleopardx",
            display_name: "Snow",
            blog_name: "snowleopardx",
            user_data_dir: "/app/.tumblr-sessions/snowleopardx",
            status: "needs-login",
            last_checked_at: null,
            last_login_at: null,
            notes: "Connect a browser session before queue runs.",
            browserbase_context_id: "ctx-saved",
            browserbase_session_id: "",
            browserbase_live_url: "",
            browserbase_session_expires_at: null,
            updated_at: "2026-06-19T01:00:00.000Z",
          },
        ],
      }),
    }),
  );

  await page.goto(appUrl);
  await openWorkspaceView(page, "Tumblr Accounts");
  await page.getByRole("heading", { name: "Tumblr accounts", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Browser provider").count(), 0);
  assert.equal(await page.getByText("Browserless").count(), 0);
  assert.equal(await page.getByText("Custom live browser URL").count(), 0);
  assert.equal(await page.getByText("Remote Tumblr login is selected").count(), 0);
  assert.equal(await page.getByRole("textbox", { name: "Live browser URL" }).count(), 0);
  await page.getByText("Click Connect on an account to open Tumblr login through the local runner.").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("runner logs are grouped by expandable queue run", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  const apiHeaders = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
    "Access-Control-Allow-Origin": appUrl,
    "Access-Control-Allow-Credentials": "true",
  };
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        logs: [
          {
            id: "log-new-ready",
            run_id: "run-new",
            queue_item_id: "queue-new",
            target_name: "allthingsroleplay",
            level: "info",
            message: "Submit button clicked.",
            details: { postedUrl: "https://allthingsroleplay.tumblr.com/post/123/posted-ad" },
            created_at: "2026-06-18T21:30:00.000Z",
          },
          {
            id: "log-new-ready-jcink",
            run_id: "run-new",
            queue_item_id: "queue-new-jcink",
            target_name: "jcinktinder",
            level: "info",
            message: "Fields filled and ready for manual review.",
            details: { screenshotUrl: "https://example.test/screenshots/jcinktinder-ready.png" },
            created_at: "2026-06-18T21:30:00.000Z",
          },
          {
            id: "log-new-open",
            run_id: "run-new",
            queue_item_id: "queue-new",
            target_name: "allthingsroleplay",
            level: "info",
            message: "Opening allthingsroleplay.",
            details: {},
            created_at: "2026-06-18T21:29:00.000Z",
          },
          {
            id: "log-old-warning",
            run_id: "run-old",
            queue_item_id: "queue-old",
            target_name: "jcinktinder",
            level: "warning",
            message: "Needs manual review.",
            details: {},
            created_at: "2026-06-18T20:00:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        runner: {
          running: true,
          pid: 4420,
          plan_path: "C:/Temp/inwell-local-runner-run-new.json",
          command: [],
          run_id: "run-new",
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
            id: "queue-new",
            ad_id: "ad-new",
            target_id: "allthingsroleplay",
            target_name: "allthingsroleplay",
            tumblr_account_id: "snowleopardx",
            queue_name: "Default queue",
            submit_url: "https://allthingsroleplay.tumblr.com/submit",
            post_type: "photo",
            status: "running",
            scheduled_for: null,
            timezone: "America/New_York",
            created_at: "2026-06-18T21:00:00.000Z",
            updated_at: "2026-06-18T21:29:00.000Z",
            last_run_at: "2026-06-18T21:29:00.000Z",
            posted_at: null,
            failed_at: null,
            notes: "Runner is filling Tumblr.",
            runner_payload: "{}",
          },
          {
            id: "queue-new-jcink",
            ad_id: "ad-new",
            target_id: "jcinktinder",
            target_name: "jcinktinder",
            tumblr_account_id: "snowleopardx",
            queue_name: "Default queue",
            submit_url: "https://jcinktinder.tumblr.com/submit",
            post_type: "photo",
            status: "queued",
            scheduled_for: null,
            timezone: "America/New_York",
            created_at: "2026-06-18T21:00:00.000Z",
            updated_at: "2026-06-18T21:00:00.000Z",
            last_run_at: null,
            posted_at: null,
            failed_at: null,
            notes: "Waiting for runner.",
            runner_payload: "{}",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ advertisements: [] }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ templates: [] }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ settings: {} }),
    }),
  );

  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner Logs");
  await page.getByRole("heading", { name: "Runner logs", level: 1 }).waitFor();
  await page.getByLabel("Current queue timeline").getByText("Current queue timeline").waitFor();
  await page.getByLabel("Current queue timeline").getByText("Run run-new is running").waitFor();
  await page.getByLabel("Current queue timeline").getByText("1 running").waitFor();
  await page.getByLabel("Current queue timeline").getByText("1 waiting").waitFor();
  await page.getByLabel("Latest run target summaries").getByText("allthingsroleplay").waitFor();
  await page.getByLabel("Latest run target summaries").getByText("jcinktinder").waitFor();
  await page.getByRole("button", { name: /Latest run run-new/ }).waitFor();
  assert.equal(await page.locator(".queue-log strong", { hasText: "Fields filled and ready for manual review." }).count(), 0);
  await page.getByLabel("Run run-new target summaries").getByText("allthingsroleplay").waitFor();
  await page.getByLabel("Run run-new target summaries").getByText("jcinktinder").waitFor();
  await page.getByLabel("Run run-new target summaries").getByText("Submitted").waitFor();
  await page.getByLabel("Run run-new step timeline").getByText("Open submit page").waitFor();
  await page.getByLabel("Run run-new step timeline").getByText("Fill form").waitFor();
  await page.getByLabel("Run run-new step timeline").getByRole("link", { name: "Posted Tumblr link" }).waitFor();
  await page.getByLabel("Run run-new step timeline").getByRole("link", { name: "Screenshot" }).waitFor();
  assert.equal(await page.getByLabel("Run run-new target summaries").getByText("Ready for manual review").count(), 1);
  assert.equal(await page.getByRole("button", { name: /Run run-old/ }).count(), 0);

  await page.getByRole("button", { name: "Show all history" }).click();
  await page.getByRole("button", { name: /Run run-old/ }).waitFor();
  assert.equal(await page.locator(".queue-log strong", { hasText: "Needs manual review." }).count(), 0);
  await page.getByRole("button", { name: /Run run-old/ }).click();
  await page.getByLabel("Run run-old step timeline").getByText("Needs review").waitFor();
  assert.match((await page.getByRole("button", { name: /Run run-old/ }).textContent()) ?? "", /1 warning/);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("running the queue prepares the local runner and shows failure explanations", { timeout: 40000 }, async (t) => {
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
  const pageErrors = [];
  let localCommandRequested = false;
  let localPackageRequested = false;
  let localPackageSubmit = null;
  const apiHeaders = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
    "Access-Control-Allow-Origin": appUrl,
    "Access-Control-Allow-Credentials": "true",
  };
  const queueItem = {
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
  const postedQueueItem = {
    id: "queue-posted-allthingsroleplay",
    ad_id: "ad-run",
    target_id: "allthingsroleplay",
    target_name: "allthingsroleplay archive",
    tumblr_account_id: "snowleopardx",
    submit_url: "https://allthingsroleplay.tumblr.com/submit",
    post_type: "photo",
    status: "posted",
    scheduled_for: null,
    timezone: "America/New_York",
    created_at: "2026-06-18T20:00:00.000Z",
    updated_at: "2026-06-18T20:30:00.000Z",
    last_run_at: "2026-06-18T20:25:00.000Z",
    posted_at: "2026-06-18T20:30:00.000Z",
    failed_at: null,
    notes: "Posted by the local runner.",
    runner_payload: JSON.stringify({ fields: { body: "Archived queue body" } }),
  };

  page.on("pageerror", (error) => pageErrors.push(error));
  const unavailableCompanionStatus = (route) => route.abort();
  await page.route("http://127.0.0.1:17842/status", unavailableCompanionStatus);
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
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
            last_checked_at: "2026-06-18T21:00:00.000Z",
            last_login_at: "2026-06-18T21:00:00.000Z",
            notes: "Connected",
            updated_at: "2026-06-18T21:00:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/local-command?**", async (route) => {
    localCommandRequested = true;
    const url = new URL(route.request().url());
    const submit = url.searchParams.get("submit") !== "false";
    const submitArg = submit ? " --submit" : "";
    await route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command:
            `npm.cmd run tumblr:runner:local -- --api-base 'https://inkwell-production-f037.up.railway.app/api' --token 'ilr_private_token' --workspace-id 'workspace-test' --queue 'Default queue' --user-data-dir .tumblr-runner-profile-local --watch --serve${submitArg}`,
          autoStartCommand:
            "npm.cmd run tumblr:runner:install-autostart -- -ApiBase 'https://inkwell-production-f037.up.railway.app/api' -WorkspaceId 'workspace-test' -Queue 'Default queue' -RunnerToken 'ilr_private_token'",
          tokenConfigured: true,
          usesDeviceToken: true,
          tokenEnv: "INWELL_LOCAL_RUNNER_TOKEN",
          message: "Run this on your Windows computer from the repo checkout. The copied command includes a device token.",
        },
      }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/runner/local-package?**", async (route) => {
    localPackageRequested = true;
    localPackageSubmit = new URL(route.request().url()).searchParams.get("submit");
    await route.fulfill({
      contentType: "application/zip",
      headers: {
        ...apiHeaders,
        "Access-Control-Expose-Headers": "Content-Disposition",
        "Content-Disposition": 'attachment; filename="inkwell-local-runner.zip"',
      },
      body: "fake zip",
    });
  });
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        logs: [
          {
            id: "log-failure",
            run_id: "run-visible",
            queue_item_id: "queue-run-allthingsroleplay",
            target_name: "allthingsroleplay",
            level: "error",
            message: "Runner failed: browserContext.newPage: Target page, context or browser has been closed",
            details: { error: "browserContext.newPage: Target page, context or browser has been closed" },
            created_at: "2026-06-18T21:04:00.000Z",
          },
          {
            id: "log-posted",
            run_id: "run-posted",
            queue_item_id: "queue-posted-allthingsroleplay",
            target_name: "allthingsroleplay archive",
            level: "info",
            message: "Submit button clicked.",
            details: { postedUrl: "https://allthingsroleplay.tumblr.com/post/456/archive-post" },
            created_at: "2026-06-18T20:30:00.000Z",
          },
        ],
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
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ queue: [queueItem, postedQueueItem] }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ advertisements: [] }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ templates: [] }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ settings: { runnerSettings: { mediaDir: "", slowMo: 500, headless: false, submit: false, tumblrAccountId: "snowleopardx" } } }),
    }),
  );
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.open = (url) => {
      window.__openedUrls.push(String(url));
      return null;
    };
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

  await page.goto(appUrl);
  await openWorkspaceView(page, "Queues");
  await page.locator(".queue-management-row", { hasText: "Default queue" }).getByRole("button", { name: "Open queue" }).click();
  await page.getByLabel("Post history archive").getByText("allthingsroleplay archive").waitFor();
  await page.getByLabel("Post history archive").getByRole("link", { name: "Posted Tumblr link" }).waitFor();
  await page.getByLabel("Queue bulk editor").getByText("Select all pending items").waitFor();
  await page.locator(".queue-item", { hasText: "allthingsroleplay" }).getByLabel("Select queue item").waitFor();
  await openWorkspaceView(page, "Runner");
  await page.getByLabel("Runner browser session").getByText("Local runner online: Default queue").waitFor();
  await page.getByLabel("Runner workspace").getByText("Watching", { exact: true }).waitFor();
  await page.getByLabel("Runner workspace").getByText("Runner is watching Default queue.").waitFor();
  await page.getByLabel("Runner controls").getByRole("button", { name: "Start" }).click();
  await page.getByText("Opening the installed local runner.").waitFor();
  await page.getByLabel("Runner controls").getByRole("button", { name: "Download" }).click();
  await page.getByText("Local runner installer downloaded.").waitFor();
  assert.equal(localPackageRequested, true);
  assert.equal(localPackageSubmit, "false");
  assert.equal(await page.getByLabel("Runner browser session").getByLabel("Approve live posting").isChecked(), false);
  await page.getByLabel("Runner controls").getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("Local runner command copied.").waitFor();
  await page.getByText("Local companion was not detected on this computer, so the command was copied instead.").waitFor();
  assert.equal(localCommandRequested, true);
  let copiedText = await page.evaluate(() => window.__copiedText);
  assert.match(copiedText, /tumblr:runner:local/);
  assert.match(copiedText, /--watch/);
  assert.match(copiedText, /--serve/);
  assert.doesNotMatch(copiedText, /--no-pause/);
  assert.match(copiedText, /--token 'ilr_private_token'/);
  assert.doesNotMatch(copiedText, /--submit/);
  await page.getByText(/prepare Tumblr without submitting/).waitFor();
  await page.getByLabel("Runner browser session").getByLabel("Approve live posting").check();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("inwell-tumblr-runner-settings") ?? "{}").submit === true);
  const approvedCommandResponse = page.waitForResponse((response) => {
    if (!response.url().includes("/api/runner/local-command")) {
      return false;
    }
    return new URL(response.url()).searchParams.get("submit") === "true";
  });
  await page.getByLabel("Runner controls").getByRole("button", { name: "Run", exact: true }).click();
  await approvedCommandResponse;
  await page.waitForFunction(() => /--submit/.test(window.__copiedText || ""));
  copiedText = await page.evaluate(() => window.__copiedText);
  assert.match(copiedText, /--submit/);
  await page.getByText(/paste it, and press Enter to start the local runner/).waitFor();
  await page.getByText(/ilr_private_token/).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByLabel("Run readiness").waitFor();
  await page.getByLabel("Attention required").getByText("allthingsroleplay").waitFor();
  await page.getByText("Live posting approved.").waitFor();
  await page.getByLabel("Attention required").getByRole("button", { name: "Review queue", exact: true }).click();
  await openWorkspaceView(page, "Runner");
  await page.getByLabel("Runner controls").getByRole("button", { name: "Test run" }).click();
  await page.getByText("Local runner command copied.").waitFor();
  await page.getByText(/start a test run that prepares Tumblr without submitting/).waitFor();
  copiedText = await page.evaluate(() => window.__copiedText);
  assert.match(copiedText, /tumblr:runner:local/);
  assert.match(copiedText, /--watch/);
  assert.match(copiedText, /--serve/);
  assert.doesNotMatch(copiedText, /--submit/);
  await page.getByLabel("Runner controls").getByRole("button", { name: "Setup" }).click();
  await page.getByText("Local runner setup command copied.").waitFor();
  copiedText = await page.evaluate(() => window.__copiedText);
  assert.match(copiedText, /tumblr:runner:install-autostart/);
  assert.match(copiedText, /-RunnerToken 'ilr_private_token'/);
  await page.getByText(/paste it, and press Enter to install the Windows login task/).waitFor();
  await page.getByText(/ilr_private_token/).waitFor({ state: "detached" });

  let companionRunRequested = false;
  const companionRunPayloads = [];
  await page.unroute("http://127.0.0.1:17842/status", unavailableCompanionStatus);
  await page.route("http://127.0.0.1:17842/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
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
        lastError: "",
      }),
    }),
  );
  await page.route("http://127.0.0.1:17842/run", async (route) => {
    companionRunRequested = true;
    companionRunPayloads.push(route.request().postDataJSON());
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
        lastStartedAt: "2026-06-20T01:00:00.000Z",
        lastFinishedAt: "",
        lastExitCode: null,
        lastError: "",
      }),
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText("Local companion is watching Default queue.").waitFor();
  await page.getByText("Local companion was not detected on this computer", { exact: false }).waitFor({ state: "detached" });
  await page.getByLabel("Runner browser session").getByLabel("Run headless").check();
  await page.getByLabel("Runner controls").getByRole("button", { name: "Test run" }).click();
  await page.getByText("Local companion started a test run.").waitFor();
  assert.deepEqual(companionRunPayloads.at(-1), { queueName: "Default queue", headless: true, submit: false });
  await page.getByLabel("Runner controls").getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("Local companion started the runner headless.").waitFor();
  assert.equal(companionRunRequested, true);
  assert.deepEqual(companionRunPayloads.at(-1), { queueName: "Default queue", headless: true, submit: true });
  await page.getByLabel("Runner workspace").getByText("Running", { exact: true }).waitFor();
  await page.getByLabel("Runner workspace").getByText("Working through Default queue.").waitFor();
  assert.deepEqual(await page.evaluate(() => window.__openedUrls), []);
  await page.unroute("http://127.0.0.1:17842/status");
  await page.route("http://127.0.0.1:17842/status", (route) =>
    route.fulfill({
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
        lastError: "Local runner exited with code 1. Close any open Inkwell Tumblr browser windows, then try again. Check the runner log for details.",
      }),
    }),
  );
  await page.getByLabel("Runner browser session").getByText("Local companion needs attention").waitFor();
  await page.getByText("Close any open Inkwell Tumblr browser windows, then try again.").waitFor();
  await openWorkspaceView(page, "Queues");
  await page.locator(".queue-management-row", { hasText: "Default queue" }).getByRole("button", { name: "Open queue" }).click();
  await page.getByText("Why this failed").waitFor();
  await page.getByText("The Playwright browser or tab closed before the runner finished.").waitFor();
  await page.getByText("Use Retry test run after fixing the blocker.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Running" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Needs review" }).count(), 0);
  await page.getByRole("button", { name: "Requeue" }).waitFor();
  await page.getByRole("button", { name: "Mark posted" }).waitFor();
  await page.getByRole("button", { name: "Retry test run" }).click();
  await page.getByText("Local companion started a test run.").waitFor();
  assert.deepEqual(companionRunPayloads.at(-1), { queueName: "Default queue", headless: true, submit: false });
  assert.equal(await page.getByText("Manual override").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Mark failed" }).count(), 0);
  await openWorkspaceView(page, "Runner Logs");
  await page.getByRole("button", { name: /Latest run run-visible/ }).waitFor();
  await page.getByText("Why this run failed").waitFor();
  await page.getByLabel("Run run-visible target summaries").getByText("Failed").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

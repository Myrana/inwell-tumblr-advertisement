import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";

const appUrl = "http://127.0.0.1:8123";

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
          tags: [],
          updatedAt: "2026-06-17T00:00:00.000Z",
        },
      ]),
    );
  });

  await page.goto(appUrl);
  await assert.doesNotReject(() => page.getByRole("heading", { name: "Custom target ad" }).waitFor());
  assert.equal(await page.getByRole("button", { name: "Log out" }).count(), 0);
  assert.equal(await page.getByLabel("Advertisement counts").count(), 0);

  const targetSelect = page.locator('label:has-text("Target Tumblr blog") select');
  const addBlogInput = page.locator('label:has-text("Add Tumblr submit URL") input');
  const forumInput = page.getByLabel("Forum link");
  const savedNameInput = page.getByLabel("Saved submission name");

  await addBlogInput.fill("https://another-rp.tumblr.com/submit");
  await page.getByRole("button", { name: "Add blog" }).click();
  assert.equal(await savedNameInput.inputValue(), "Custom target ad");
  await targetSelect.selectOption("another-rp");
  assert.equal(await forumInput.inputValue(), "https://forum.example");
  await page.getByRole("button", { name: "New" }).click();

  await page.getByRole("heading", { name: "Untitled saved submission" }).waitFor();
  assert.equal(await targetSelect.inputValue(), "");
  assert.equal(await forumInput.inputValue(), "");
  assert.equal(await savedNameInput.inputValue(), "");
  await targetSelect.selectOption("another-rp");
  assert.equal(await savedNameInput.inputValue(), "another-rp");
  assert.equal(await forumInput.inputValue(), "https://forum.example");
  await savedNameInput.fill("");
  await addBlogInput.fill("https://blank-name.tumblr.com/submit");
  await page.getByRole("button", { name: "Add blog" }).click();
  assert.equal(await savedNameInput.inputValue(), "blank-name");
  await forumInput.fill("https://forum.example/updated");
  const persistedTargets = await page.evaluate(() => JSON.parse(localStorage.getItem("inwell-tumblr-submit-targets") ?? "[]"));
  assert.equal(persistedTargets.find((target) => target.id === "blank-name")?.forumUrl, "https://forum.example/updated");
  await page.getByRole("heading", { name: "Media library" }).waitFor();
  await page.getByRole("button", { name: /Editor quick template/ }).click();
  await page.locator(".tumblr-rich-editor strong", { hasText: "Quick saved copy" }).waitFor();
  assert.equal(await page.getByText("Import this blog's tags from a screenshot").count(), 0);
  assert.equal(await page.getByLabel("jcink site").count(), 0);
  await page.getByPlaceholder("custom tag").fill("manual test tag");
  await page.getByRole("button", { name: "Add custom tag" }).click();
  assert.equal(await page.getByLabel("manual test tag").isChecked(), true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved. Start a new submission or keep editing this one.").waitFor();
  await page.getByRole("button", { name: "Keep editing" }).click();
  assert.equal(await page.getByText("Saved. Start a new submission or keep editing this one.").count(), 0);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
  assert.match((await page.locator("main").textContent()) ?? "", /Advertisement workspace/);
});

test("templates can be saved and applied from their own workspace", { timeout: 40000 }, async (t) => {
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
  await page.getByLabel("Target Tumblr blog").selectOption("custom-ads");
  assert.equal(await page.getByText("Inkwell Ads").count(), 0);
  assert.equal(await page.getByText("jcink-directory").count(), 0);
  assert.equal(await page.getByText("roleplay-finder").count(), 0);

  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("heading", { name: "Saved templates", level: 1 }).waitFor();

  await page.getByLabel("Template name").fill("Reusable premium ad");
  await page.locator(".template-rich-editor").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+B" : "Control+B");
  await page.keyboard.type("Template bold copy");
  await page.getByRole("button", { name: "Save template" }).click();
  await page.getByText("Saved Reusable premium ad.").waitFor();
  await page.locator(".template-preview strong", { hasText: "Template bold copy" }).waitFor();
  await page.getByRole("button", { name: /Reusable premium ad/ }).click();

  await page.getByRole("heading", { name: "All Things Roleplay" }).waitFor();
  assert.match((await page.locator(".tumblr-rich-editor").textContent()) ?? "", /Template bold copy/);
  await page.locator(".tumblr-rich-editor strong", { hasText: "Template bold copy" }).waitFor();
  assert.equal(await page.getByLabel("Forum link").inputValue(), "https://forum.example/original");
  assert.equal(await page.getByLabel("jcink site").isChecked(), true);
  assert.equal(await page.getByLabel("premium jcink").count(), 0);

  await page.getByRole("button", { name: "Saved Submissions" }).click();
  await page.getByRole("heading", { name: "Saved submissions", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export automation plan" }).count(), 0);
  assert.equal(await page.getByLabel("Schedule in Eastern time").count(), 0);
  await page.getByRole("button", { name: "Queues", exact: true }).click();
  await page.getByRole("heading", { name: "Queues", level: 1 }).waitFor();
  await page.getByLabel("New queue name").fill("Want ads");
  await page.getByRole("button", { name: "Add queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Want ads");
  await page.getByRole("button", { name: "Queue current" }).waitFor();
  await page.getByRole("button", { name: "Queue current" }).click();
  await page.getByText("Queued 1 target in Want ads.").waitFor();
  await page.getByRole("button", { name: "Queue all targets" }).waitFor();
  await page.getByRole("button", { name: "Run queue" }).waitFor();
  await page.getByLabel("Run this queue daily").check();
  await page.getByLabel("Daily run time").fill("09:30");
  await page.getByText("Daily automation is on.").waitFor();
  await page.getByText("Next queued local run:").waitFor();
  const persistedSchedule = await page.evaluate(() => JSON.parse(localStorage.getItem("inwell-queue-schedule-settings") ?? "{}"));
  assert.equal(persistedSchedule.enabled, true);
  assert.equal(persistedSchedule.dailyTime, "09:30");
  await page.getByRole("button", { name: "Queues", exact: true }).click();
  const wantAdsRow = page.locator(".queue-management-row", { hasText: "Want ads" });
  await wantAdsRow.getByText("1 item - 0 complete").waitFor();
  await wantAdsRow.getByRole("button", { name: "Clear queue" }).click();
  await wantAdsRow.getByText("0 items - 0 complete").waitFor();
  await page.getByRole("button", { name: "Runner Logs" }).click();
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
    "Access-Control-Allow-Origin": "*",
  };
  let savedSettings = null;

  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
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
  await page.getByLabel("Workspace views").getByRole("button", { name: "Queue", exact: true }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Backend queue");
  assert.equal(await page.getByLabel("Media folder").inputValue(), "C:/backend-media");
  assert.equal(await page.getByLabel("Slow motion").inputValue(), "900");
  assert.equal(await page.getByLabel("Click Submit after filling").isChecked(), true);
  assert.equal(await page.getByLabel("Run this queue daily").isChecked(), true);
  assert.equal(await page.getByLabel("Daily run time").inputValue(), "07:45");

  await page.getByRole("button", { name: "Queues", exact: true }).click();
  await page.getByLabel("New queue name").fill("Backend second queue");
  await page.getByRole("button", { name: "Add queue" }).click();
  await page.waitForTimeout(250);

  assert.equal(savedSettings?.submitTargets?.[0]?.id, "backendblog");
  assert.equal(savedSettings?.runnerSettings?.slowMo, 900);
  assert.ok(savedSettings?.queueDefinitions?.some((queue) => queue.name === "Backend second queue"));
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
    "Access-Control-Allow-Origin": "*",
  };
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
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
            details: {},
            created_at: "2026-06-18T21:30:00.000Z",
          },
          {
            id: "log-new-ready-jcink",
            run_id: "run-new",
            queue_item_id: "queue-new-jcink",
            target_name: "jcinktinder",
            level: "info",
            message: "Fields filled and ready for manual review.",
            details: {},
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
      body: JSON.stringify({ running: false, pid: null, plan_path: "", command: [] }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ queue: [] }),
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
  await page.getByRole("button", { name: "Runner Logs" }).click();
  await page.getByRole("heading", { name: "Runner logs", level: 1 }).waitFor();
  await page.getByRole("button", { name: /Latest run run-new/ }).waitFor();
  assert.equal(await page.locator(".queue-log strong", { hasText: "Fields filled and ready for manual review." }).count(), 1);
  await page.getByLabel("Run run-new target summaries").getByText("allthingsroleplay").waitFor();
  await page.getByLabel("Run run-new target summaries").getByText("jcinktinder").waitFor();
  await page.getByLabel("Run run-new target summaries").getByText("Submitted").waitFor();
  assert.equal(await page.getByLabel("Run run-new target summaries").getByText("Ready for manual review").count(), 1);
  assert.equal(await page.getByRole("button", { name: /Run run-old/ }).count(), 0);

  await page.getByRole("button", { name: "Show all history" }).click();
  await page.getByRole("button", { name: /Run run-old/ }).waitFor();
  assert.equal(await page.locator(".queue-log strong", { hasText: "Needs manual review." }).count(), 0);
  await page.getByRole("button", { name: /Run run-old/ }).click();
  await page.locator(".queue-log strong", { hasText: "Needs manual review." }).waitFor();
  assert.match((await page.getByRole("button", { name: /Run run-old/ }).textContent()) ?? "", /1 warning/);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("running the queue sends a run id and shows failure explanations", { timeout: 40000 }, async (t) => {
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
  let startPayload = null;
  const apiHeaders = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
    "Access-Control-Allow-Origin": "*",
  };
  const queueItem = {
    id: "queue-run-allthingsroleplay",
    ad_id: "ad-run",
    target_id: "allthingsroleplay",
    target_name: "allthingsroleplay",
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

  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:8021/api/runner/start", async (route) => {
    startPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ runner: { running: true, pid: 222, plan_path: "plan.json", command: [], run_id: startPayload.runId } }),
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
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ runner: { running: false, pid: null, plan_path: "", command: [], run_id: "" } }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ queue: [queueItem] }),
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

  await page.addInitScript(() => {
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
  await page.getByLabel("Workspace views").getByRole("button", { name: "Queue", exact: true }).click();
  await page.getByRole("button", { name: "Run queue" }).click();
  await page.waitForTimeout(250);
  assert.match(startPayload?.runId ?? "", /^run-/);
  assert.equal(startPayload.items[0].id, "queue-run-allthingsroleplay");
  await page.getByText("Why this failed").waitFor();
  await page.getByText("The Playwright browser or tab closed before the runner finished.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Running" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Needs review" }).count(), 0);
  await page.getByText("Manual override").click();
  await page.getByRole("button", { name: "Requeue" }).waitFor();
  await page.getByRole("button", { name: "Mark posted" }).waitFor();
  await page.getByRole("button", { name: "Mark failed" }).waitFor();
  await page.getByRole("button", { name: "Runner Logs" }).click();
  await page.getByRole("button", { name: /Latest run run-visible/ }).waitFor();
  await page.getByText("Why this run failed").waitFor();
  await page.getByLabel("Run run-visible target summaries").getByText("Failed").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

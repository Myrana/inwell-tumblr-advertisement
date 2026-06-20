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
  await page.getByRole("heading", { name: "Tumblr accounts", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Content Library" }).click();
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
  await page.getByText("No content saved yet").waitFor();
  assert.equal(await page.getByRole("button", { name: "Edit" }).count(), 0);
  await page.getByRole("button", { name: "New Submission" }).click();
  await page.getByRole("heading", { name: "Untitled submission" }).waitFor();

  assert.equal(registerPayload?.email, "myrana@example.test");
  assert.equal(registerPayload?.displayName, "Myrana");
  assert.equal(registerPayload?.workspaceName, "Myrana workspace");
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
  assert.equal(await page.getByRole("button", { name: "Log out" }).count(), 1);
  assert.equal(await page.getByLabel("Advertisement counts").count(), 0);
  await page.getByRole("button", { name: "Dark mode" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("inkwell-color-theme")), "dark");
  await page.reload();
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
  await savedNameInput.fill("");
  await addBlogInput.fill("https://blank-name.tumblr.com/submit");
  await page.getByRole("button", { name: "Add blog" }).click();
  assert.equal(await savedNameInput.inputValue(), "blank-name");
  await forumInput.fill("https://forum.example/updated");
  const persistedTargets = await page.evaluate(() => JSON.parse(localStorage.getItem("inwell-tumblr-submit-targets") ?? "[]"));
  assert.equal(persistedTargets.find((target) => target.id === "blank-name")?.forumUrl, "https://forum.example/updated");
  await page.getByText("Saved templates").waitFor();
  await page.getByRole("button", { name: "Toggle reusable copy section" }).click();
  await page.getByRole("button", { name: /Editor quick template/ }).click();
  await page.getByRole("button", { name: "Toggle post content section" }).click();
  await page.locator(".tumblr-rich-editor strong", { hasText: "Quick saved copy" }).waitFor();
  assert.equal(await page.getByText("Import this blog's tags from a screenshot").count(), 0);
  assert.equal(await page.getByLabel("jcink site").count(), 0);
  await page.getByPlaceholder("custom tag").fill("manual test tag");
  await page.getByRole("button", { name: "Add custom tag" }).click();
  assert.equal(await page.getByLabel("manual test tag").isChecked(), true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Keep editing" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Add to queue" }).count(), 1);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
  assert.match((await page.locator("main").textContent()) ?? "", /Submission workspace/);
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
  await page.getByRole("button", { name: "Toggle post content section" }).click();
  assert.match((await page.locator(".tumblr-rich-editor").textContent()) ?? "", /Template bold copy/);
  await page.locator(".tumblr-rich-editor strong", { hasText: "Template bold copy" }).waitFor();
  assert.equal(await page.getByLabel("Forum link").inputValue(), "https://forum.example/original");
  assert.equal(await page.getByLabel("jcink site").isChecked(), true);
  assert.equal(await page.getByLabel("premium jcink").count(), 0);

  await page.getByRole("button", { name: "Content Library" }).click();
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("heading", { name: "All Things Roleplay" }).waitFor();
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Queue", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Queues", exact: true }).click();
  await page.getByRole("heading", { name: "Queues", level: 1 }).waitFor();
  assert.equal(await page.getByText("Default queue").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Export automation plan" }).count(), 0);
  assert.equal(await page.getByLabel("Schedule in Eastern time").count(), 0);
  await page.getByLabel("New queue name").fill("Want ads");
  await page.getByRole("button", { name: "Add queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Want ads");
  await page.getByLabel("Queue actions").getByText("No queued submissions").waitFor();
  assert.equal(await page.getByLabel("Media folder").count(), 0);
  await page.locator(".workflow-section", { hasText: "Schedule" }).locator(".section-state.warning", { hasText: "Off" }).waitFor();

  await page.getByRole("button", { name: "Queues", exact: true }).click();
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

  await page.getByRole("button", { name: "Queues", exact: true }).click();
  const wantAdsRow = page.locator(".queue-management-row", { hasText: "Want ads" });
  const emptySiteAdsRow = page.locator(".queue-management-row", { hasText: "Site ads" });
  await wantAdsRow.getByText("1 item - 0 complete").waitFor();
  await emptySiteAdsRow.getByText("0 items - 0 complete").waitFor();
  await emptySiteAdsRow.getByRole("button", { name: "Delete queue" }).click();
  await page.getByText("Deleted Site ads.").waitFor();
  await wantAdsRow.getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Want ads");
  await page.getByLabel("Queue actions").getByRole("button", { name: "Queue all" }).waitFor();
  await page.getByLabel("Queue actions").getByRole("button", { name: "Run" }).waitFor();
  await page.getByRole("button", { name: "Toggle schedule section" }).click();
  await page.getByLabel("Run this queue daily").check();
  await page.getByLabel("Daily run time").fill("09:30");
  await page.getByLabel("Daily automation schedule").getByText("Daily automation is on.").waitFor();
  await page.getByText("Next queued local run:").waitFor();
  const persistedSchedule = await page.evaluate(() => JSON.parse(localStorage.getItem("inwell-queue-schedule-settings") ?? "{}"));
  assert.equal(persistedSchedule.enabled, true);
  assert.equal(persistedSchedule.dailyTime, "09:30");
  await page.getByRole("button", { name: "Queues", exact: true }).click();
  await wantAdsRow.getByText("1 item - 0 complete").waitFor();
  assert.equal(await wantAdsRow.getByLabel("Queue name").count(), 0);
  await wantAdsRow.getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByLabel("Queue name").fill("Site ads");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByText("Renamed Want ads to Site ads.").waitFor();
  await page.getByRole("button", { name: "Queues", exact: true }).click();
  const siteAdsRow = page.locator(".queue-management-row", { hasText: "Site ads" });
  await siteAdsRow.getByText("1 item - 0 complete").waitFor();
  assert.equal(await wantAdsRow.getByRole("button", { name: "Clear queue" }).count(), 0);
  await siteAdsRow.getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Site ads");
  await page.getByRole("button", { name: "Edit submission" }).click();
  await page.getByRole("heading", { name: "All Things Roleplay" }).waitFor();
  await page.getByRole("button", { name: "Queues", exact: true }).click();
  await siteAdsRow.getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByLabel("Queue actions").getByRole("button", { name: "Clear queue" }).click();
  await page.getByRole("button", { name: "Queues", exact: true }).click();
  await siteAdsRow.getByText("0 items - 0 complete").waitFor();
  await siteAdsRow.getByRole("button", { name: "Delete queue" }).click();
  await page.getByText("Deleted Site ads.").waitFor();
  await page.getByText("Create your first queue when you are ready to organize submissions.").waitFor();
  assert.equal(await page.locator(".queue-management-row", { hasText: "Site ads" }).count(), 0);
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
  await page.getByLabel("Workspace views").getByRole("button", { name: "Queues", exact: true }).click();
  await page.locator(".queue-management-row", { hasText: "Backend queue" }).getByRole("button", { name: "Open queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Backend queue");
  assert.equal(await page.getByLabel("Media folder").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Toggle runner settings section" }).count(), 0);
  await page.getByRole("button", { name: "Toggle schedule section" }).click();
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
  let loginPayload = null;

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
  await page.route("http://127.0.0.1:8021/api/tumblr/login", (route) => {
    loginPayload = route.request().postDataJSON();
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

  await page.goto(appUrl);
  await page.getByRole("button", { name: "Tumblr Accounts" }).click();
  await page.getByRole("heading", { name: "Tumblr accounts", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Dark mode" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.getByLabel("Account name").fill("Myrana Tumblr");
  await page.getByLabel("Tumblr blog name").fill("snowleopardx");
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByText("Added Myrana Tumblr.").waitFor();
  assert.equal(savedAccount?.id, "snowleopardx");
  assert.equal(savedAccount?.status, "needs-login");

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText("Login helper opened in process 9191.").waitFor();
  assert.equal(loginPayload?.accountId, "snowleopardx");

  await page.getByRole("button", { name: "Mark connected" }).click();
  await page.getByText("Myrana Tumblr is ready").waitFor();
  const connectedAccountRow = page.locator(".account-session-row", { hasText: "Myrana Tumblr" });
  await connectedAccountRow.locator(".account-status-pill", { hasText: "Connected" }).waitFor();
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

test("tumblr login helper failure does not mark account as launched", { timeout: 40000 }, async (t) => {
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
  const unsupportedMessage = "Tumblr login helper needs a visible browser on your local desktop. Railway cannot show that browser.";
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
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      status: 400,
      body: JSON.stringify({ error: unsupportedMessage }),
    }),
  );

  await page.goto(appUrl);
  await page.getByRole("button", { name: "Tumblr Accounts" }).click();
  await page.getByRole("heading", { name: "Tumblr accounts", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText(unsupportedMessage).waitFor();
  assert.equal(await page.getByText("Login helper launched. Complete Tumblr login in the visible browser.").count(), 0);
  await page.getByText("Connect a browser session before queue runs.").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("tumblr account connect opens Browserbase live view without manual URL", { timeout: 40000 }, async (t) => {
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
  await page.route("http://127.0.0.1:8021/api/tumblr/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        login: {
          mode: "remote",
          provider: "browserbase",
          sessionId: "session-new",
          contextId: "ctx-new",
          launchUrl: "https://browserbase.com/live/session-new",
          message: "Browserbase login session is ready. Complete Tumblr login in the opened browser.",
          account: {
            id: "snowleopardx",
            display_name: "Snow",
            blog_name: "snowleopardx",
            user_data_dir: "/app/.tumblr-sessions/snowleopardx",
            status: "checking",
            last_checked_at: "2026-06-19T01:05:00.000Z",
            last_login_at: null,
            notes: "Browserbase login session is ready. Complete Tumblr login in the opened browser.",
            browserbase_context_id: "ctx-new",
            browserbase_session_id: "session-new",
            browserbase_live_url: "https://browserbase.com/live/session-new",
            browserbase_session_expires_at: "2026-06-19T01:20:00.000Z",
            updated_at: "2026-06-19T01:05:00.000Z",
          },
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/login-check", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        login: {
          mode: "remote",
          provider: "browserbase",
          loggedIn: true,
          sessionId: "session-check",
          contextId: "ctx-saved",
          launchUrl: "",
          message: "Saved Tumblr login is active. This account is ready for queue runs.",
          account: {
            id: "snowleopardx",
            display_name: "Snow",
            blog_name: "snowleopardx",
            user_data_dir: "/app/.tumblr-sessions/snowleopardx",
            status: "connected",
            last_checked_at: "2026-06-19T01:04:00.000Z",
            last_login_at: "2026-06-19T01:04:00.000Z",
            notes: "Saved Tumblr login is active. This account is ready for queue runs.",
            browserbase_context_id: "ctx-saved",
            browserbase_session_id: "session-check",
            browserbase_live_url: "https://browserbase.com/live/session-check",
            browserbase_session_expires_at: "2026-06-19T01:20:00.000Z",
            updated_at: "2026-06-19T01:04:00.000Z",
          },
        },
      }),
    }),
  );

  await page.goto(appUrl);
  await page.evaluate(() => {
    window.__openedRemoteUrl = "";
    window.open = (url) => {
      window.__openedRemoteUrl = String(url);
      return null;
    };
  });
  await page.getByRole("button", { name: "Tumblr Accounts" }).click();
  await page.getByRole("heading", { name: "Tumblr accounts", level: 1 }).waitFor();
  await page.getByLabel("Browser provider").selectOption("browserbase");
  assert.equal(await page.getByRole("textbox", { name: "Live browser URL" }).count(), 0);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator("p.queue-status").filter({ hasText: "Browserbase login session is ready." }).waitFor();

  const openedUrl = await page.evaluate(() => window.__openedRemoteUrl);
  assert.equal(openedUrl, "https://browserbase.com/live/session-new");

  await page.evaluate(() => {
    window.__openedRemoteUrl = "";
  });
  await page.getByRole("button", { name: "Check saved login" }).click();
  await page.locator("p.queue-status").filter({ hasText: "Saved Tumblr login is active." }).waitFor();
  assert.equal(await page.evaluate(() => window.__openedRemoteUrl), "");
  assert.equal(await page.getByRole("button", { name: "Connect", exact: true }).count(), 0);
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
    await route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        localRunner: {
          command:
            "npm.cmd run tumblr:runner:local -- --api-base 'https://inkwell-production-f037.up.railway.app/api' --token 'ilr_private_token' --workspace-id 'workspace-test' --queue 'Default queue' --user-data-dir .tumblr-runner-profile-local --watch --serve --submit",
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
  await page.getByLabel("Workspace views").getByRole("button", { name: "Queues", exact: true }).click();
  await page.locator(".queue-management-row", { hasText: "Default queue" }).getByRole("button", { name: "Open queue" }).click();
  await page.getByText("Local runner online: Default queue").waitFor();
  await page.getByLabel("Local runner activity").getByText("Watching", { exact: true }).waitFor();
  await page.getByLabel("Local runner activity").getByText("Runner is watching Default queue.").waitFor();
  await page.getByLabel("Queue actions").getByRole("button", { name: "Start" }).click();
  await page.getByText("Opening the installed local runner.").waitFor();
  await page.getByLabel("Queue actions").getByRole("button", { name: "Download" }).click();
  await page.getByText("Local runner installer downloaded.").waitFor();
  assert.equal(localPackageRequested, true);
  await page.getByLabel("Queue actions").getByRole("button", { name: "Run" }).click();
  await page.getByText("Local runner command copied.").waitFor();
  await page.getByText("Local companion was not detected on this computer, so the command was copied instead.").waitFor();
  assert.equal(localCommandRequested, true);
  let copiedText = await page.evaluate(() => window.__copiedText);
  assert.match(copiedText, /tumblr:runner:local/);
  assert.match(copiedText, /--watch/);
  assert.match(copiedText, /--serve/);
  assert.doesNotMatch(copiedText, /--no-pause/);
  assert.match(copiedText, /--token 'ilr_private_token'/);
  await page.getByText(/paste it, and press Enter to start the local runner/).waitFor();
  await page.getByText(/ilr_private_token/).waitFor({ state: "detached" });
  await page.getByLabel("Queue actions").getByRole("button", { name: "Setup" }).click();
  await page.getByText("Local runner setup command copied.").waitFor();
  copiedText = await page.evaluate(() => window.__copiedText);
  assert.match(copiedText, /tumblr:runner:install-autostart/);
  assert.match(copiedText, /-RunnerToken 'ilr_private_token'/);
  await page.getByText(/paste it, and press Enter to install the Windows login task/).waitFor();
  await page.getByText(/ilr_private_token/).waitFor({ state: "detached" });

  let companionRunRequested = false;
  let companionRunPayload = null;
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
    companionRunPayload = route.request().postDataJSON();
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
  await page.getByLabel("Local runner activity").getByLabel("Run headless").check();
  await page.getByLabel("Queue actions").getByRole("button", { name: "Run" }).click();
  await page.getByText("Local companion started the runner headless.").waitFor();
  assert.equal(companionRunRequested, true);
  assert.deepEqual(companionRunPayload, { queueName: "Default queue", headless: true });
  await page.getByLabel("Local runner activity").getByText("Running", { exact: true }).waitFor();
  await page.getByLabel("Local runner activity").getByText("Working through Default queue.").waitFor();
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
        lastError: "",
      }),
    }),
  );
  await page.getByText("Local companion connected; last run failed").waitFor();
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

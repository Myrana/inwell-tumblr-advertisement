import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";
import { createFrontendTestContext, stopProcessTree, waitForServer } from "./helpers/appTestServer.mjs";

const { appUrl, routeAuthenticatedSession, routeEmptyWorkspaceApis } = createFrontendTestContext(8138);

async function routeWorkspace(page, populated = false) {
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  if (!populated) return;
  const fulfill = (route, body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) => fulfill(route, { advertisements: [{
    id: "ad-density", post_type: "photo", title: "Density advertisement", campaign_name: "Adverts", content: "Populated density card", destination_blog: "densityblog", forum_url: "https://example.test", tags: ["density"], image_caption: "", image_name: "", image_data_url: "", status: "saved", updated_at: "2026-07-12T12:00:00.000Z",
  }] }));
  await page.route("http://127.0.0.1:8021/api/templates", (route) => fulfill(route, { templates: [{ id: "template-density", name: "Density template", content: "Template content", forum_url: "https://example.test", queue_name: "Adverts", tags: ["density"], updated_at: "2026-07-12T12:00:00.000Z" }] }));
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) => fulfill(route, { accounts: [{ id: "account-density", display_name: "Density account", blog_name: "densityblog", user_data_dir: "C:/density", status: "connected", notes: "", updated_at: "2026-07-12T12:00:00.000Z" }] }));
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) => fulfill(route, { logs: [{ id: "log-density", run_id: "run-density", queue_item_id: "queue-one", target_name: "Target one", level: "info", message: "Density runner log", details: {}, created_at: "2026-07-12T12:00:00.000Z" }] }));
  await page.route("http://127.0.0.1:8021/api/queue", (route) => fulfill(route, { queue: [
    { id: "queue-one", ad_id: "ad-density", target_id: "target-one", target_name: "Target one", queue_name: "Adverts", submit_url: "https://example.test/one", post_type: "photo", status: "queued", notes: "Ready", runner_payload: "{}", created_at: "2026-07-12T12:00:00.000Z", updated_at: "2026-07-12T12:00:00.000Z" },
    { id: "queue-two", ad_id: "ad-density", target_id: "target-two", target_name: "Target two", queue_name: "Wanted ads", submit_url: "https://example.test/two", post_type: "photo", status: "posted", notes: "Posted", runner_payload: "{}", created_at: "2026-07-12T12:00:00.000Z", updated_at: "2026-07-12T12:00:00.000Z", posted_at: "2026-07-12T12:30:00.000Z" },
  ] }));
}

test("workspace density persists and condenses the shared shell", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8138 --strictPort", {
    cwd: process.cwd(), shell: true, stdio: "ignore",
  });
  t.after(() => stopProcessTree(server));
  await waitForServer(appUrl);
  const browser = await chromium.launch();
  t.after(async () => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await routeWorkspace(page, true);
  await page.addInitScript(() => {
    localStorage.setItem("inkwell-workspace-density", "ultra");
  });
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();

  const initial = await page.evaluate(() => ({
    density: document.documentElement.dataset.density,
    sidebarWidth: document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0,
    workspacePadding: Number.parseFloat(getComputedStyle(document.querySelector(".workspace")).paddingLeft),
  }));
  assert.equal(initial.density, "ultra");
  assert.equal(await page.getByText("Myrana", { exact: true }).isVisible(), true);
  await page.waitForFunction(() => document.querySelector("#nav-queue-count")?.textContent === "2 items");
  const queueNavigation = page.getByRole("button", { name: "Queue", exact: true });
  assert.equal(await queueNavigation.getAttribute("aria-describedby"), "nav-queue-count");
  assert.equal(await page.locator("#nav-queue-count").textContent(), "2 items");

  await page.getByLabel("Workspace density").selectOption("comfortable");
  const comfortable = await page.evaluate(() => ({
    sidebarWidth: document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0,
    workspacePadding: Number.parseFloat(getComputedStyle(document.querySelector(".workspace")).paddingLeft),
  }));

  await page.getByLabel("Workspace density").selectOption("compact");
  const compact = await page.evaluate(() => ({
    density: document.documentElement.dataset.density,
    sidebarWidth: document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0,
    workspacePadding: Number.parseFloat(getComputedStyle(document.querySelector(".workspace")).paddingLeft),
  }));
  assert.equal(compact.density, "compact");
  assert.ok(compact.sidebarWidth < comfortable.sidebarWidth);
  assert.ok(compact.workspacePadding < comfortable.workspacePadding);

  await page.getByLabel("Workspace density").selectOption("ultra");
  assert.equal(await page.evaluate(() => localStorage.getItem("inkwell-workspace-density")), "ultra");
  const ultra = await page.evaluate(() => ({
    density: document.documentElement.dataset.density,
    sidebarWidth: document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0,
    workspacePadding: Number.parseFloat(getComputedStyle(document.querySelector(".workspace")).paddingLeft),
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  assert.equal(ultra.density, "ultra");
  assert.ok(ultra.sidebarWidth < compact.sidebarWidth);
  assert.ok(ultra.workspacePadding < compact.workspacePadding);
  assert.ok(ultra.documentOverflow <= 1);

  const createGroup = page.locator(".nav-group").filter({ hasText: "Create" }).first();
  const inspectGroup = page.locator(".nav-group").filter({ hasText: "Inspect" }).first();
  await createGroup.locator("summary").click();
  await inspectGroup.locator("summary").click();
  assert.equal(await createGroup.getAttribute("open"), null);
  await page.reload();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  assert.equal(await page.getByLabel("Workspace density").inputValue(), "ultra");
  assert.equal(await page.locator(".nav-group").filter({ hasText: "Create" }).first().getAttribute("open"), null);
  await page.getByRole("button", { name: "Write Advertisement", exact: true }).first().click();
  await page.locator("h1").waitFor();
  assert.notEqual(await page.locator(".nav-group").filter({ hasText: "Create" }).first().getAttribute("open"), null);
  assert.equal(await page.locator(".nav-group").filter({ hasText: "Inspect" }).first().getAttribute("open"), null);

  const views = [
    ["Content Library", "Content library", 0, ".advertisement-card"],
    ["Templates", "Saved templates", 0, ".template-card"],
    ["Queue", "Submission queue", 1, ".queue-item"],
    ["Accounts", "Tumblr accounts", 2, ".account-session-row"],
    ["Settings", "Operational settings", 2, ".settings-panel"],
    ["Runner Logs", "Runner logs", 3, ".runner-log-run-summary"],
  ];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 800 }]) {
    await page.setViewportSize(viewport);
    for (const [button, heading, groupIndex, surfaceSelector] of views) {
      const paddings = [];
      for (const density of ["comfortable", "compact", "ultra"]) {
        await page.getByLabel("Workspace density").selectOption(density);
        const group = page.locator(".nav-group").nth(groupIndex);
        if ((await group.getAttribute("open")) === null) await group.locator("summary").click();
        await group.getByRole("button", { name: button, exact: true }).click();
        await page.getByRole("heading", { name: heading, level: 1 }).waitFor();
        const surface = page.locator(surfaceSelector).first();
        await surface.waitFor();
        paddings.push(await surface.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop)));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1));
        assert.equal(await surface.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= window.innerWidth + 1;
        }), true);
      }
      assert.ok(paddings[0] >= paddings[1] && paddings[1] >= paddings[2], `${button} padding should decrease monotonically`);
    }
  }

  assert.equal(await page.locator("#nav-saved-count").textContent(), "1 item");
  assert.equal(await page.locator("#nav-accounts-count").textContent(), "1 item");
  assert.equal(await page.locator("#nav-logs-count").textContent(), "1 item");

  const recoveryPage = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await routeWorkspace(recoveryPage);
  await recoveryPage.addInitScript(() => {
    localStorage.setItem("inkwell-workspace-density", "unsupported");
    localStorage.setItem("inkwell-sidebar-groups", "{malformed");
  });
  await recoveryPage.goto(appUrl);
  await recoveryPage.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  assert.equal(await recoveryPage.evaluate(() => document.documentElement.dataset.density), "comfortable");
  assert.equal(await recoveryPage.getByLabel("Workspace density").inputValue(), "comfortable");
  await recoveryPage.evaluate(() => localStorage.setItem("inkwell-sidebar-groups", JSON.stringify({ Inspect: true })));
  await recoveryPage.reload();
  await recoveryPage.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  const recoveryInspect = recoveryPage.locator(".nav-group").filter({ hasText: "Inspect" }).first();
  await recoveryInspect.locator("summary").click();
  assert.deepEqual(await recoveryPage.evaluate(() => JSON.parse(localStorage.getItem("inkwell-sidebar-groups"))), ["Inspect"]);
  await recoveryPage.close();
});

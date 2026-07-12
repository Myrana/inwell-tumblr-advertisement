import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";

const appUrl = "http://127.0.0.1:8125";
const apiHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
  "Access-Control-Allow-Origin": appUrl,
};

function stopProcessTree(processHandle) {
  if (!processHandle.pid || processHandle.killed) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  processHandle.kill("SIGTERM");
}

async function waitForServer(url, timeoutMs = 15000) {
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
        // Keep polling until Vite is ready.
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

test("editor batch queue preview supports cancel and multi-target confirm", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8125 --strictPort", {
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
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
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
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        advertisements: [
          {
            id: "batch-preview-ad",
            post_type: "photo",
            title: "Batch preview ad",
            campaign_name: "",
            content: "<p>Batch ready body</p>",
            destination_blog: "blog-one",
            forum_url: "https://forum.example/batch",
            image_click_through_url: "https://destination.example/batch-photo",
            tags: ["rp"],
            image_caption: "",
            image_name: "batch-preview.png",
            image_data_url: "/sample-forum-ad.png",
            video_url: "",
            video_name: "",
            status: "ready",
            updated_at: "2026-06-20T12:00:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
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
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          submitTargets: [
            { id: "blog-one", name: "Blog One", submitUrl: "https://blog-one.tumblr.com/submit" },
            { id: "blog-two", name: "Blog Two", submitUrl: "https://blog-two.tumblr.com/submit" },
          ],
          queueDefinitions: [{ id: "want-ads", name: "Want ads" }],
          tagProfiles: {},
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
  );
  await page.route("http://127.0.0.1:8021/api/queue/*", (route) => {
    const queueItem = route.request().postDataJSON();
    savedQueueItems.push(queueItem);
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue_item: queueItem }) });
  });

  await page.goto(appUrl);
  await page.getByLabel("Workspace views").getByRole("button", { name: "New Submission", exact: true }).click();
  await page.getByLabel("Content quality checklist").getByRole("button", { name: "Submission name" }).click();
  await page.locator(".editor-detail-grid").getByLabel("Submission name").waitFor();
  await page.getByRole("button", { name: "Toggle post content section" }).click();
  await page.locator(".tumblr-body-field").waitFor({ state: "detached" });
  await page.getByLabel("Content quality checklist").getByRole("button", { name: "Media" }).click();
  await page.locator(".tumblr-body-field").waitFor();
  await page.getByLabel("Queue destination").selectOption("Want ads");
  const imageDestinationLink = page.getByRole("link", { name: "Open image click-through destination" });
  assert.equal(await imageDestinationLink.getAttribute("href"), "https://destination.example/batch-photo");
  assert.equal(await imageDestinationLink.getAttribute("target"), "_blank");
  assert.equal(await imageDestinationLink.getAttribute("rel"), "noreferrer");
  const safeUrlCases = await page.evaluate(async () => {
    const { safeExternalUrl } = await import("/src/components/editor/LinkSummary.tsx");
    return {
      http: safeExternalUrl(" http://example.com/path "),
      https: safeExternalUrl("https://example.com/path"),
      malformed: safeExternalUrl("not a url"),
      javascript: safeExternalUrl("javascript:alert(1)"),
      data: safeExternalUrl("data:text/html,hello"),
      blank: safeExternalUrl("   "),
    };
  });
  assert.deepEqual(safeUrlCases, {
    http: "http://example.com/path",
    https: "https://example.com/path",
    malformed: "",
    javascript: "",
    data: "",
    blank: "",
  });
  await page.getByLabel("Image click-through URL").fill("javascript:alert(1)");
  await page.getByLabel("Link summary").first().getByText("Invalid or unsafe URL").waitFor();
  assert.equal(await page.getByRole("link", { name: "Open image click-through destination" }).count(), 0);
  await page.getByLabel("Image click-through URL").fill("https://destination.example/batch-photo");
  const editorLinkSummary = page.getByLabel("Link summary").first();
  await editorLinkSummary.getByText("Tumblr submission page").waitFor();
  await editorLinkSummary.getByText("https://forum.example/batch").waitFor();
  await editorLinkSummary.getByText("https://destination.example/batch-photo").waitFor();
  await page.getByRole("button", { name: "Preview all blogs" }).click();
  const queuePreview = page.getByLabel("Queue preview");
  await queuePreview.getByText("Blog One").waitFor();
  await queuePreview.getByText("Blog Two").waitFor();
  assert.equal(await queuePreview.getByText("Photo: batch-preview.png").count(), 2);
  assert.equal(await queuePreview.getByText("https://destination.example/batch-photo").count(), 2);
  assert.equal(await queuePreview.getByText("https://blog-one.tumblr.com/submit").count(), 1);
  assert.equal(await queuePreview.getByText("https://blog-two.tumblr.com/submit").count(), 1);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByLabel("Queue preview").waitFor({ state: "detached" });
  assert.equal(savedQueueItems.length, 0);

  await page.getByRole("button", { name: "Preview all blogs" }).click();
  await page.getByRole("button", { name: "Add 2 to queue" }).click();
  await page.getByText("Added to Want ads").waitFor();
  assert.equal(savedQueueItems.length, 2);
  assert.deepEqual(savedQueueItems.map((item) => item.target_name).sort(), ["Blog One", "Blog Two"]);
  assert.equal(savedQueueItems.every((item) => item.queue_name === "Want ads"), true);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("saved draft and editor preview queueing share payload shape", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8126 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  const localAppUrl = "http://127.0.0.1:8126";
  const localApiHeaders = { ...apiHeaders, "Access-Control-Allow-Origin": localAppUrl };
  await waitForServer(localAppUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  const pageErrors = [];
  const savedQueueItems = [];
  const fulfillJson = (route, body) =>
    route.fulfill({ contentType: "application/json", headers: localApiHeaders, body: JSON.stringify(body) });
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
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
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    fulfillJson(route, {
      advertisements: [{
        id: "shared-queue-ad",
        post_type: "photo",
        title: "Shared queue ad",
        campaign_name: "Shared campaign",
        content: "<p>Shared ready body</p>",
        destination_blog: "blog-one",
        forum_url: "https://forum.example/shared",
        tags: ["rp"],
        image_caption: "",
        image_name: "shared-queue.png",
        image_data_url: "/sample-forum-ad.png",
        video_url: "",
        video_name: "",
        status: "ready",
        updated_at: "2026-06-20T12:00:00.000Z",
      }],
    }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) => fulfillJson(route, { templates: [] }));
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) => fulfillJson(route, { accounts: [] }));
  await page.route("http://127.0.0.1:8021/api/queue", (route) => fulfillJson(route, { queue: [] }));
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) => fulfillJson(route, { logs: [] }));
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    fulfillJson(route, {
      settings: {
        submitTargets: [{ id: "blog-one", name: "Blog One", submitUrl: "https://blog-one.tumblr.com/submit" }],
        queueDefinitions: [{ id: "want-ads", name: "Want ads" }],
        tagProfiles: {},
      },
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) => fulfillJson(route, { settings: route.request().postDataJSON() }));
  await page.route("http://127.0.0.1:8021/api/queue/*", (route) => {
    const queueItem = route.request().postDataJSON();
    savedQueueItems.push(queueItem);
    fulfillJson(route, { queue_item: queueItem });
  });

  await page.goto(localAppUrl);
  await page.getByLabel("Workspace views").getByRole("button", { name: "Content Library", exact: true }).click();
  await page.locator(".advertisement-card", { hasText: "Shared queue ad" }).getByRole("button", { name: "Queue" }).click();
  await page.getByText("Queued Shared queue ad in Want ads.").waitFor();

  await page.getByLabel("Workspace views").getByRole("button", { name: "New Submission", exact: true }).click();
  assert.equal(await page.getByRole("link", { name: "Open image click-through destination" }).count(), 0);
  await page.getByRole("button", { name: "Preview queue" }).click();
  const blankImageDestination = page.getByLabel("Queue preview").getByLabel("Link summary").locator("div", { hasText: "Image click-through URL" });
  await blankImageDestination.getByText("Not set").waitFor();
  assert.equal(await blankImageDestination.getByRole("link").count(), 0);
  await page.getByRole("button", { name: "Add 1 to queue" }).click();
  await page.getByText("Added to Want ads").waitFor();

  assert.equal(savedQueueItems.length, 2);
  assert.deepEqual(savedQueueItems.map((item) => item.ad_id), ["shared-queue-ad", "shared-queue-ad"]);
  assert.deepEqual(savedQueueItems.map((item) => item.target_id), ["blog-one", "blog-one"]);
  assert.deepEqual(savedQueueItems.map((item) => item.queue_name), ["Want ads", "Want ads"]);
  assert.equal(
    savedQueueItems.every((item) => JSON.parse(item.runner_payload).advertisement.savedOptionName === "Shared queue ad"),
    true,
  );
  assert.equal(savedQueueItems.every((item) => JSON.parse(item.runner_payload).targetProfile.name === "Blog One"), true);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

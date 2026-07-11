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
import {
  setupBackendQueueBulkCompletionPage,
  submitBulkQueueCompletion,
} from "./helpers/queueBulkFixture.mjs";
import { setupRetryRecoveryPage } from "./helpers/retryRecoveryFixture.mjs";

const {
  apiHeaders,
  appUrl,
  routeAuthenticatedSession,
} = createFrontendTestContext(8123);

async function openFrontendTestPage(t) {
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

  return browser.newPage();
}

const queueBulkFixtureDeps = {
  apiHeaders,
  appUrl,
  openFrontendTestPage,
  openWorkspaceView,
  routeAuthenticatedSession,
};

const retryRecoveryFixtureDeps = {
  apiHeaders,
  appUrl,
  openFrontendTestPage,
  openWorkspaceView,
  routeAuthenticatedSession,
};

test("queue review banner summarizes attention items and opens submissions", { timeout: 40000 }, async (t) => {
  const bulkQueue = await setupBackendQueueBulkCompletionPage(t, queueBulkFixtureDeps, {
    firstItemStatus: "failed",
    firstItemNotes: "Browser closed before posting.",
  });

  const banner = bulkQueue.page.getByLabel("Queue review required");
  await banner.getByText("1 item need review").waitFor();
  await banner.getByText("Review items are parked; runnable submissions can continue.").waitFor();
  await bulkQueue.page.getByRole("button", { name: "Toggle queued submissions section" }).click();
  await bulkQueue.page.getByLabel("Queue bulk editor").waitFor({ state: "detached" });
  await banner.getByRole("button", { name: "Review queue" }).click();
  await bulkQueue.page.getByLabel("Queue bulk editor").waitFor();
  await bulkQueue.page.locator(".queue-item", { hasText: "Why this failed" }).waitFor();
  assert.equal(bulkQueue.pageErrors.length, 0, bulkQueue.pageErrors.map((error) => error.message).join("\n"));
});

test("queue flow summary renders health, lanes, automation, and empty reasons", { timeout: 40000 }, async (t) => {
  const page = await openFrontendTestPage(t);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ queue: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        advertisements: [{
          id: "ad-ready-refill",
          post_type: "text",
          title: "Ready refill source",
          campaign_name: "",
          content: "<p>Ready refill body</p>",
          destination_blog: "refillblog",
          forum_url: "https://forum.example/refill",
          tags: ["refill"],
          image_caption: "",
          image_name: "",
          image_data_url: "",
          video_url: "",
          video_name: "",
          status: "ready",
          archived: false,
          updated_at: "2026-06-20T12:00:00.000Z",
        }],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          submitTargets: [{ id: "refillblog", name: "Refill Blog", submitUrl: "https://refillblog.tumblr.com/submit" }],
          queueDefinitions: [{ id: "default-queue", name: "Default queue" }],
          runnerSettings: {},
          scheduleSettings: {},
          tagProfiles: {},
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/logs", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ logs: [] }) }),
  );
  await page.route("http://127.0.0.1:8021/api/runner/status", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ runner: { running: false } }) }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
  );

  await page.goto(appUrl);
  await openWorkspaceView(page, "Queues");
  await page.locator(".queue-management-row", { hasText: "Default queue" }).getByRole("button", { name: "Open queue" }).click();

  await page.getByLabel("Queue operations summary").getByText("Queue operations").waitFor();
  await page.getByLabel("Queue health summary").getByText("Ready ads").waitFor();
  await page.getByLabel("Queue health summary").getByText("1").waitFor();
  await page.getByLabel("Queue automation state").getByText("Automation off").waitFor();
  await page.getByLabel("Queue automation state").getByText("1 ready ad can refill this queue.").waitFor();
  await page.getByLabel("Queue work lanes").getByText("Runnable").waitFor();
  await page.getByLabel("Queue work lanes").getByText("Attention").waitFor();
  await page.getByLabel("Queue flow timeline").getByText("Replacement").waitFor();
  await page.getByText("1 ready ad can refill this queue after automation runs.").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("queue bulk completion stops cleanly when the first completed item save fails", { timeout: 40000 }, async (t) => {
  const bulkQueue = await setupBackendQueueBulkCompletionPage(t, queueBulkFixtureDeps);
  await bulkQueue.page.getByLabel("Queue operations summary").getByText("Queue operations").waitFor();
  await bulkQueue.page.getByLabel("Queue runner status").getByRole("button", { name: /Runner|Launch|Manage|Open|Write|Review/ }).waitFor();
  bulkQueue.failureMode.firstCompletionSave = true;
  const firstFailureResponse = bulkQueue.page.waitForResponse((response) => response.url().includes("/api/queue/") && response.status() === 500);
  await submitBulkQueueCompletion(bulkQueue.page);
  await firstFailureResponse;

  await bulkQueue.page.getByText("Could not save queue update. Try again.").waitFor();
  assert.equal(bulkQueue.savedQueuePayloads.length, 1);
  assert.equal(bulkQueue.savedQueuePayloads[0].status, "submitted");
  assert.equal(await bulkQueue.page.getByText("Auto-added 2 replacements.").count(), 0);
  assert.equal(await bulkQueue.page.getByLabel("Post history archive").getByText("Bulk updated from queue workspace.").count(), 0);
  assert.equal(await bulkQueue.page.locator(".queue-item", { hasText: "Ready for local browser runner." }).count(), 2);
  assert.equal(bulkQueue.pageErrors.length, 0, bulkQueue.pageErrors.map((error) => error.message).join("\n"));
});

test("queue bulk completion reports a completed-item partial save", { timeout: 40000 }, async (t) => {
  const bulkQueue = await setupBackendQueueBulkCompletionPage(t, queueBulkFixtureDeps);
  bulkQueue.failureMode.completedItemPartialAfter = 1;
  const partialFailureResponse = bulkQueue.page.waitForResponse((response) => response.url().includes("/api/queue/") && response.status() === 500);
  await submitBulkQueueCompletion(bulkQueue.page);
  await partialFailureResponse;

  await bulkQueue.page.getByText("Saved 1 queue change, but syncing stopped before Refill Blog second.", { exact: false }).waitFor();
  assert.equal(bulkQueue.savedQueuePayloads.length, 2);
  assert.deepEqual(bulkQueue.getQueueItems().map((item) => item.status).sort(), ["queued", "submitted"]);
  await bulkQueue.page.getByLabel("Post history archive").getByText("Bulk updated from queue workspace.").waitFor();
  await bulkQueue.page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Clipboard denied")),
      },
    });
  });
  await bulkQueue.page.getByLabel("Post history archive").getByRole("button", { name: "Copy all Discord updates" }).click();
  await bulkQueue.page.getByRole("status").getByText("Could not copy Discord updates. Check browser clipboard permission.").waitFor();
  await bulkQueue.page.locator(".queue-item", { hasText: "Ready for local browser runner." }).waitFor();
  assert.equal(bulkQueue.pageErrors.length, 0, bulkQueue.pageErrors.map((error) => error.message).join("\n"));
});

test("queue bulk completion reports unresolved refill partial saves", { timeout: 40000 }, async (t) => {
  const bulkQueue = await setupBackendQueueBulkCompletionPage(t, queueBulkFixtureDeps);
  bulkQueue.failureMode.refillPartialAfter = 1;
  bulkQueue.failureMode.queueListReloadFails = true;
  const refillFailureResponse = bulkQueue.page.waitForResponse((response) => response.url().includes("/api/queue/") && response.status() === 500);
  await submitBulkQueueCompletion(bulkQueue.page);
  await refillFailureResponse;

  await bulkQueue.page.getByText("Saved 3 queue changes, but syncing stopped before Refill Blog.", { exact: false }).waitFor();
  await bulkQueue.page.getByText("The backend queue could not be reloaded, so refresh before retrying.").waitFor();
  assert.deepEqual(
    bulkQueue.savedQueuePayloads.map((item) => item.status).sort(),
    ["queued", "queued", "submitted", "submitted"],
  );
  assert.equal(bulkQueue.getQueueItems().filter((item) => item.ad_id?.startsWith("ad-refill")).length, 1);
  await bulkQueue.page.locator(".queue-item", { hasText: "Auto-added to keep this queue stocked" }).waitFor();
  assert.equal(await bulkQueue.page.locator(".queue-item", { hasText: "Auto-added to keep this queue stocked" }).count(), 1);
  assert.equal(bulkQueue.pageErrors.length, 0, bulkQueue.pageErrors.map((error) => error.message).join("\n"));
});

test("queue bulk completion saves completed items and one refill set", { timeout: 40000 }, async (t) => {
  const bulkQueue = await setupBackendQueueBulkCompletionPage(t, queueBulkFixtureDeps, { delayCompletionSaveMs: 150 });
  const updateButton = bulkQueue.page.getByLabel("Queue bulk editor").getByRole("button", { name: "Update 2" });
  await updateButton.click();

  await bulkQueue.page.getByText("Auto-added 2 replacements.").waitFor();
  await bulkQueue.page.locator(".queue-item", { hasText: "Auto-added to keep this queue stocked" }).first().waitFor();
  await bulkQueue.page.getByLabel("Post history archive").getByText("Bulk updated from queue workspace.").first().waitFor();
  assert.equal(bulkQueue.savedQueuePayloads.length, 4);
  assert.deepEqual(
    bulkQueue.savedQueuePayloads.map((item) => item.status).sort(),
    ["queued", "queued", "submitted", "submitted"],
  );
  assert.deepEqual(
    bulkQueue.savedQueuePayloads.filter((item) => item.status === "submitted").map((item) => item.id).sort(),
    ["queue-bulk-one", "queue-bulk-two"],
  );
  assert.deepEqual(
    bulkQueue.savedQueuePayloads.filter((item) => item.status === "queued").map((item) => item.ad_id).sort(),
    ["ad-refill-one", "ad-refill-two"],
  );
  assert.equal(bulkQueue.getQueueItems().filter((item) => item.ad_id?.startsWith("ad-refill")).length, 2);
  assert.equal(bulkQueue.pageErrors.length, 0, bulkQueue.pageErrors.map((error) => error.message).join("\n"));
});

test("queue completion keeps overlapping single-item and bulk refill commits consistent", { timeout: 40000 }, async (t) => {
  const bulkQueue = await setupBackendQueueBulkCompletionPage(t, queueBulkFixtureDeps, {
    delayCompletionSaveMs: 5000,
    firstItemStatus: "failed",
    firstItemNotes: "Runner failed before posting.",
  });
  const failedItem = bulkQueue.page.locator(".queue-item", { hasText: "Refill Blog" }).filter({ hasText: "Why this failed" });
  const retryButton = failedItem.getByRole("button", { name: "Retry test run" });
  const markPostedClick = failedItem.getByRole("button", { name: "Mark posted" }).click();
  await bulkQueue.waitForSaveRequestCount(1);
  await bulkQueue.page.getByText("Queue update in progress for this queue.").waitFor();
  assert.equal(await retryButton.isDisabled(), true);
  const retryCountBeforeConflict = bulkQueue.savedQueuePayloads.length;
  await retryButton.click({ force: true });
  await bulkQueue.page.waitForTimeout(100);
  assert.equal(bulkQueue.savedQueuePayloads.length, retryCountBeforeConflict);
  assert.deepEqual(bulkQueue.getRunnerRequests(), { companionRun: 0, localCommand: 0 });
  await markPostedClick;
  await bulkQueue.waitForSaveRequestCount(2);

  assert.deepEqual(
    bulkQueue.savedQueuePayloads.map((item) => item.status).sort(),
    ["posted", "queued"],
  );
  assert.equal(retryCountBeforeConflict, 1);
  assert.equal(bulkQueue.getQueueItems().filter((item) => item.ad_id?.startsWith("ad-refill")).length, 1);
  assert.equal(bulkQueue.pageErrors.length, 0, bulkQueue.pageErrors.map((error) => error.message).join("\n"));
});

test("single-item requeue without refill clears the in-progress queue status", { timeout: 40000 }, async (t) => {
  const bulkQueue = await setupBackendQueueBulkCompletionPage(t, queueBulkFixtureDeps, {
    firstItemStatus: "failed",
    firstItemNotes: "Runner failed before posting.",
  });
  const failedItem = bulkQueue.page.locator(".queue-item", { hasText: "Refill Blog" }).filter({ hasText: "Why this failed" });

  await failedItem.getByRole("button", { name: "Requeue" }).click();
  await bulkQueue.page.getByText("Marked submission queued.").waitFor();
  assert.equal(await bulkQueue.page.getByText("Queue update in progress for this queue.").count(), 0);
  assert.deepEqual(
    bulkQueue.savedQueuePayloads.map((item) => item.status),
    ["queued"],
  );
  assert.equal(bulkQueue.getQueueItems().filter((item) => item.ad_id?.startsWith("ad-refill")).length, 0);
  assert.equal(bulkQueue.pageErrors.length, 0, bulkQueue.pageErrors.map((error) => error.message).join("\n"));
});

test("retry test run stops when the failed item cannot be requeued", { timeout: 40000 }, async (t) => {
  const retry = await setupRetryRecoveryPage(t, retryRecoveryFixtureDeps);

  retry.failNextRetryQueueSave();
  await retry.page.getByRole("button", { name: "Retry test run" }).click();
  await retry.page.getByText("Could not save the requeued submission before retrying. Try again.").waitFor();
  assert.equal(retry.companionRunPayloads.length, 0);
  assert.equal(retry.getLocalCommandRequestCount(), 0);
  await retry.page.getByText("Why this failed").waitFor();
  assert.equal(retry.pageErrors.length, 0, retry.pageErrors.map((error) => error.message).join("\n"));
});

test("retry test run copies the local command when the companion is unavailable", { timeout: 40000 }, async (t) => {
  const retry = await setupRetryRecoveryPage(t, retryRecoveryFixtureDeps);

  retry.setCompanionAvailable(false);
  await retry.reopenQueue();
  const retryCommandResponse = retry.page.waitForResponse((response) => response.url().includes("/api/runner/local-command"));
  await retry.page.getByRole("button", { name: "Retry test run" }).click();
  await retryCommandResponse;
  assert.equal(retry.companionRunPayloads.length, 0);
  assert.equal(retry.getLocalCommandRequestCount(), 1);
  await retry.page.getByText("Queue at least one target before starting the runner.").waitFor({ state: "detached" });
  await retry.page.getByText(/start a test run that prepares Tumblr without submitting/).waitFor();
  assert.equal(retry.pageErrors.length, 0, retry.pageErrors.map((error) => error.message).join("\n"));
});

test("retry test run saves the requeue before starting the local companion", { timeout: 40000 }, async (t) => {
  const retry = await setupRetryRecoveryPage(t, retryRecoveryFixtureDeps);

  retry.resetFailedQueue();
  retry.setCompanionAvailable(true);
  retry.requireQueueSaveBeforeRun();
  await retry.reopenQueue();
  const retryRunResponse = retry.page.waitForResponse((response) => response.url() === "http://127.0.0.1:17842/run");
  await retry.page.getByRole("button", { name: "Retry test run" }).click();
  await retryRunResponse;
  await retry.page.getByText(/Starting a recovery test run|Local companion started a test run/).waitFor();
  assert.deepEqual(retry.companionRunPayloads.at(-1), { queueName: "Default queue", headless: false, mode: "manual", submit: false });
  assert.equal(await retry.page.getByText("Manual override").count(), 0);
  assert.equal(await retry.page.getByRole("button", { name: "Mark failed" }).count(), 0);
  assert.equal(retry.pageErrors.length, 0, retry.pageErrors.map((error) => error.message).join("\n"));
});

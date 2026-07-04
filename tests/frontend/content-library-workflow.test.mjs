import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";
import {
  createFrontendTestContext,
  stopProcessTree,
  waitForServer,
} from "./helpers/appTestServer.mjs";

const {
  apiHeaders,
  appUrl,
  routeAuthenticatedSession,
  routeEmptyWorkspaceApis,
} = createFrontendTestContext(8128);

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
    Settings: "Settings",
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

test("content library rows can queue a saved submission", { timeout: 40000 }, async (t) => {
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
  const savedQueueItems = [];
  const savedAdvertisements = [];
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
            campaignName: "Alpha campaign",
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
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        advertisements: [
          {
            id: "saved-ad",
            post_type: "text",
            title: "Saved queue post",
            campaign_name: "Summer campaign",
            content: "<p>Saved content</p>",
            destination_blog: "allthingsroleplay",
            forum_url: "https://forum.example/thread",
            tags: ["wanted"],
            image_caption: "",
            image_name: "",
            image_data_url: "",
            video_url: "",
            video_name: "",
            status: "draft",
            updated_at: "2026-06-20T12:00:00.000Z",
          },
          {
            id: "saved-ad-two",
            post_type: "text",
            title: "Second saved post",
            campaign_name: "Alpha campaign",
            content: "<p>Saved content</p>",
            destination_blog: "allthingsroleplay",
            forum_url: "https://forum.example/thread",
            tags: ["wanted"],
            image_caption: "",
            image_name: "",
            image_data_url: "",
            video_url: "",
            video_name: "",
            status: "draft",
            updated_at: "2026-06-20T12:05:00.000Z",
          },
          {
            id: "saved-ad-needs-work",
            post_type: "text",
            title: "Needs forum link",
            campaign_name: "",
            content: "<p>Missing forum URL</p>",
            destination_blog: "allthingsroleplay",
            forum_url: "",
            tags: [],
            image_caption: "",
            image_name: "",
            image_data_url: "",
            video_url: "",
            video_name: "",
            status: "draft",
            updated_at: "2026-06-20T12:10:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements/*", (route) => {
    const advertisement = route.request().postDataJSON();
    savedAdvertisements.push(advertisement);
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ advertisement }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          submitTargets: [
            {
              id: "allthingsroleplay",
              name: "allthingsroleplay",
              profileName: "All Things Roleplay ads",
              submitUrl: "https://allthingsroleplay.tumblr.com/submit",
              forumUrl: "https://forum.example/thread",
              postingRules: "Use photo posts and credit the forum.",
            },
          ],
          queueDefinitions: [
            { id: "default-queue", name: "Default queue" },
            { id: "want-ads", name: "Want ads" },
          ],
          tagProfiles: {},
        },
      }),
    }),
  );

  await page.goto(appUrl);
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByLabel("Content readiness").getByText("3 drafts available").waitFor();
  await page.getByLabel("Operations dashboard").getByText("Local runner offline").waitFor();
  await openWorkspaceView(page, "Content Library");
  const savedRow = page.locator(".draft-row").filter({ has: page.locator("strong", { hasText: "Saved queue post" }) });
  await savedRow.getByText("Type").waitFor();
  await savedRow.getByText("Summer campaign").waitFor();
  await savedRow.getByText("Target").waitFor();
  await savedRow.getByText("Updated").waitFor();
  await savedRow.getByText("100% ready").waitFor();
  const archiveResponse = page.waitForResponse((response) => response.url().includes("/api/advertisements/saved-ad") && response.request().method() === "PUT");
  await savedRow.getByRole("button", { name: "Archive" }).click();
  await page.getByLabel("Campaign library").getByRole("button", { name: /Archived/ }).click();
  const archivedRow = page.locator(".draft-row.archived", { hasText: "Saved queue post" });
  await archivedRow.getByRole("button", { name: "Restore to queue" }).waitFor();
  assert.equal(await archivedRow.getByRole("button", { name: "Restore to queue" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Queue ready drafts" }).isDisabled(), true);
  await page.getByLabel("Campaign library").getByRole("button", { name: /All saved/ }).click();
  const archivedAllRow = page.locator(".draft-row.archived", { hasText: "Saved queue post" });
  assert.equal(await archivedAllRow.getByRole("button", { name: "Restore to queue" }).isDisabled(), true);
  const unarchiveResponse = page.waitForResponse((response) => response.url().includes("/api/advertisements/saved-ad") && response.request().method() === "PUT");
  await archivedAllRow.getByRole("button", { name: "Unarchive" }).click();
  await archiveResponse;
  await unarchiveResponse;
  assert.deepEqual(savedAdvertisements.filter((ad) => ad.id === "saved-ad").map((ad) => ({ status: ad.status, archived: ad.archived })), [
    { status: "draft", archived: true },
    { status: "draft", archived: false },
  ]);
  await page.getByLabel("Campaign library").getByRole("button", { name: /Active/ }).click();
  await savedRow.getByText("100% ready").waitFor();
  await savedRow.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("heading", { name: "Saved queue post", level: 1 }).waitFor();
  assert.equal(await page.getByRole("status").getByText("Thank you!").count(), 0);
  await openWorkspaceView(page, "Content Library");
  await page.getByLabel("Batch prep assistant").getByText("2 ready to queue - 1 need edits").waitFor();
  await page.getByLabel("Duplicate content check").getByText("2 possible duplicates in 1 group").waitFor();
  await page.getByLabel("Duplicate review workflow").getByRole("button", { name: "Edit first" }).waitFor();
  assert.equal(await page.locator(".duplicate-pill").count(), 2);
  await savedRow.getByLabel("Select saved item").check();
  await page.getByLabel("Campaign library").getByRole("button", { name: /Alpha campaign/ }).click();
  await page.getByLabel("Batch prep assistant").getByText("Alpha campaign: 1 ready to queue - 0 need edits").waitFor();
  assert.equal(await page.getByRole("button", { name: "Queue ready campaign" }).isDisabled(), true);
  assert.deepEqual(savedQueueItems.map((item) => item.ad_id), []);
  await page.getByLabel("Campaign library").getByRole("button", { name: /All campaigns/ }).click();
  await savedRow.getByLabel("Select saved item").uncheck();
  const needsWorkRow = page.locator(".draft-row", { hasText: "Needs forum link" });
  await needsWorkRow.getByLabel("Select saved item").check();
  await page.getByLabel("Batch queue destination").selectOption("Want ads");
  assert.equal(await page.getByRole("button", { name: "Queue ready drafts" }).isDisabled(), true);
  assert.deepEqual(savedQueueItems.map((item) => item.ad_id), []);
  await needsWorkRow.getByLabel("Select saved item").uncheck();
  await savedRow.getByLabel("Select saved item").check();
  const selectedBatchQueue = page.waitForResponse((response) => response.url().includes("/api/queue/") && response.request().method() === "PUT");
  await page.getByLabel("Batch queue destination").selectOption("Want ads");
  await page.getByRole("button", { name: "Queue ready drafts" }).click();
  await selectedBatchQueue;
  assert.deepEqual(savedQueueItems.map((item) => item.ad_id), ["saved-ad"]);
  await openWorkspaceView(page, "Content Library");
  await page.getByLabel("Campaign library").getByRole("button", { name: /All campaigns/ }).waitFor();
  await page.getByLabel("Campaign library").getByRole("button", { name: /Alpha campaign/ }).click();
  await page.getByLabel("Batch prep assistant").getByText("Alpha campaign: 1 ready to queue - 0 need edits").waitFor();
  await page.locator(".advertisement-card").first().getByText("Second saved post").waitFor();
  assert.equal(await savedRow.count(), 0);
  assert.equal(await page.getByLabel("Saved sorting controls").getByLabel("Campaign").count(), 0);
  assert.equal(await page.getByLabel("Saved sorting controls").getByLabel("Add tag").count(), 0);
  await page.getByLabel("Saved sorting controls").getByLabel("Sort library").selectOption("campaign-asc");
  await page.getByLabel("Batch queue destination").selectOption("Want ads");
  await page.getByRole("button", { name: "Queue ready campaign" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  await page.getByText("Queued Second saved post in Want ads.").waitFor();
  assert.deepEqual(savedQueueItems.map((item) => item.ad_id), ["saved-ad", "saved-ad-two"]);
  assert.equal(JSON.parse(savedQueueItems.find((item) => item.ad_id === "saved-ad-two").runner_payload).advertisement.campaignName, "Alpha campaign");
  assert.equal(JSON.parse(savedQueueItems.find((item) => item.ad_id === "saved-ad-two").runner_payload).targetProfile.name, "All Things Roleplay ads");
  assert.equal(
    JSON.parse(savedQueueItems.find((item) => item.ad_id === "saved-ad-two").runner_payload).targetProfile.postingRules,
    "Use photo posts and credit the forum.",
  );
  assert.equal(savedQueueItems.every((item) => item.target_id === "allthingsroleplay"), true);
  assert.equal(savedQueueItems.every((item) => item.queue_name === "Want ads"), true);
  assert.equal(await page.getByLabel("Active queue").inputValue(), "Want ads");
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});


test("content library archive actions surface backend save failures", { timeout: 40000 }, async (t) => {
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
  const savedAdvertisements = [];
  let failNextAdvertisementSave = true;
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
          {
            id: "archive-failure-ad",
            post_type: "text",
            title: "Archive failure post",
            campaign_name: "Failure campaign",
            content: "<p>Saved content</p>",
            destination_blog: "allthingsroleplay",
            forum_url: "https://forum.example/thread",
            tags: ["wanted"],
            image_caption: "",
            image_name: "",
            image_data_url: "",
            video_url: "",
            video_name: "",
            status: "draft",
            archived: false,
            updated_at: "2026-06-20T12:00:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements/*", (route) => {
    const advertisement = route.request().postDataJSON();
    savedAdvertisements.push(advertisement);
    if (failNextAdvertisementSave) {
      failNextAdvertisementSave = false;
      return route.fulfill({
        contentType: "application/json",
        headers: apiHeaders,
        status: 500,
        body: JSON.stringify({ error: "Archive save failed." }),
      });
    }

    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ advertisement }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          submitTargets: [{ id: "allthingsroleplay", name: "allthingsroleplay", submitUrl: "https://allthingsroleplay.tumblr.com/submit" }],
          queueDefinitions: [{ id: "default-queue", name: "Default queue" }],
          tagProfiles: {},
        },
      }),
    }),
  );

  await page.goto(appUrl);
  await openWorkspaceView(page, "Content Library");
  const activeRow = page.locator(".draft-row", { hasText: "Archive failure post" });
  const failedArchive = page.waitForResponse((response) => response.url().includes("/api/advertisements/archive-failure-ad") && response.status() === 500);
  await activeRow.getByRole("button", { name: "Archive" }).click();
  await failedArchive;
  await page.getByRole("status").getByText("Could not archive saved ad. Try again.").waitFor();
  await activeRow.getByRole("button", { name: "Archive" }).waitFor();
  assert.equal(await page.locator(".draft-row.archived", { hasText: "Archive failure post" }).count(), 0);

  const successfulArchive = page.waitForResponse((response) => response.url().includes("/api/advertisements/archive-failure-ad") && response.status() === 200);
  await activeRow.getByRole("button", { name: "Archive" }).click();
  await successfulArchive;
  await page.getByRole("status").getByText("Archived saved ad").waitFor();
  await page.getByLabel("Campaign library").getByRole("button", { name: /Archived/ }).click();
  const archivedRow = page.locator(".draft-row.archived", { hasText: "Archive failure post" });
  await archivedRow.getByRole("button", { name: "Unarchive" }).waitFor();

  failNextAdvertisementSave = true;
  const failedRestore = page.waitForResponse((response) => response.url().includes("/api/advertisements/archive-failure-ad") && response.status() === 500);
  await archivedRow.getByRole("button", { name: "Unarchive" }).click();
  await failedRestore;
  await page.getByRole("status").getByText("Could not restore saved ad. Try again.").waitFor();
  await archivedRow.getByRole("button", { name: "Unarchive" }).waitFor();
  assert.deepEqual(savedAdvertisements.map((ad) => ad.archived), [true, true, false]);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});


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
} = createFrontendTestContext(8127);

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

test("operations dashboard centers content readiness without backup controls", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8127 --strictPort", {
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
  const savedAppSettings = [];
  const savedDiscordWebhooks = [];
  const testedDiscordWebhooks = [];
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
            campaign_name: "Ops campaign",
            content: "Saved copy",
            destination_blog: "localblog",
            forum_url: "https://forum.example/local",
            tags: ["local"],
            image_caption: "",
            image_name: "",
            image_data_url: "",
            video_url: "",
            video_name: "",
            status: "draft",
            archived: false,
            updated_at: "2026-06-20T12:00:00.000Z",
          },
          {
            id: "local-archived",
            post_type: "text",
            title: "Archived local draft",
            campaign_name: "Ops campaign",
            content: "Archived saved copy",
            destination_blog: "localblog",
            forum_url: "https://forum.example/archived",
            tags: ["local"],
            image_caption: "",
            image_name: "",
            image_data_url: "",
            video_url: "",
            video_name: "",
            status: "draft",
            archived: true,
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
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        accounts: [{
          id: "tumblr-ops",
          display_name: "Ops Tumblr",
          blog_name: "opsblog",
          user_data_dir: "C:/tumblr/ops",
          status: "connected",
          last_checked_at: "2026-06-20T12:00:00.000Z",
          last_login_at: "2026-06-20T11:00:00.000Z",
          notes: "",
          updated_at: "2026-06-20T12:00:00.000Z",
        }],
      }),
    }),
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
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) => {
    const settings = route.request().postDataJSON();
    savedAppSettings.push(settings);
    return route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings }) });
  });
  await page.route("http://127.0.0.1:8021/api/settings/discord-webhook", (route) => {
    const payload = route.request().postDataJSON();
    savedDiscordWebhooks.push(payload.webhookUrl);
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ discordWebhook: { configured: Boolean(payload.webhookUrl) } }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/settings/discord-webhook-test", (route) => {
    const payload = route.request().postDataJSON();
    testedDiscordWebhooks.push(payload.webhookUrl);
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      status: 201,
      body: JSON.stringify({ discordWebhook: { tested: true } }),
    });
  });
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
  await page.getByLabel("Run blockers").getByText("Add queued or scheduled submissions.").waitFor();
  await page.getByLabel("Run blockers").getByRole("button", { name: "Fix queue" }).first().waitFor();
  await page.getByLabel("Campaign dashboard").getByText("Ops campaign").waitFor();
  await page.getByLabel("Campaign dashboard").getByText("2 saved - 1 ready - 0 need edits").waitFor();
  await page.getByLabel("Campaign dashboard").getByText("1 archived - 0 queued").waitFor();
  await page.getByLabel("Content readiness").getByText("2 drafts available").waitFor();
  await page.getByLabel("Content readiness").getByText("Saved drafts").waitFor();
  await page.getByLabel("Content readiness").getByText("Reusable templates").waitFor();
  await page.getByLabel("Content readiness").getByText("Queue coverage").waitFor();
  await page.getByLabel("Content readiness").getByText("0/0").waitFor();
  await page.getByLabel("Content readiness").getByText("Account path", { exact: true }).waitFor();
  await page.getByLabel("Content readiness").getByText("Open library").waitFor();
  assert.equal(await page.getByRole("button", { name: "Export workspace" }).count(), 0);
  assert.equal(await page.locator('input[aria-label="Import workspace file"]').count(), 0);
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Templates", exact: true }).count(), 1);
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Queues", exact: true }).count(), 1);
  assert.equal(await page.getByLabel("Workspace views").getByRole("button", { name: "Accounts", exact: true }).count(), 1);
  await page.getByLabel("Content readiness").getByRole("button", { name: "Prep content", exact: true }).click();
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Back to Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByLabel("Operations command center").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Operational settings", level: 1 }).waitFor();
  await page.getByLabel("Operational settings").getByLabel("Runner defaults").getByText("Automation mode").waitFor();
  await page.getByLabel("Operational settings").getByLabel("Schedule defaults").getByText("Daily queue timing").waitFor();
  await page.getByLabel("Operational settings").getByLabel("Account defaults").getByText("Posting identity").waitFor();
  await page.getByLabel("Operational settings").getByLabel("Discord notifications").getByText("Run summaries").waitFor();
  await page.getByLabel("Runner defaults").getByLabel("Headless browser").check();
  await page.getByLabel("Runner defaults").getByLabel("Approve live posting").check();
  await page.getByLabel("Runner defaults").getByLabel("Runner pacing").fill("400");
  await page.getByLabel("Schedule defaults").getByLabel("Enable daily automation by default").check();
  await page.getByLabel("Schedule defaults").getByLabel("Default daily run time").fill("10:30");
  await page.getByLabel("Discord notifications").getByLabel("Discord webhook URL").fill("https://discord.com/api/webhooks/123/token");
  await page.getByLabel("Discord notifications").getByRole("button", { name: "Save webhook" }).click();
  await page.getByLabel("Discord notifications").getByText("Discord webhook saved.").waitFor();
  await page.getByLabel("Discord notifications").getByText("Configured").waitFor();
  await page.getByLabel("Discord notifications").getByRole("button", { name: "Send test" }).click();
  await page.getByLabel("Discord notifications").getByText("Discord test sent.").waitFor();
  await page.getByLabel("Discord notifications").getByRole("button", { name: "Clear" }).click();
  await page.getByLabel("Discord notifications").getByText("Discord webhook cleared.").waitFor();
  await page.getByLabel("Discord notifications").getByText("Not configured").waitFor();
  const settingsSave = page.waitForResponse((response) => {
    if (!response.url().includes("/api/settings/app") || response.request().method() !== "PUT") {
      return false;
    }
    return response.request().postDataJSON().runnerSettings?.tumblrAccountId === "tumblr-ops";
  });
  await page.getByLabel("Account defaults").getByLabel("Runner account").selectOption("tumblr-ops");
  await settingsSave;
  const latestSettings = savedAppSettings.at(-1);
  assert.equal(latestSettings.runnerSettings.headless, true);
  assert.equal(latestSettings.runnerSettings.submit, true);
  assert.equal(latestSettings.runnerSettings.slowMo, 400);
  assert.equal(latestSettings.runnerSettings.tumblrAccountId, "tumblr-ops");
  assert.equal(latestSettings.runnerSettings.discordWebhookUrl, undefined);
  assert.equal(latestSettings.queueScheduleSettings.enabled, true);
  assert.equal(latestSettings.queueScheduleSettings.dailyTime, "10:30");
  assert.deepEqual(savedDiscordWebhooks, ["https://discord.com/api/webhooks/123/token", ""]);
  assert.deepEqual(testedDiscordWebhooks, [""]);

  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});


test("operational settings show backend save failures", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8127 --strictPort", {
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
  let failSettingsSaves = false;
  let failDiscordSave = false;
  let failDiscordTest = false;
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        accounts: [{
          id: "tumblr-settings",
          display_name: "Settings Tumblr",
          blog_name: "settingsblog",
          user_data_dir: "C:/tumblr/settings",
          status: "connected",
          last_checked_at: "2026-06-20T12:00:00.000Z",
          last_login_at: "2026-06-20T11:00:00.000Z",
          notes: "",
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
          submitTargets: [],
          queueDefinitions: [{ id: "default-queue", name: "Default queue" }],
          tagProfiles: {},
          runnerSettings: { headless: false, submit: false, slowMo: 100, tumblrAccountId: "" },
          queueScheduleSettings: { enabled: false, dailyTime: "09:00", timezone: "America/New_York", perQueue: {} },
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/settings/app", (route) => {
    const settings = route.request().postDataJSON();
    if (failSettingsSaves) {
      return route.fulfill({
        contentType: "application/json",
        headers: apiHeaders,
        status: 500,
        body: JSON.stringify({ error: "Settings save failed." }),
      });
    }
    return route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings }) });
  });
  await page.route("http://127.0.0.1:8021/api/settings/discord-webhook", (route) => {
    if (failDiscordSave) {
      return route.fulfill({
        contentType: "application/json",
        headers: apiHeaders,
        status: 400,
        body: JSON.stringify({ error: "Discord webhook URL must be a Discord webhook URL." }),
      });
    }
    const payload = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({ discordWebhook: { configured: Boolean(payload.webhookUrl) } }),
    });
  });
  await page.route("http://127.0.0.1:8021/api/settings/discord-webhook-test", (route) => {
    if (failDiscordTest) {
      return route.fulfill({
        contentType: "application/json",
        headers: apiHeaders,
        status: 400,
        body: JSON.stringify({ error: "Save a Discord webhook URL before sending a test." }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      status: 201,
      body: JSON.stringify({ discordWebhook: { tested: true } }),
    });
  });

  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await openWorkspaceView(page, "Settings");
  await page.getByRole("heading", { name: "Operational settings", level: 1 }).waitFor();
  failSettingsSaves = true;
  const failedSettingsSave = page.waitForResponse((response) => response.url().includes("/api/settings/app") && response.status() === 500);
  await page.getByLabel("Runner defaults").getByLabel("Headless browser").check();
  await page.getByLabel("Runner defaults").getByLabel("Approve live posting").check();
  await page.getByLabel("Schedule defaults").getByLabel("Enable daily automation by default").check();
  await page.getByLabel("Schedule defaults").getByLabel("Default daily run time").fill("11:15");
  await page.getByLabel("Account defaults").getByLabel("Runner account").selectOption("tumblr-settings");
  await failedSettingsSave;
  await page.getByRole("status").getByText("Could not save operational settings. Try again.").waitFor();
  failDiscordSave = true;
  await page.getByLabel("Discord notifications").getByLabel("Discord webhook URL").fill("https://discord.example.com/api/webhooks/123/token");
  await page.getByLabel("Discord notifications").getByRole("button", { name: "Save webhook" }).click();
  await page.getByLabel("Discord notifications").getByText("Discord webhook URL must be a Discord webhook URL.").waitFor();
  failDiscordSave = false;
  failDiscordTest = true;
  await page.getByLabel("Discord notifications").getByLabel("Discord webhook URL").fill("https://discord.com/api/webhooks/123/token");
  await page.getByLabel("Discord notifications").getByRole("button", { name: "Send test" }).click();
  await page.getByLabel("Discord notifications").getByText("Save a Discord webhook URL before sending a test.").waitFor();
  assert.equal(await page.getByLabel("Runner defaults").getByLabel("Headless browser").isChecked(), true);
  assert.equal(await page.getByLabel("Runner defaults").getByLabel("Approve live posting").isChecked(), true);
  assert.equal(await page.getByLabel("Schedule defaults").getByLabel("Enable daily automation by default").isChecked(), true);
  assert.equal(await page.getByLabel("Schedule defaults").getByLabel("Default daily run time").inputValue(), "11:15");
  assert.equal(await page.getByLabel("Account defaults").getByLabel("Runner account").inputValue(), "tumblr-settings");
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});


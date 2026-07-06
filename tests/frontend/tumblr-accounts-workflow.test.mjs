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
  await page.getByLabel("Workspace views").getByRole("button", { name: viewName, exact: true }).click();
}

async function openAccountsPage(t, options = {}) {
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
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          runnerSettings: {
            mediaDir: "",
            slowMo: 500,
            headless: true,
            submit: false,
            tumblrAccountId: options.tumblrAccountId ?? "",
          },
        },
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        accounts: options.accounts ?? [],
      }),
    }),
  );

  await page.goto(appUrl);
  await openWorkspaceView(page, "Accounts");
  await page.getByRole("heading", { name: "Tumblr accounts", level: 1 }).waitFor();
  return { page, pageErrors };
}

function connectedAccount() {
  return {
    id: "snowleopardx",
    display_name: "Myrana Tumblr",
    blog_name: "snowleopardx",
    user_data_dir: "",
    status: "connected",
    last_checked_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
    notes: "Saved Tumblr login is healthy.",
    updated_at: "2026-06-20T12:00:00.000Z",
  };
}

test("account overview shows empty setup when no Tumblr account is connected", { timeout: 40000 }, async (t) => {
  const { page, pageErrors } = await openAccountsPage(t);
  await page.getByLabel("Account overview").getByText("No connected Tumblr accounts yet").waitFor();
  await page.getByLabel("Account health summary").getByText("Connected").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("account overview distinguishes available connected accounts from selected runner accounts", { timeout: 40000 }, async (t) => {
  const { page, pageErrors } = await openAccountsPage(t, { accounts: [connectedAccount()] });
  await page.getByLabel("Account overview").getByText("Myrana Tumblr is connected and available. Choose it as the runner account before automation.").waitFor();
  await page.getByLabel("Account overview").getByText("Myrana Tumblr is selected for runner work.").waitFor({ state: "detached" });
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

test("account overview names the selected connected runner account", { timeout: 40000 }, async (t) => {
  const { page, pageErrors } = await openAccountsPage(t, { accounts: [connectedAccount()], tumblrAccountId: "snowleopardx" });
  await page.getByLabel("Account overview").getByText("1 connected account").waitFor();
  await page.getByLabel("Account overview").getByText("Myrana Tumblr is selected for runner work.").waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

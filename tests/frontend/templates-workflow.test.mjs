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

const {
  apiHeaders,
  appUrl,
  routeAuthenticatedSession,
  routeEmptyWorkspaceApis,
} = createFrontendTestContext(8130);

async function expectTemplateOrder(locator, expected) {
  await locator.first().waitFor();
  assert.deepEqual(await locator.allTextContents(), expected);
}

test("templates page filters and sorts multiple saved templates", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8130 --strictPort", {
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
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        templates: [
          {
            id: "template-alpha",
            name: "Alpha campaign",
            content: "<p>Forest opening copy</p>",
            forum_url: "https://forum.example/alpha",
            queue_name: "Morning ads",
            tags: ["forest", "premium"],
            updated_at: "2026-06-18T10:00:00.000Z",
          },
          {
            id: "template-zeta",
            name: "Zeta launch",
            content: "<p>Neon city copy</p>",
            forum_url: "https://forum.example/zeta",
            queue_name: "Evening ads",
            tags: ["city", "launch"],
            updated_at: "2026-06-20T10:00:00.000Z",
          },
          {
            id: "template-mid",
            name: "Midnight replay",
            content: "<p>Starlit mystery copy</p>",
            forum_url: "https://forum.example/midnight",
            queue_name: "Archive ads",
            tags: ["mystery", "replay"],
            updated_at: "2026-06-19T10:00:00.000Z",
          },
        ],
      }),
    }),
  );

  await page.goto(appUrl);
  await openWorkspaceView(page, "Templates");
  await page.getByRole("heading", { name: "Saved templates", level: 1 }).waitFor();

  const templateTitles = page.locator(".template-library-panel .template-card-title-row strong");
  await expectTemplateOrder(templateTitles, ["Zeta launch", "Midnight replay", "Alpha campaign"]);

  await page.getByLabel("Sort templates").selectOption("oldest");
  await expectTemplateOrder(templateTitles, ["Alpha campaign", "Midnight replay", "Zeta launch"]);

  await page.getByLabel("Sort templates").selectOption("name");
  await expectTemplateOrder(templateTitles, ["Alpha campaign", "Midnight replay", "Zeta launch"]);

  await page.getByLabel("Search templates").fill("city");
  await expectTemplateOrder(templateTitles, ["Zeta launch"]);
  await page.getByLabel("Search templates").fill("mystery");
  await expectTemplateOrder(templateTitles, ["Midnight replay"]);
  await page.getByLabel("Search templates").fill("Morning ads");
  await expectTemplateOrder(templateTitles, ["Alpha campaign"]);

  await page.getByLabel("Search templates").fill("");
  await page.getByLabel("Sort templates").selectOption("newest");
  await expectTemplateOrder(templateTitles, ["Zeta launch", "Midnight replay", "Alpha campaign"]);
  assert.equal(await page.getByRole("button", { name: "Template actions" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Preview" }).count(), 0);
});

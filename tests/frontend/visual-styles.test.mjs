import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
  port,
  routeAuthenticatedSession,
  routeEmptyWorkspaceApis,
} = createFrontendTestContext(8125);

function startVite(t) {
  const server = spawn(`npx vite --host 127.0.0.1 --port ${port} --strictPort`, {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  return server;
}

async function openAuthenticatedPage(t, viewport) {
  startVite(t);
  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage(viewport ? { viewport } : undefined);
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  return page;
}

async function routeThumbnailFixture(page) {
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        templates: [
          {
            id: "template-visual",
            name: "Grass is Greener Ad",
            content: "<p>A slice-of-life supernatural RPG based around two neighboring towns.</p>",
            forum_url: "https://forum.example/grass",
            queue_name: "Adverts",
            tags: ["jcink premium", "supernatural", "mature content", "21+"],
            updated_at: "2026-06-20T23:17:00.000Z",
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
            id: "queue-visual",
            ad_id: "ad-visual",
            target_id: "target-visual",
            target_name: "jcinktinder",
            tumblr_account_id: "tumblr-runner",
            queue_name: "Adverts",
            submit_url: "https://jcinktinder.tumblr.com/submit",
            post_type: "photo",
            status: "failed",
            scheduled_for: null,
            timezone: "America/New_York",
            created_at: "2026-07-06T14:09:00.000Z",
            updated_at: "2026-07-06T14:09:00.000Z",
            last_run_at: "2026-07-06T14:09:00.000Z",
            posted_at: null,
            failed_at: "2026-07-06T14:09:00.000Z",
            notes: "The Playwright browser or tab closed before the runner finished.",
            runner_payload: "{}",
          },
          {
            id: "queue-text-visual",
            ad_id: "ad-text-visual",
            target_id: "target-text-visual",
            target_name: "texttarget",
            tumblr_account_id: "tumblr-runner",
            queue_name: "Adverts",
            submit_url: "https://texttarget.tumblr.com/submit",
            post_type: "text",
            status: "failed",
            scheduled_for: null,
            timezone: "America/New_York",
            created_at: "2026-07-06T14:09:00.000Z",
            updated_at: "2026-07-06T14:09:00.000Z",
            last_run_at: "2026-07-06T14:09:00.000Z",
            posted_at: null,
            failed_at: "2026-07-06T14:09:00.000Z",
            notes: "The Playwright browser or tab closed before the runner finished.",
            runner_payload: "{}",
          },
        ],
      }),
    }),
  );
}

test("visual shell CSS keeps calm backgrounds and sidebar offsets in one place", () => {
  const styles = readFileSync("src/styles.css", "utf8");

  assert.doesNotMatch(styles, /rawpixel|site-overlay-image|image_png_800/);
  assert.match(styles, /\.app-shell::before\s*\{/);
  assert.match(styles, /\.app-shell::after\s*\{/);
  const appShellBlock = styles.match(/\.app-shell\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const darkAppShellBlock = styles.match(/html\[data-theme="dark"\]\s+\.app-shell\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const workspaceSavedBeforeBlock = styles.match(/\.workspace-saved::before\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const queueWorkspaceBeforeBlock = styles.match(/\.queue-workspace::before\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(appShellBlock, /linear-gradient\(180deg, #f6f8fa 0%, #eef3f5 100%\)/);
  assert.match(appShellBlock, /--sidebar-width: 248px;/);
  assert.match(appShellBlock, /grid-template-columns: var\(--sidebar-width\) minmax\(0, 1fr\)/);
  assert.doesNotMatch(appShellBlock, /radial-gradient|ellipse/);
  assert.match(darkAppShellBlock, /linear-gradient\(180deg, #101923 0%, #0f151d 100%\)/);
  assert.doesNotMatch(darkAppShellBlock, /radial-gradient|ellipse/);
  assert.match(styles, /\.app-shell::before\s*\{[\s\S]*content: none;/);
  assert.match(styles, /\.app-shell::after\s*\{[\s\S]*content: none;/);
  assert.match(styles, /html\[data-theme="dark"\]\s+\.app-shell::before\s*\{[\s\S]*content: none;/);
  assert.match(styles, /html\[data-theme="dark"\]\s+\.app-shell::after\s*\{[\s\S]*content: none;/);
  assert.match(workspaceSavedBeforeBlock, /inset: 0 0 0 var\(--sidebar-width\)/);
  assert.match(queueWorkspaceBeforeBlock, /inset: 0 0 0 var\(--sidebar-width\)/);
  assert.doesNotMatch(styles, /inset: 0 0 0 280px/);
  assert.match(styles, /html\[data-theme="dark"\]\[data-skin="forest-night"\]/);
  assert.match(styles, /html\[data-theme="light"\]\[data-skin="soft-green"\]/);
  assert.match(styles, /\.queue-workspace::before\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\]\s+\.queue-workspace::before\s*\{/);
});

test("visual domain source ownership stays segmented", () => {
  const globalStyles = readFileSync("src/styles.css", "utf8");
  const sidebarStyles = readFileSync("src/components/AppSidebar.css", "utf8");
  const editorStyles = readFileSync("src/components/editor/editorWorkspace.css", "utf8");
  const operationsStyles = readFileSync("src/components/operations/operationsDashboard.css", "utf8");
  const runnerStyles = readFileSync("src/components/runner/runnerWorkspace.css", "utf8");
  const queueStyles = readFileSync("src/components/queue/queueWorkspace.css", "utf8");
  const settingsStyles = readFileSync("src/components/settings/operationalSettingsWorkspace.css", "utf8");

  assert.doesNotMatch(globalStyles, /\.operations-hero\s*\{/);
  assert.doesNotMatch(globalStyles, /\.ops-status-card\s*\{/);
  assert.doesNotMatch(globalStyles, /\.campaign-readiness-card\s*\{/);
  assert.doesNotMatch(globalStyles, /\.editor-notebook-intro\s*\{/);
  assert.doesNotMatch(globalStyles, /\.queue-readiness\s*\{/);
  assert.doesNotMatch(globalStyles, /\.runner-flow-strip\s*\{/);
  assert.doesNotMatch(globalStyles, /\.queue-schedule-readiness-grid\s*\{/);
  assert.doesNotMatch(globalStyles, /\.settings-readiness-grid\s*\{/);
  assert.doesNotMatch(globalStyles, /\.queue-item-meta-row\s*\{/);
  assert.doesNotMatch(globalStyles, /\.runner-log-empty\s*\{/);
  assert.match(sidebarStyles, /\.sidebar\s+\.brand\s*\{/);
  assert.doesNotMatch(sidebarStyles, /^\.brand\s*\{/m);
  assert.match(editorStyles, /\.editor-surface\s+\.workflow-section\s*\{/);
  assert.doesNotMatch(editorStyles, /^\.workflow-section\s*\{/m);
  assert.match(operationsStyles, /\.operations-hero\s*\{/);
  assert.match(operationsStyles, /\.ops-status-card\s*\{/);
  assert.match(operationsStyles, /\.campaign-readiness-card\s*\{/);
  assert.match(operationsStyles, /\.quick-links-card\s*\{/);
  assert.match(operationsStyles, /\.run-readiness-empty\s*\{/);
  assert.match(operationsStyles, /\.run-readiness-review\s*\{/);
  assert.match(operationsStyles, /\.run-readiness-blocked\s*\{/);
  assert.match(operationsStyles, /html\[data-theme="dark"\]\s+\.run-readiness-empty\s*\{/);
  assert.match(operationsStyles, /html\[data-theme="dark"\]\s+\.run-readiness-review\s*\{/);
  assert.match(operationsStyles, /html\[data-theme="dark"\]\s+\.run-readiness-blocked\s*\{/);
  assert.match(runnerStyles, /\.runner-flow-strip\s*\{/);
  assert.match(runnerStyles, /\.runner-flow-step\.blocked\s*\{/);
  assert.match(runnerStyles, /\.runner-log-empty\s*\{/);
  assert.match(queueStyles, /\.queue-schedule-readiness-grid\s*\{/);
  assert.match(queueStyles, /\.queue-item-meta-row\s*\{/);
  assert.match(queueStyles, /\.queue-status-needs-review\s*\{/);
  assert.match(settingsStyles, /\.settings-readiness-grid\s*\{/);
  assert.match(settingsStyles, /\.settings-readiness-card\.warning\s*\{/);
  assert.match(globalStyles, /\.login-brand\s*\{/);
  assert.match(globalStyles, /\.login-brand\s+\.brand-mark\s*\{/);
});

test("dashboard and sidebar scoped styles apply without leaking globally", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t);
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();

  const dashboardStyles = await page.evaluate(() => {
    const hero = document.querySelector(".operations-hero");
    const grid = document.querySelector(".operations-status-strip");
    const card = document.querySelector(".ops-status-card");
    const brand = document.querySelector(".sidebar .brand");
    const looseBrand = document.createElement("div");
    looseBrand.className = "brand";
    looseBrand.textContent = "Loose brand";
    document.body.append(looseBrand);
    const looseAccount = document.createElement("div");
    looseAccount.className = "account-strip";
    looseAccount.textContent = "Loose account";
    document.body.append(looseAccount);
    const values = {
      heroBackground: hero ? getComputedStyle(hero).backgroundColor : "",
      gridDisplay: grid ? getComputedStyle(grid).display : "",
      cardRadius: card ? getComputedStyle(card).borderRadius : "",
      sidebarBrandDisplay: brand ? getComputedStyle(brand).display : "",
      looseBrandDisplay: getComputedStyle(looseBrand).display,
      looseAccountDisplay: getComputedStyle(looseAccount).display,
    };
    looseBrand.remove();
    looseAccount.remove();
    return values;
  });
  assert.equal(dashboardStyles.heroBackground, "rgb(255, 255, 255)");
  assert.equal(dashboardStyles.gridDisplay, "grid");
  assert.equal(dashboardStyles.cardRadius, "8px");
  assert.equal(dashboardStyles.sidebarBrandDisplay, "flex");
  assert.equal(dashboardStyles.looseBrandDisplay, "block");
  assert.equal(dashboardStyles.looseAccountDisplay, "block");

  const darkOperationCards = await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "-10000px";
    host.innerHTML = `
      <article class="ops-status-card ready"><svg></svg><span>Ready</span><strong>1</strong></article>
      <article class="ops-status-card warning"><svg></svg><span>Warning</span><strong>0</strong></article>
    `;
    document.querySelector(".operations-dashboard").append(host);
    const normal = host.querySelector(".ops-status-card.ready");
    const warning = host.querySelector(".ops-status-card.warning");
    const normalIcon = normal.querySelector("svg");
    const warningIcon = warning.querySelector("svg");
    const values = {
      normalBackground: getComputedStyle(normal).backgroundColor,
      normalBackgroundImage: getComputedStyle(normal).backgroundImage,
      warningBackground: getComputedStyle(warning).backgroundColor,
      warningBackgroundImage: getComputedStyle(warning).backgroundImage,
      normalBorder: getComputedStyle(normal).borderTopColor,
      warningBorder: getComputedStyle(warning).borderTopColor,
      normalIconColor: getComputedStyle(normalIcon).color,
      warningIconColor: getComputedStyle(warningIcon).color,
    };
    host.remove();
    document.documentElement.dataset.theme = "light";
    return values;
  });
  assert.notEqual(
    `${darkOperationCards.normalBackground}|${darkOperationCards.normalBackgroundImage}`,
    `${darkOperationCards.warningBackground}|${darkOperationCards.warningBackgroundImage}`,
  );
  assert.notEqual(darkOperationCards.normalBorder, darkOperationCards.warningBorder);
  assert.notEqual(darkOperationCards.normalIconColor, darkOperationCards.warningIconColor);
});

test("run-readiness state treatments remain distinct in light and dark themes", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t);
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  const readinessStateStyles = await page.evaluate(() => {
    const states = ["empty", "blocked", "review", "ready"];
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "-10000px";
    document.querySelector(".operations-dashboard").append(host);
    function collect(theme) {
      document.documentElement.dataset.theme = theme;
      return Object.fromEntries(
        states.map((state) => {
          const panel = document.createElement("section");
          panel.className = `run-readiness-panel run-readiness-${state}`;
          panel.innerHTML = '<div class="run-readiness-icon"></div><div class="run-readiness-copy"><strong>State</strong></div>';
          host.append(panel);
          const style = getComputedStyle(panel);
          const value = {
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderLeftColor: style.borderLeftColor,
          };
          panel.remove();
          return [state, value];
        }),
      );
    }
    const light = collect("light");
    const dark = collect("dark");
    host.remove();
    document.documentElement.dataset.theme = "light";
    return { light, dark };
  });
  for (const theme of ["light", "dark"]) {
    const backgrounds = Object.values(readinessStateStyles[theme]).map((style) => `${style.backgroundColor}|${style.backgroundImage}`);
    const borderColors = Object.values(readinessStateStyles[theme]).map((style) => style.borderLeftColor);
    assert.equal(new Set(backgrounds).size, 4);
    assert.equal(new Set(borderColors).size, 4);
  }
});

test("login brand keeps horizontal mark layout outside the sidebar", { timeout: 40000 }, async (t) => {
  startVite(t);
  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:8021/api/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false, user: null, bootstrapRequired: true }),
    }),
  );
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Create your Inkwell account" }).waitFor();
  const loginBrand = await page.evaluate(() => {
    const brand = document.querySelector(".login-brand");
    const mark = document.querySelector(".login-brand .brand-mark");
    return {
      display: brand ? getComputedStyle(brand).display : "",
      alignItems: brand ? getComputedStyle(brand).alignItems : "",
      markDisplay: mark ? getComputedStyle(mark).display : "",
      markWidth: mark?.getBoundingClientRect().width ?? 0,
      markHeight: mark?.getBoundingClientRect().height ?? 0,
      markRadius: mark ? getComputedStyle(mark).borderRadius : "",
      markBackground: mark ? getComputedStyle(mark).backgroundColor : "",
    };
  });
  assert.equal(loginBrand.display, "flex");
  assert.equal(loginBrand.alignItems, "center");
  assert.equal(loginBrand.markDisplay, "grid");
  assert.equal(loginBrand.markWidth, 42);
  assert.equal(loginBrand.markHeight, 42);
  assert.equal(loginBrand.markRadius, "8px");
  assert.notEqual(loginBrand.markBackground, "rgba(0, 0, 0, 0)");
});

test("editor scoped styles prioritize the composer without leaking globally", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t);
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByLabel("Workspace views").getByRole("button", { name: "New Submission", exact: true }).click();
  await page.getByRole("heading", { name: "Untitled submission" }).waitFor();
  const editorStylesApplied = await page.evaluate(() => {
    const composer = document.querySelector(".composer-workflow-section");
    const details = document.querySelector(".editor-surface .workflow-section:not(.composer-workflow-section)");
    const looseSection = document.createElement("section");
    looseSection.className = "workflow-section";
    looseSection.textContent = "Loose workflow";
    document.body.append(looseSection);
    const values = {
      composerY: composer?.getBoundingClientRect().top ?? 0,
      detailsY: details?.getBoundingClientRect().top ?? 0,
      composerShadow: composer ? getComputedStyle(composer).boxShadow : "",
      looseWorkflowShadow: getComputedStyle(looseSection).boxShadow,
      looseWorkflowBackground: getComputedStyle(looseSection).backgroundColor,
    };
    looseSection.remove();
    return values;
  });
  assert.ok(editorStylesApplied.composerY < editorStylesApplied.detailsY);
  assert.notEqual(editorStylesApplied.composerShadow, "none");
  assert.equal(editorStylesApplied.looseWorkflowShadow, "none");
  assert.equal(editorStylesApplied.looseWorkflowBackground, "rgb(255, 255, 255)");
});

test("template and queue thumbnails load compressed previews without layout overflow", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 1280, height: 900 });
  await routeThumbnailFixture(page);
  await page.goto(appUrl);

  await openWorkspaceView(page, "Templates");
  await page.getByRole("heading", { name: "Saved templates", level: 1 }).waitFor();
  const templateThumb = await page.evaluate(() => {
    const thumb = document.querySelector(".template-library-detailed .template-media-thumb");
    const image = thumb?.querySelector("img");
    const thumbBox = thumb?.getBoundingClientRect();
    const cardBox = thumb?.closest(".template-card")?.getBoundingClientRect();
    return {
      src: image?.getAttribute("src") ?? "",
      complete: Boolean(image?.complete),
      naturalWidth: image?.naturalWidth ?? 0,
      objectFit: image ? getComputedStyle(image).objectFit : "",
      aspectRatio: thumb ? getComputedStyle(thumb).aspectRatio : "",
      overflowsCard: thumbBox && cardBox ? thumbBox.right > cardBox.right || thumbBox.left < cardBox.left : true,
    };
  });
  assert.equal(templateThumb.complete, true);
  assert.ok(templateThumb.naturalWidth > 0);
  assert.equal(templateThumb.objectFit, "cover");
  assert.equal(templateThumb.aspectRatio, "1.78 / 1");
  assert.equal(templateThumb.overflowsCard, false);

  await openWorkspaceView(page, "Queue");
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  const desktopQueueThumbs = await page.evaluate(() => {
    const photoThumb = document.querySelector(".queue-item-thumb");
    const textThumb = document.querySelectorAll(".queue-item-thumb")[1];
    const photoImage = photoThumb?.querySelector("img");
    const textImage = textThumb?.querySelector("img");
    const textBox = textThumb?.getBoundingClientRect();
    const textItemBox = textThumb?.closest(".queue-item")?.getBoundingClientRect();
    return {
      photo: {
        src: photoImage?.getAttribute("src") ?? "",
        complete: Boolean(photoImage?.complete),
        naturalWidth: photoImage?.naturalWidth ?? 0,
        objectFit: photoImage ? getComputedStyle(photoImage).objectFit : "",
        width: Math.round(photoThumb?.getBoundingClientRect().width ?? 0),
        height: Math.round(photoThumb?.getBoundingClientRect().height ?? 0),
      },
      text: {
        hasImage: Boolean(textImage),
        width: Math.round(textBox?.width ?? 0),
        height: Math.round(textBox?.height ?? 0),
        overflowsItem: textBox && textItemBox ? textBox.right > textItemBox.right || textBox.left < textItemBox.left : true,
      },
    };
  });
  assert.equal(desktopQueueThumbs.photo.src, templateThumb.src);
  assert.equal(desktopQueueThumbs.photo.complete, true);
  assert.ok(desktopQueueThumbs.photo.naturalWidth > 0);
  assert.equal(desktopQueueThumbs.photo.objectFit, "cover");
  assert.equal(desktopQueueThumbs.photo.width, 82);
  assert.equal(desktopQueueThumbs.photo.height, 82);
  assert.equal(desktopQueueThumbs.text.hasImage, false);
  assert.equal(desktopQueueThumbs.text.width, 82);
  assert.equal(desktopQueueThumbs.text.height, 82);
  assert.equal(desktopQueueThumbs.text.overflowsItem, false);

  await page.setViewportSize({ width: 390, height: 900 });
  const mobileQueueThumbs = await page.evaluate(() => {
    const thumb = document.querySelector(".queue-item-thumb");
    const fallbackThumb = document.querySelectorAll(".queue-item-thumb")[1];
    const image = thumb?.querySelector("img");
    const thumbBox = thumb?.getBoundingClientRect();
    const fallbackBox = fallbackThumb?.getBoundingClientRect();
    const item = fallbackThumb?.closest(".queue-item");
    const itemBox = item?.getBoundingClientRect();
    return {
      src: image?.getAttribute("src") ?? "",
      complete: Boolean(image?.complete),
      naturalWidth: image?.naturalWidth ?? 0,
      objectFit: image ? getComputedStyle(image).objectFit : "",
      width: Math.round(thumbBox?.width ?? 0),
      height: Math.round(thumbBox?.height ?? 0),
      fallbackWidth: Math.round(fallbackBox?.width ?? 0),
      fallbackHeight: Math.round(fallbackBox?.height ?? 0),
      fallbackOverflowsItem: fallbackBox && itemBox ? fallbackBox.right > itemBox.right || fallbackBox.left < itemBox.left : true,
    };
  });
  assert.equal(mobileQueueThumbs.src, templateThumb.src);
  assert.equal(mobileQueueThumbs.complete, true);
  assert.ok(mobileQueueThumbs.naturalWidth > 0);
  assert.equal(mobileQueueThumbs.objectFit, "cover");
  assert.ok(mobileQueueThumbs.width <= 160);
  assert.equal(mobileQueueThumbs.width, mobileQueueThumbs.height);
  assert.ok(mobileQueueThumbs.fallbackWidth <= 160);
  assert.equal(mobileQueueThumbs.fallbackWidth, mobileQueueThumbs.fallbackHeight);
  assert.equal(mobileQueueThumbs.fallbackOverflowsItem, false);
});

test("runner health summary keeps four metric columns on desktop", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 1280, height: 900 });
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByLabel("Workspace views").getByRole("button", { name: "Runner", exact: true }).click();
  await page.getByLabel("Runner health summary").waitFor();

  const runnerSummary = await page.evaluate(() => {
    const summary = document.querySelector(".runner-mission-summary");
    return {
      columns: summary ? getComputedStyle(summary).gridTemplateColumns.split(" ").length : 0,
      cardCount: summary?.querySelectorAll("article").length ?? 0,
    };
  });
  assert.equal(runnerSummary.columns, 4);
  assert.equal(runnerSummary.cardCount, 4);
});

test("visual domain styles handle mobile layout without overflow or stale sidebar insets", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 390, height: 900 });
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();

  const mobileDashboard = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const sidebar = document.querySelector(".sidebar");
    const actions = document.querySelector(".operations-hero-actions");
    const heroBrand = document.querySelector(".operations-hero-brand");
    return {
      shellColumns: shell ? getComputedStyle(shell).gridTemplateColumns : "",
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      viewportWidth: window.innerWidth,
      actionColumns: actions ? getComputedStyle(actions).gridTemplateColumns.split(" ").length : 0,
      heroBrandColumns: heroBrand ? getComputedStyle(heroBrand).gridTemplateColumns.split(" ").length : 0,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert.equal(mobileDashboard.shellColumns, "390px");
  assert.ok(Math.abs(mobileDashboard.sidebarWidth - mobileDashboard.viewportWidth) <= 1);
  assert.equal(mobileDashboard.actionColumns, 1);
  assert.equal(mobileDashboard.heroBrandColumns, 1);
  assert.ok(mobileDashboard.overflow <= 1);

  await page.getByLabel("Workspace views").getByRole("button", { name: "Content Library", exact: true }).click();
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
  const savedOverlayLeft = await page.evaluate(() => getComputedStyle(document.querySelector(".workspace-saved"), "::before").left);
  assert.equal(savedOverlayLeft, "0px");

  await page.getByLabel("Workspace views").getByRole("button", { name: "Queues", exact: true }).click();
  await page.getByRole("heading", { name: "Queues", exact: true }).waitFor();
  const queueOverlayLeft = await page.evaluate(() => getComputedStyle(document.querySelector(".queue-workspace"), "::before").left);
  assert.equal(queueOverlayLeft, "0px");

  await page.getByLabel("Workspace views").getByRole("button", { name: "New Submission", exact: true }).click();
  await page.getByRole("heading", { name: "Untitled submission" }).waitFor();
  const mobileEditor = await page.evaluate(() => {
    const readiness = document.querySelector(".queue-readiness");
    const actions = document.querySelector(".queue-readiness-actions");
    return {
      readinessColumns: readiness ? getComputedStyle(readiness).gridTemplateColumns.split(" ").length : 0,
      actionsWidth: actions?.getBoundingClientRect().width ?? 0,
      editorWidth: document.querySelector(".editor-surface")?.getBoundingClientRect().width ?? 0,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert.equal(mobileEditor.readinessColumns, 1);
  assert.ok(mobileEditor.actionsWidth <= mobileEditor.editorWidth);
  assert.ok(mobileEditor.overflow <= 1);
});

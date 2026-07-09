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
  const savedStyles = readFileSync("src/components/savedSubmissionsView.css", "utf8");

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
  assert.doesNotMatch(globalStyles, /\.runner-workspace\s+\.runner-hero\s*\{/);
  assert.doesNotMatch(globalStyles, /\.workspace-saved\s+\.draft-card-media::after\s*\{/);
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
  assert.doesNotMatch(operationsStyles, /\.focus-card-art\s*\{/);
  assert.doesNotMatch(operationsStyles, /\.runner-pulse\s*\{/);
  assert.match(operationsStyles, /html\[data-theme="dark"\]\s+\.run-readiness-empty\s*\{/);
  assert.match(operationsStyles, /html\[data-theme="dark"\]\s+\.run-readiness-review\s*\{/);
  assert.match(operationsStyles, /html\[data-theme="dark"\]\s+\.run-readiness-blocked\s*\{/);
  assert.match(runnerStyles, /\.runner-flow-strip\s*\{/);
  assert.match(runnerStyles, /\.runner-workspace\s+\.runner-hero\s*\{/);
  assert.match(runnerStyles, /\.runner-flow-step\.blocked\s*\{/);
  assert.match(runnerStyles, /\.runner-log-empty\s*\{/);
  assert.match(savedStyles, /\.workspace-saved\s+\.draft-card-media::after\s*\{/);
  assert.match(savedStyles, /\.draft-card-preview\s+img\s*\{/);
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
      focusArtCount: document.querySelectorAll(".focus-card-art, .draft-art, .queue-art, .runner-pulse").length,
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
  assert.equal(dashboardStyles.focusArtCount, 0);

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

test("workflow path connector lines do not overlap step labels", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 1280, height: 900 });
  await page.goto(appUrl);
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();

  const workflowPath = await page.evaluate(() => {
    const steps = [...document.querySelectorAll(".workflow-path-step")];
    return steps.slice(0, -1).map((step) => {
      const stepBox = step.getBoundingClientRect();
      const nextBox = step.nextElementSibling?.getBoundingClientRect();
      const titleBox = step.querySelector("strong")?.getBoundingClientRect();
      const detailBox = step.querySelector("small")?.getBoundingClientRect();
      const connector = getComputedStyle(step, "::after");
      const connectorLeft = stepBox.left + Number.parseFloat(connector.left);
      const connectorRight = connectorLeft + Number.parseFloat(connector.width);
      const connectorHeight = Number.parseFloat(connector.height);
      const connectorY = connector.top === "auto"
        ? stepBox.bottom - Number.parseFloat(connector.bottom) - (connectorHeight / 2)
        : stepBox.top + Number.parseFloat(connector.top) + (connectorHeight / 2);
      return {
        connectorLeft,
        connectorRight,
        currentRight: stepBox.right,
        nextLeft: nextBox?.left ?? 0,
        connectorWidth: connector.width,
        overlapsTitle: titleBox ? connectorY >= titleBox.top && connectorY <= titleBox.bottom : true,
        overlapsDetail: detailBox ? connectorY >= detailBox.top && connectorY <= detailBox.bottom : true,
      };
    });
  });

  assert.ok(workflowPath.length > 0);
  for (const step of workflowPath) {
    assert.equal(step.connectorWidth, "12px");
    assert.ok(step.connectorLeft >= step.currentRight - 0.5);
    assert.ok(step.connectorRight <= step.nextLeft + 0.5);
    assert.equal(step.overlapsTitle, false);
    assert.equal(step.overlapsDetail, false);
  }
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

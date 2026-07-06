const operationActions = {
  "Content Library": "Prep content",
  Templates: "Open templates",
  Queue: "Open Queue",
  Queues: "Open Blog tracker",
  Runner: "Runner controls",
  "Tumblr Accounts": "Account health",
  Settings: "Settings",
  "Runner Logs": "View all activity",
  Docs: "Open docs",
};

export async function openWorkspaceView(page, viewName) {
  const directButton = page.getByLabel("Workspace views").getByRole("button", { name: viewName, exact: true });
  try {
    await directButton.first().waitFor({ state: "visible", timeout: 5000 });
  } catch (error) {
    if (error?.name !== "TimeoutError") {
      throw error;
    }
  }
  const directButtonCount = await directButton.count();
  for (let index = 0; index < directButtonCount; index += 1) {
    const candidate = directButton.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }

  const actionName = operationActions[viewName];
  if (!actionName) {
    throw new Error(`No Operations route is configured for ${viewName}.`);
  }

  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByRole("button", { name: actionName, exact: true }).first().click();
}

import { spawnSync } from "node:child_process";

export function stopProcessTree(childProcess) {
  if (!childProcess.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(childProcess.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  childProcess.kill();
}

export function waitForServer(url, timeoutMs = 20000) {
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
        // Vite is still starting.
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

export function createFrontendTestContext(port) {
  const appUrl = `http://127.0.0.1:${port}`;
  const apiHeaders = {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "DELETE,GET,OPTIONS,POST,PUT",
    "Access-Control-Allow-Origin": appUrl,
  };
  const authenticatedSession = {
    authenticated: true,
    bootstrapRequired: false,
    user: {
      id: "user-test",
      email: "myrana@example.test",
      displayName: "Myrana",
      workspace: { id: "workspace-test", name: "Myrana workspace" },
    },
  };

  async function routeAuthenticatedSession(page) {
    await page.route("http://127.0.0.1:8021/api/auth/session", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: apiHeaders,
        body: JSON.stringify(authenticatedSession),
      }),
    );
  }

  async function routeEmptyWorkspaceApis(page) {
    await page.route("http://127.0.0.1:8021/api/tumblr/accounts", (route) =>
      route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ accounts: [] }) }),
    );
    await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
      route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [] }) }),
    );
    await page.route("http://127.0.0.1:8021/api/templates", (route) =>
      route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ templates: [] }) }),
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
    await page.route("http://127.0.0.1:8021/api/settings/app", (route) =>
      route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ settings: route.request().postDataJSON() }) }),
    );
  }

  return {
    apiHeaders,
    appUrl,
    authenticatedSession,
    port,
    routeAuthenticatedSession,
    routeEmptyWorkspaceApis,
  };
}

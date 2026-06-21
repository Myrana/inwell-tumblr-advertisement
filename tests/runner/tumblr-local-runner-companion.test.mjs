import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${pattern}. Output: ${output}`));
    }, 5000);

    const onData = (chunk) => {
      output += String(chunk);
      if (pattern.test(output)) {
        clearTimeout(timeout);
        resolve(output);
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local companion exited early with ${code}. Output: ${output}`));
    });
  });
}

test("local companion grants private network access for deployed app preflight", async () => {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const child = spawn(
    process.execPath,
    [
      "scripts/tumblr-local-runner.mjs",
      "--serve",
      "--companion-port",
      String(port),
      "--api-base",
      "https://inkwell-production-f037.up.railway.app/api",
      "--workspace-id",
      "workspace-test",
      "--queue",
      "Adverts",
      "--token",
      "test-token",
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    await waitForOutput(child, /Companion server listening/);
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://inkwell-production-f037.up.railway.app",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://inkwell-production-f037.up.railway.app");
    assert.equal(response.headers.get("access-control-allow-private-network"), "true");

    const blocked = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.invalid",
        "Access-Control-Request-Private-Network": "true",
      },
      body: JSON.stringify({ queueName: "Adverts" }),
    });

    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), "null");
  } finally {
    child.kill();
  }
});

test("local companion accepts headless dry-run requests", async () => {
  const port = 20000 + Math.floor(Math.random() * 1000);
  const child = spawn(
    process.execPath,
    [
      "scripts/tumblr-local-runner.mjs",
      "--serve",
      "--companion-port",
      String(port),
      "--api-base",
      "https://inkwell-production-f037.up.railway.app/api",
      "--workspace-id",
      "workspace-test",
      "--queue",
      "Adverts",
      "--token",
      "test-token",
      "--submit",
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    await waitForOutput(child, /Companion server listening/);
    const response = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: JSON.stringify({ queueName: "Adverts", headless: true, submit: false }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.accepted, true);
    assert.equal(payload.running, true);
    assert.equal(payload.submit, false);
  } finally {
    child.kill();
  }
});

test("local companion opens Tumblr login helper requests", async () => {
  const port = 21000 + Math.floor(Math.random() * 1000);
  const child = spawn(
    process.execPath,
    [
      "scripts/tumblr-local-runner.mjs",
      "--serve",
      "--companion-port",
      String(port),
      "--api-base",
      "https://inkwell-production-f037.up.railway.app/api",
      "--workspace-id",
      "workspace-test",
      "--queue",
      "Adverts",
      "--token",
      "test-token",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INWELL_LOCAL_LOGIN_SCRIPT: "tests/fixtures/local-login-stub.mjs",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForOutput(child, /Companion server listening/);
    const response = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: JSON.stringify({ accountId: "snowleopardx", userDataDir: ".tumblr-test-profile", slowMo: 25 }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.accepted, true);
    assert.equal(payload.running, false);
    assert.equal(payload.message, "Tumblr login window opened on this computer.");
    assert.equal(typeof payload.pid, "number");
  } finally {
    child.kill();
  }
});

test("local companion reports actionable errors after runner failures", async () => {
  const port = 22000 + Math.floor(Math.random() * 1000);
  const plan = {
    runId: "local-run-failure-test",
    userDataDir: ".tumblr-test-profile",
    items: [
      {
        id: "queue-item-1",
        targetName: "inkwell-test",
        submitUrl: "https://inkwell-test.tumblr.com/submit",
        postType: "photo",
        runnerPayload: "{}",
      },
    ],
  };
  const child = spawn(
    process.execPath,
    [
      "scripts/tumblr-local-runner.mjs",
      "--serve",
      "--companion-port",
      String(port),
      "--api-base",
      "https://inkwell-production-f037.up.railway.app/api",
      "--workspace-id",
      "workspace-test",
      "--queue",
      "Adverts",
      "--token",
      "test-token",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INWELL_LOCAL_PLAN_JSON: JSON.stringify(plan),
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-fail-stub.mjs",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForOutput(child, /Companion server listening/);
    const response = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: JSON.stringify({ queueName: "Adverts", headless: true, submit: false }),
    });

    assert.equal(response.status, 202);
    const started = await response.json();
    assert.equal(started.accepted, true);
    assert.equal(started.lastExitCode, null);
    assert.equal(started.lastError, "");

    let status;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await fetch(`http://127.0.0.1:${port}/status`);
      status = await statusResponse.json();
      if (status.status === "error") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.equal(status.status, "error");
    assert.equal(status.lastExitCode, 9);
    assert.match(status.lastError, /Local runner exited with code 9/);
    assert.match(status.lastError, /Close any open Inkwell Tumblr browser windows/);
  } finally {
    child.kill();
  }
});

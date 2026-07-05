import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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

async function waitForCompanionStatus(port, predicate, label) {
  let status;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const statusResponse = await fetch(`http://127.0.0.1:${port}/status`);
    status = await statusResponse.json();
    if (predicate(status)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}. Last status: ${JSON.stringify(status)}`);
}

function startRunnerApiMock(plans) {
  let planIndex = 0;
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url?.startsWith("/api/runner/local-heartbeat")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/runner/local-plan")) {
      const plan = plans[Math.min(planIndex, plans.length - 1)];
      planIndex += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ plan }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/api`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

function startTransientFailureRunnerApiMock(successPlan) {
  let planRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url?.startsWith("/api/runner/local-heartbeat")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/runner/local-plan")) {
      planRequests += 1;
      if (planRequests === 1) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "temporary plan outage" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ plan: successPlan }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/api`,
        planRequests: () => planRequests,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

test("watched local companion stays online after a transient plan failure", async () => {
  const port = 32000 + Math.floor(Math.random() * 1000);
  const api = await startTransientFailureRunnerApiMock({
    runId: "local-run-recovered-after-plan-failure",
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
  });
  const child = spawn(
    process.execPath,
    [
      "scripts/tumblr-local-runner.mjs",
      "--serve",
      "--watch",
      "--interval-seconds",
      "1",
      "--companion-port",
      String(port),
      "--api-base",
      api.baseUrl,
      "--workspace-id",
      "workspace-test",
      "--queue",
      "Adverts",
      "--token",
      "test-token",
      "--submit",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-args-stub.mjs",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForOutput(child, /Companion server listening/);
    const failedStatus = await waitForCompanionStatus(
      port,
      (candidate) => !candidate.running && candidate.status === "error",
      "transient plan failure status",
    );
    assert.match(failedStatus.lastError, /temporary plan outage/);

    const recoveredStatus = await waitForCompanionStatus(
      port,
      (candidate) => !candidate.running && candidate.status === "watching" && candidate.lastRun?.runId === "local-run-recovered-after-plan-failure",
      "recovered watching status",
    );

    assert.equal(recoveredStatus.lastRun.status, "watching");
    assert.equal(recoveredStatus.lastRun.exitCode, 0);
    assert.equal(child.exitCode, null);
    assert.ok(api.planRequests() >= 2);
  } finally {
    child.kill();
    await api.close();
  }
});

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

test("local companion rejects invalid run JSON without launching", async () => {
  const port = 26000 + Math.floor(Math.random() * 1000);
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
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-args-stub.mjs",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForOutput(child, /Companion server listening/);
    const malformed = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: "{bad-json",
    });

    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /valid JSON/);
    let statusResponse = await fetch(`http://127.0.0.1:${port}/status`);
    let status = await statusResponse.json();
    assert.equal(status.running, false);
    assert.equal(status.status, "idle");
    assert.equal(status.lastStartedAt, "");
    assert.equal(status.lastRun, null);

    const oversized = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: JSON.stringify({ queueName: "Adverts", padding: "x".repeat(1024 * 65) }),
    });

    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /too large/);
    statusResponse = await fetch(`http://127.0.0.1:${port}/status`);
    status = await statusResponse.json();
    assert.equal(status.running, false);
    assert.equal(status.status, "idle");
    assert.equal(status.lastStartedAt, "");
    assert.equal(status.lastRun, null);
  } finally {
    child.kill();
  }
});

test("local companion rejects invalid login JSON without launching helper", async () => {
  const port = 27000 + Math.floor(Math.random() * 1000);
  const loginRecordPath = path.join(os.tmpdir(), `inwell-login-record-${process.pid}-${Date.now()}.txt`);
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
        INWELL_LOCAL_LOGIN_SCRIPT: "tests/fixtures/local-login-record-stub.mjs",
        INWELL_LOCAL_LOGIN_RECORD_PATH: loginRecordPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForOutput(child, /Companion server listening/);
    const malformed = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: "{bad-json",
    });

    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /valid JSON/);

    const oversized = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: JSON.stringify({ accountId: "snowleopardx", padding: "x".repeat(1024 * 65) }),
    });

    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /too large/);
    const launched = await fs.readFile(loginRecordPath, "utf8").then(() => true, () => false);
    assert.equal(launched, false);
  } finally {
    child.kill();
    await fs.unlink(loginRecordPath).catch(() => undefined);
  }
});

test("local companion passes headless mode to the spawned runner", async () => {
  const port = 23000 + Math.floor(Math.random() * 1000);
  const argsPath = path.join(os.tmpdir(), `inwell-runner-args-${process.pid}-${Date.now()}.json`);
  const plan = {
    runId: "local-run-headless-args-test",
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
      "--media-dir",
      "C:\\secret-media",
      "--submit",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INWELL_LOCAL_PLAN_JSON: JSON.stringify(plan),
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-args-stub.mjs",
        INWELL_LOCAL_RUNNER_ARGS_PATH: argsPath,
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

    const status = await waitForCompanionStatus(
      port,
      (candidate) => !candidate.running && candidate.lastRun?.status === "idle",
      "idle companion status",
    );

    assert.equal(status.lastRun.headless, true);
    assert.equal(status.lastRun.submit, false);
    assert.equal(status.lastRun.exitCode, 0);
    assert.equal(status.lastRun.exitSignal, "");
    assert.equal("runnerArgs" in status.lastRun, false);
    assert.equal("userDataDir" in status.lastRun, false);
    const serializedStatus = JSON.stringify(status);
    assert.equal(serializedStatus.includes("test-token"), false);
    assert.equal(serializedStatus.includes(".tumblr-test-profile"), false);
    assert.equal(serializedStatus.includes("C:\\secret-media"), false);
    assert.equal(serializedStatus.includes("--api-token"), false);
    assert.equal(serializedStatus.includes("--headless"), false);
    const args = JSON.parse(await fs.readFile(argsPath, "utf8"));
    assert.ok(args.includes("--headless"));
    assert.ok(args.includes("--no-review-pause"));
    assert.equal(args.includes("--submit"), false);
  } finally {
    child.kill();
    await fs.unlink(argsPath).catch(() => undefined);
  }
});

test("local companion clears prior run details before fetching a new plan", async () => {
  const port = 24000 + Math.floor(Math.random() * 1000);
  const api = await startRunnerApiMock([
    {
      runId: "local-run-with-items",
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
    },
    {
      runId: "local-run-empty-plan",
      userDataDir: ".tumblr-test-profile",
      items: [],
    },
  ]);
  const child = spawn(
    process.execPath,
    [
      "scripts/tumblr-local-runner.mjs",
      "--serve",
      "--companion-port",
      String(port),
      "--api-base",
      api.baseUrl,
      "--workspace-id",
      "workspace-test",
      "--queue",
      "Adverts",
      "--token",
      "test-token",
      "--submit",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-args-stub.mjs",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForOutput(child, /Companion server listening/);
    const firstResponse = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: JSON.stringify({ queueName: "Adverts", headless: true, submit: false }),
    });

    assert.equal(firstResponse.status, 202);

    const status = await waitForCompanionStatus(
      port,
      (candidate) => !candidate.running && candidate.lastRun?.status === "idle",
      "first idle companion status",
    );

    assert.equal(status.lastRun.headless, true);
    assert.equal(status.lastRun.runId, "local-run-with-items");
    assert.equal("runnerArgs" in status.lastRun, false);
    assert.equal("userDataDir" in status.lastRun, false);

    const secondResponse = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:8123",
      },
      body: JSON.stringify({ queueName: "Adverts", headless: false, submit: true }),
    });

    assert.equal(secondResponse.status, 202);
    const secondStarted = await secondResponse.json();
    assert.equal(secondStarted.lastRun.headless, false);
    assert.equal(secondStarted.lastRun.submit, true);
    assert.equal(secondStarted.lastRun.itemCount, 0);
    assert.equal(secondStarted.lastRun.runId, "");
    assert.equal("runnerArgs" in secondStarted.lastRun, false);
    assert.equal("userDataDir" in secondStarted.lastRun, false);
  } finally {
    child.kill();
    await api.close();
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

    const status = await waitForCompanionStatus(
      port,
      (candidate) => candidate.status === "error",
      "error companion status",
    );

    assert.equal(status.status, "error");
    assert.equal(status.lastExitCode, 9);
    assert.equal(status.lastBlockerCode, "headless_runner_failed");
    assert.match(status.lastError, /Local runner exited with code 9/);
    assert.match(status.lastError, /Headless mode cannot show Tumblr login, captcha, or manual review prompts/);
    assert.equal(status.lastRun.headless, true);
    assert.equal(status.lastRun.blockerCode, "headless_runner_failed");
    assert.equal(status.lastRun.status, "error");
  } finally {
    child.kill();
  }
});

test("local companion reports signal-terminated runner as an error", async () => {
  const port = 25000 + Math.floor(Math.random() * 1000);
  const plan = {
    runId: "local-run-signal-test",
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
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-signal-stub.mjs",
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
    const status = await waitForCompanionStatus(
      port,
      (candidate) => candidate.status === "error",
      "signal error companion status",
    );

    assert.equal(status.lastExitCode, 1);
    const expectedSignal = process.platform === "win32" ? "" : "SIGTERM";
    assert.equal(status.lastExitSignal, expectedSignal);
    assert.equal(status.lastBlockerCode, "headless_runner_failed");
    assert.equal(status.lastRun.status, "error");
    assert.equal(status.lastRun.exitCode, 1);
    assert.equal(status.lastRun.exitSignal, status.lastExitSignal);
    assert.equal(status.lastRun.blockerCode, "headless_runner_failed");
    assert.match(status.lastError, /Local runner exited with code 1/);
    if (expectedSignal) {
      assert.match(status.lastError, new RegExp(`signal ${expectedSignal}`));
    } else {
      assert.doesNotMatch(status.lastError, /signal/);
    }
  } finally {
    child.kill();
  }
});

test("local companion reports normal exit code one without signal context", async () => {
  const port = 28000 + Math.floor(Math.random() * 1000);
  const plan = {
    runId: "local-run-exit-one-test",
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
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-exit-one-stub.mjs",
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
    const status = await waitForCompanionStatus(
      port,
      (candidate) => candidate.status === "error",
      "normal code one error companion status",
    );

    assert.equal(status.lastExitCode, 1);
    assert.equal(status.lastExitSignal, "");
    assert.equal(status.lastBlockerCode, "headless_runner_failed");
    assert.equal(status.lastRun.status, "error");
    assert.equal(status.lastRun.exitCode, 1);
    assert.equal(status.lastRun.exitSignal, "");
    assert.equal(status.lastRun.blockerCode, "headless_runner_failed");
    assert.match(status.lastError, /Local runner exited with code 1/);
    assert.doesNotMatch(status.lastError, /signal/);
  } finally {
    child.kill();
  }
});

test("local companion preserves structured headless blocker codes from runner output", async () => {
  const port = 29000 + Math.floor(Math.random() * 1000);
  const plan = {
    runId: "local-run-headless-code-test",
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
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-headless-code-stub.mjs",
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
    const status = await waitForCompanionStatus(
      port,
      (candidate) => candidate.status === "error",
      "structured headless blocker status",
    );

    assert.equal(status.lastBlockerCode, "headless_login_required");
    assert.equal(status.lastRun.blockerCode, "headless_login_required");
    assert.equal(status.lastRun.status, "error");
  } finally {
    child.kill();
  }
});

test("local companion ignores headless-looking stderr without a structured result", async () => {
  const port = 30000 + Math.floor(Math.random() * 1000);
  const plan = {
    runId: "local-run-stderr-code-test",
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
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-stderr-code-stub.mjs",
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
    const status = await waitForCompanionStatus(
      port,
      (candidate) => candidate.status === "error",
      "stderr-only headless failure status",
    );

    assert.equal(status.lastBlockerCode, "headless_runner_failed");
    assert.equal(status.lastRun.blockerCode, "headless_runner_failed");
  } finally {
    child.kill();
  }
});

test("local companion reports post-fill headless manual review blockers", async () => {
  const port = 31000 + Math.floor(Math.random() * 1000);
  const plan = {
    runId: "local-run-postfill-blocker-test",
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
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-postfill-blocker-stub.mjs",
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
    const status = await waitForCompanionStatus(
      port,
      (candidate) => candidate.status === "error",
      "post-fill headless blocker status",
    );

    assert.equal(status.lastBlockerCode, "headless_manual_review_required");
    assert.equal(status.lastRun.blockerCode, "headless_manual_review_required");
    assert.equal(status.lastRun.status, "error");
  } finally {
    child.kill();
  }
});

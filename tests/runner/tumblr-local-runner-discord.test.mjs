import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";
import { discordDeliveryFailureSummary } from "../../scripts/discord-run-summary.mjs";

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}. Output: ${output}`)), 5000);
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

function queueItem(id, targetName) {
  return {
    id,
    targetName,
    submitUrl: `https://${targetName}.tumblr.com/submit`,
    postType: "photo",
    runnerPayload: "{}",
  };
}

function discordPlan(runId, targetNames) {
  return {
    runId,
    userDataDir: ".tumblr-test-profile",
    items: targetNames.map((targetName, index) => queueItem(`queue-item-${index + 1}`, targetName)),
  };
}

function runnerResult(targetResults) {
  return { status: "success", blockerCode: "", failureKind: "", message: "", targetResults };
}

function startDiscordWebhookMock(statusCode = 204) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, body });
      response.writeHead(statusCode, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: statusCode < 400 }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/api/webhooks/test`,
        requests,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

function startRunnerApiMock(plan, discordWebhookUrl = "") {
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url?.startsWith("/api/runner/local-heartbeat")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/runner/local-plan")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ plan, discordWebhookUrl }));
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

const discordFailureHookUrl = new URL("../fixtures/discord-fetch-failure-hook.mjs", import.meta.url).href;

async function runCompanionDiscordScenario(t, { plan, webhookUrl, planWebhookUrl = "", result, exitCode = 0, submit = true, skipResultWrite = false, malformedResult = false, forceDiscordFetchFailure = false }) {
  const port = 33000 + Math.floor(Math.random() * 1000);
  let output = "";
  const api = planWebhookUrl ? await startRunnerApiMock(plan, planWebhookUrl) : null;
  const planItems = Array.isArray(plan?.items) ? plan.items : [];
  if (api) {
    t.after(async () => api.close());
  }
  const child = spawn(
    process.execPath,
    [
      "scripts/tumblr-local-runner.mjs",
      "--serve",
      "--companion-port",
      String(port),
      "--api-base",
      api?.baseUrl || "https://inkwell-production-f037.up.railway.app/api",
      "--workspace-id",
      "workspace-test",
      "--queue",
      "Default queue",
      "--token",
      "test-token",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INWELL_DISCORD_WEBHOOK_URL: webhookUrl || "",
        INWELL_DISCORD_WEBHOOK_ALLOW_LOCAL: "1",
        INWELL_LOCAL_PLAN_JSON: api ? "" : JSON.stringify(plan),
        INWELL_LOCAL_PLAN_DISCORD_WEBHOOK_URL: planWebhookUrl,
        INWELL_LOCAL_RUNNER_SCRIPT: "tests/fixtures/local-runner-result-stub.mjs",
        INWELL_LOCAL_RUNNER_RESULT_JSON: JSON.stringify(result ?? runnerResult(planItems.map((item) => ({ id: item.id, targetName: item.targetName, status: "completed" })))),
        INWELL_LOCAL_RUNNER_SKIP_RESULT_WRITE: skipResultWrite ? "1" : "",
        INWELL_LOCAL_RUNNER_MALFORMED_RESULT: malformedResult ? "1" : "",
        INWELL_LOCAL_RUNNER_EXIT_CODE: String(exitCode),
        NODE_OPTIONS: forceDiscordFetchFailure
          ? `${process.env.NODE_OPTIONS || ""} --import=${discordFailureHookUrl}`.trim()
          : process.env.NODE_OPTIONS || "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  t.after(() => child.kill());

  await waitForOutput(child, /Companion server listening/);
  const response = await fetch(`http://127.0.0.1:${port}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:8123" },
    body: JSON.stringify({ queueName: "Default queue", headless: true, submit }),
  });

  assert.equal(response.status, 202);
  const status = await waitForCompanionStatus(
    port,
    (candidate) => !candidate.running && (candidate.lastRun?.status === "idle" || candidate.lastRun?.status === "error"),
    "finished companion status after Discord summary",
  );
  return { status, output: () => output };
}

function discordPayload(webhook) {
  assert.equal(webhook.requests.length, 1);
  return JSON.parse(webhook.requests[0].body);
}

test("local companion sends Discord run summary with queue and targets", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const plan = discordPlan("local-run-discord-summary-test", ["allthingsroleplay", "rpadverts"]);

  const { status } = await runCompanionDiscordScenario(t, { plan, webhookUrl: webhook.url });
  assert.equal(status.lastDiscordSummary.status, "sent");
  assert.equal(status.lastDiscordSummary.reason, "sent");
  assert.equal(status.lastRun.discordSummary.status, "sent");
  const payload = discordPayload(webhook);
  assert.match(payload.content, /Tumblr queue run completed/);
  assert.match(payload.content, /Queue: Default queue/);
  assert.match(payload.content, /Targets attempted: 2/);
  assert.match(payload.content, /Targets hit: 2/);
  assert.match(payload.content, /Mode: Live posting/);
  assert.match(payload.content, /allthingsroleplay \(completed\), rpadverts \(completed\)/);
  assert.equal(payload.content.includes("test-token"), false);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test("local companion uses Discord webhook returned by authenticated runner plan", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const plan = discordPlan("local-run-discord-plan-webhook-test", ["allthingsroleplay"]);

  await runCompanionDiscordScenario(t, { plan, planWebhookUrl: webhook.url });
  const payload = discordPayload(webhook);
  assert.match(payload.content, /Queue: Default queue/);
  assert.match(payload.content, /Targets attempted: 1/);
  assert.match(payload.content, /Targets hit: 1/);
  assert.match(payload.content, /allthingsroleplay \(completed\)/);
});

test("local companion reports mixed Discord target outcomes without counting failures as hits", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const plan = discordPlan("local-run-discord-mixed-outcome-test", ["allthingsroleplay", "rpadverts", "rpneedsreview"]);

  await runCompanionDiscordScenario(t, {
    plan,
    webhookUrl: webhook.url,
    result: runnerResult([
      { id: "queue-item-1", targetName: "allthingsroleplay", status: "submitted" },
      { id: "queue-item-2", targetName: "rpadverts", status: "failed" },
      { id: "queue-item-3", targetName: "rpneedsreview", status: "needs-review" },
    ]),
  });

  const payload = discordPayload(webhook);
  assert.match(payload.content, /Tumblr queue run needs attention/);
  assert.doesNotMatch(payload.content, /Tumblr queue run completed/);
  assert.match(payload.content, /Targets attempted: 3/);
  assert.match(payload.content, /Targets hit: 1/);
  assert.match(payload.content, /Needs review: 1/);
  assert.match(payload.content, /Failed: 1/);
  assert.match(payload.content, /Unknown: 0/);
  assert.match(payload.content, /allthingsroleplay \(submitted\), rpadverts \(failed\), rpneedsreview \(needs-review\)/);
});

test("local companion does not fail a run when Discord summary delivery fails", async (t) => {
  const webhook = await startDiscordWebhookMock(500);
  t.after(async () => webhook.close());
  const { status } = await runCompanionDiscordScenario(t, {
    plan: discordPlan("local-run-discord-failure-test", ["allthingsroleplay"]),
    webhookUrl: webhook.url,
  });

  assert.equal(status.lastExitCode, 0);
  assert.equal(status.lastError, "");
  assert.equal(status.lastDiscordSummary.status, "failed");
  assert.equal(status.lastDiscordSummary.reason, "delivery-failed");
  assert.equal(status.lastDiscordSummary.message, "Discord summary failed. Check the local runner log for details.");
  assert.doesNotMatch(status.lastDiscordSummary.message, /api\/webhooks/);
  assert.equal(webhook.requests.length, 1);
});

test("local companion does not send Discord summary for prep runs", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const { status } = await runCompanionDiscordScenario(t, {
    plan: discordPlan("local-run-discord-prep-skip-test", ["allthingsroleplay"]),
    webhookUrl: webhook.url,
    submit: false,
  });

  assert.equal(status.lastExitCode, 0);
  assert.equal(status.lastError, "");
  assert.equal(status.lastDiscordSummary.status, "skipped");
  assert.equal(status.lastDiscordSummary.reason, "not-live-run");
  assert.equal(webhook.requests.length, 0);
});

test("local companion records empty-plan Discord skip for live runs", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const { status } = await runCompanionDiscordScenario(t, {
    plan: discordPlan("local-run-discord-empty-plan-test", []),
    webhookUrl: webhook.url,
  });

  assert.equal(status.lastExitCode, 0);
  assert.equal(status.lastError, "");
  assert.equal(status.lastRun.runId, "local-run-discord-empty-plan-test");
  assert.equal(status.lastRun.itemCount, 0);
  assert.equal(status.lastRun.status, "idle");
  assert.equal(status.lastDiscordSummary.status, "skipped");
  assert.equal(status.lastDiscordSummary.reason, "empty-plan");
  assert.equal(status.lastRun.discordSummary.status, "skipped");
  assert.equal(status.lastRun.discordSummary.reason, "empty-plan");
  assert.equal(webhook.requests.length, 0);
});

test("local companion records malformed empty plans without losing Discord diagnostics", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const { status } = await runCompanionDiscordScenario(t, {
    plan: null,
    webhookUrl: webhook.url,
  });

  assert.equal(status.lastExitCode, 0);
  assert.equal(status.lastError, "");
  assert.equal(status.lastRun.runId, "");
  assert.equal(status.lastRun.itemCount, 0);
  assert.equal(status.lastRun.status, "idle");
  assert.equal(status.lastDiscordSummary.status, "skipped");
  assert.equal(status.lastDiscordSummary.reason, "empty-plan");
  assert.equal(status.lastRun.discordSummary.reason, "empty-plan");
  assert.equal(webhook.requests.length, 0);
});

test("Discord delivery failure summary does not expose webhook secrets", () => {
  const webhookUrl = "https://discord.com/api/webhooks/123456/private-token-value";
  const summary = discordDeliveryFailureSummary(new Error(`request failed for ${webhookUrl}`));

  assert.equal(summary.status, "failed");
  assert.equal(summary.reason, "delivery-failed");
  assert.equal(summary.message, "Discord summary failed. Check the local runner log for details.");
  assert.equal(summary.message.includes("private-token-value"), false);
  assert.equal(summary.logMessage.includes("private-token-value"), false);
  assert.equal(summary.logMessage.includes("/api/webhooks/123456"), false);
  assert.match(summary.logMessage, /\[discord-webhook-url\]/);
});

test("local companion failure status does not expose Discord webhook secrets", async (t) => {
  const webhookUrl = "https://discord.com/api/webhooks/123456/private-token-value";
  const { status, output } = await runCompanionDiscordScenario(t, {
    plan: discordPlan("local-run-discord-secret-failure-test", ["allthingsroleplay"]),
    webhookUrl,
    forceDiscordFetchFailure: true,
  });

  assert.equal(status.lastExitCode, 0);
  assert.equal(status.lastError, "");
  assert.equal(status.lastDiscordSummary.status, "failed");
  assert.equal(status.lastDiscordSummary.reason, "delivery-failed");
  assert.equal(status.lastDiscordSummary.message, "Discord summary failed. Check the local runner log for details.");
  assert.equal(status.lastRun.discordSummary.message, "Discord summary failed. Check the local runner log for details.");
  assert.equal(JSON.stringify(status).includes("private-token-value"), false);
  assert.equal(JSON.stringify(status).includes("/api/webhooks/123456"), false);
  assert.equal(output().includes("private-token-value"), false);
  assert.equal(output().includes("/api/webhooks/123456"), false);
});

test("local companion reports invalid Discord webhook configuration without failing run", async (t) => {
  const { status, output } = await runCompanionDiscordScenario(t, {
    plan: discordPlan("local-run-discord-invalid-url-test", ["allthingsroleplay"]),
    webhookUrl: "https://example.com/not-discord",
  });

  assert.equal(status.lastExitCode, 0);
  assert.equal(status.lastError, "");
  assert.equal(status.lastDiscordSummary.status, "skipped");
  assert.equal(status.lastDiscordSummary.reason, "invalid-url");
  assert.match(output(), /Discord webhook is configured but is not a valid Discord webhook URL/);
  assert.doesNotMatch(output(), /example\.com\/not-discord/);
});

test("local companion reports unknown Discord target statuses without counting them as hits", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const plan = discordPlan("local-run-discord-unknown-status-test", ["allthingsroleplay", "rpadverts"]);

  await runCompanionDiscordScenario(t, {
    plan,
    webhookUrl: webhook.url,
    result: runnerResult([
      { id: "queue-item-1", targetName: "allthingsroleplay", status: "submitted" },
      { id: "queue-item-2", targetName: "rpadverts", status: "surprise-status" },
    ]),
  });

  const payload = discordPayload(webhook);
  assert.match(payload.content, /Tumblr queue run needs attention/);
  assert.match(payload.content, /Targets hit: 1/);
  assert.match(payload.content, /Unknown: 1/);
  assert.match(payload.content, /rpadverts \(unknown\)/);
});

test("local companion treats missing runner result output as unknown in Discord summary", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const { status } = await runCompanionDiscordScenario(t, {
    plan: discordPlan("local-run-discord-missing-result-test", ["allthingsroleplay", "rpadverts"]),
    webhookUrl: webhook.url,
    skipResultWrite: true,
  });

  assert.equal(status.lastExitCode, 0);
  assert.equal(status.lastError, "");
  const payload = discordPayload(webhook);
  assert.match(payload.content, /Tumblr queue run needs attention/);
  assert.match(payload.content, /Targets hit: 0/);
  assert.match(payload.content, /Unknown: 2/);
  assert.match(payload.content, /allthingsroleplay \(unknown\), rpadverts \(unknown\)/);
});

test("local companion treats malformed runner result output as unknown in Discord summary", async (t) => {
  const webhook = await startDiscordWebhookMock();
  t.after(async () => webhook.close());
  const { status, output } = await runCompanionDiscordScenario(t, {
    plan: discordPlan("local-run-discord-malformed-result-test", ["allthingsroleplay", "rpadverts"]),
    webhookUrl: webhook.url,
    malformedResult: true,
  });

  assert.equal(status.lastExitCode, 0);
  assert.equal(status.lastError, "");
  assert.match(output(), /Runner result file could not be parsed/);
  const payload = discordPayload(webhook);
  assert.match(payload.content, /Tumblr queue run needs attention/);
  assert.match(payload.content, /Targets hit: 0/);
  assert.match(payload.content, /Unknown: 2/);
  assert.equal(payload.content.includes("test-token"), false);
  assert.match(payload.content, /allthingsroleplay \(unknown\), rpadverts \(unknown\)/);
});

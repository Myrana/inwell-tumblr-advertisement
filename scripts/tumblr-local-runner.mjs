#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { discordDeliveryFailureSummary, postDiscordRunSummary } from "./discord-run-summary.mjs";
import { headlessBlockerCodes } from "./tumblr-runner-core.mjs";

const LOCAL_COMPANION_VERSION = "local-runner-3";

function companionAllowedOrigins(options) {
  const origins = new Set([
    "http://127.0.0.1:8020",
    "http://localhost:8020",
    "http://127.0.0.1:8123",
    "http://localhost:8123",
  ]);
  try {
    origins.add(new URL(options.apiBaseUrl).origin);
  } catch {
    // Keep the explicit local origins when apiBaseUrl is not parseable.
  }
  for (const origin of String(process.env.INWELL_LOCAL_COMPANION_ALLOWED_ORIGINS || "").split(",")) {
    const trimmed = origin.trim().replace(/\/$/, "");
    if (trimmed) {
      origins.add(trimmed);
    }
  }
  return origins;
}

function requestOrigin(request) {
  return String(request.headers.origin || "").trim().replace(/\/$/, "");
}

function isTrustedCompanionOrigin(origin, allowedOrigins) {
  if (!origin) {
    return true;
  }
  return allowedOrigins.has(origin);
}

function parseLocalArgs(argv) {
  const options = {
    apiBaseUrl: "",
    token: process.env.INWELL_LOCAL_RUNNER_TOKEN || "",
    workspaceId: "",
    queueName: "Default queue",
    userDataDir: ".tumblr-runner-profile-local",
    mediaDir: "",
    slowMo: "500",
    headless: false,
    submit: false,
    watch: false,
    noPause: false,
    serve: false,
    companionPort: 17842,
    intervalSeconds: 15,
    limit: "",
    discordWebhookUrl: process.env.INWELL_DISCORD_WEBHOOK_URL || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-base") {
      options.apiBaseUrl = String(argv[++index] ?? "").replace(/\/$/, "");
    } else if (arg === "--token") {
      options.token = String(argv[++index] ?? "");
    } else if (arg === "--workspace-id") {
      options.workspaceId = String(argv[++index] ?? "");
    } else if (arg === "--queue") {
      options.queueName = String(argv[++index] ?? "") || "Default queue";
    } else if (arg === "--user-data-dir") {
      options.userDataDir = String(argv[++index] ?? "");
    } else if (arg === "--media-dir") {
      options.mediaDir = String(argv[++index] ?? "");
    } else if (arg === "--slow-mo") {
      options.slowMo = String(argv[++index] ?? "500");
    } else if (arg === "--limit") {
      options.limit = String(argv[++index] ?? "");
    } else if (arg === "--headless") {
      options.headless = true;
    } else if (arg === "--submit") {
      options.submit = true;
    } else if (arg === "--watch") {
      options.watch = true;
    } else if (arg === "--no-pause") {
      options.noPause = true;
    } else if (arg === "--serve") {
      options.serve = true;
    } else if (arg === "--companion-port") {
      options.companionPort = Math.max(1, Number(argv[++index] ?? "17842") || 17842);
    } else if (arg === "--interval-seconds") {
      options.intervalSeconds = Math.max(1, Number(argv[++index] ?? "15") || 15);
    } else {
      throw new Error(`Unknown local runner argument: ${arg}`);
    }
  }

  if (!options.apiBaseUrl) {
    throw new Error("Missing --api-base, for example https://your-railway-app.up.railway.app/api");
  }
  if (!options.token) {
    throw new Error("Missing INWELL_LOCAL_RUNNER_TOKEN or --token");
  }
  if (!options.workspaceId) {
    throw new Error("Missing --workspace-id");
  }

  return options;
}

async function fetchRunnerPlan(options) {
  if (process.env.INWELL_LOCAL_PLAN_JSON) {
    return {
      plan: JSON.parse(process.env.INWELL_LOCAL_PLAN_JSON),
      discordWebhookUrl: process.env.INWELL_LOCAL_PLAN_DISCORD_WEBHOOK_URL || "",
    };
  }

  await postHeartbeat(options, "polling").catch(() => undefined);
  const url = new URL(`${options.apiBaseUrl}/runner/local-plan`);
  url.searchParams.set("workspaceId", options.workspaceId);
  url.searchParams.set("queueName", options.queueName);
  if (options.limit) {
    url.searchParams.set("limit", options.limit);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${options.token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Could not fetch local runner plan: ${response.status}`);
  }

  const { plan, discordWebhookUrl = "" } = await response.json();
  return { plan, discordWebhookUrl };
}

async function runPlan(options, plan) {
  stateLastRunStarted(options, plan);
  if (!plan?.items?.length) {
    console.log(`[local-runner] No runnable items in ${options.queueName}.`);
    await postHeartbeat(options, options.watch ? "watching" : "idle").catch(() => undefined);
    const discordSummary = await recordDiscordRunSummary(options, plan, { exitCode: 0, signal: "", runnerResult: null });
    return { exitCode: 0, signal: "", discordSummary };
  }

  await postHeartbeat(options, "running").catch(() => undefined);
  const userDataDir = String(plan.userDataDir || options.userDataDir || "").trim() || options.userDataDir;
  const planPath = path.join(os.tmpdir(), `inwell-local-runner-${plan.runId}.json`);
  const resultPath = path.join(os.tmpdir(), `inwell-local-runner-${plan.runId}-result.json`);
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  console.log(`[local-runner] Running ${plan.items.length} item(s) from ${options.queueName}.`);

  const runnerArgs = [
    localRunnerScriptPath(),
    "--plan",
    planPath,
    "--login-first",
    "--slow-mo",
    options.slowMo,
    "--api-base",
    options.apiBaseUrl,
    "--api-token",
    options.token,
    "--run-id",
    plan.runId,
    "--workspace-id",
    options.workspaceId,
    "--result-path",
    resultPath,
    "--user-data-dir",
    userDataDir,
    "--no-review-pause",
  ];
  if (options.mediaDir) {
    runnerArgs.push("--media-dir", options.mediaDir);
  }
  if (options.submit) {
    runnerArgs.push("--submit");
  }
  if (options.headless) {
    runnerArgs.push("--headless");
  }
  if (options.noPause) {
    runnerArgs.push("--no-pause");
  }

  const child = spawn(process.execPath, runnerArgs, { stdio: ["ignore", "inherit", "pipe"] });
  let stderrTail = "";
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    process.stderr.write(text);
    stderrTail = `${stderrTail}${text}`.slice(-4096);
  });
  const processResult = await new Promise((resolve) => {
    child.on("close", (code, signal) => {
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        signal: signal || "",
        stderr: stderrTail,
      });
    });
  });
  const runnerResult = await readRunnerResult(resultPath);
  await fs.unlink(resultPath).catch(() => undefined);
  const result = { ...processResult, runnerResult };
  await postHeartbeat(options, result.exitCode ? "error" : options.watch ? "watching" : "idle").catch(() => undefined);
  const discordSummary = await recordDiscordRunSummary(options, plan, result);
  return { ...result, discordSummary };
}

async function recordDiscordRunSummary(options, plan, result) {
  let summary;
  try {
    const delivery = await postDiscordRunSummary(options, plan, result, { log: console.log });
    summary = {
      status: delivery.sent ? "sent" : "skipped",
      reason: delivery.reason || (delivery.sent ? "sent" : "skipped"),
      message: discordSummaryMessage(delivery),
    };
  } catch (error) {
    const failureSummary = discordDeliveryFailureSummary(error);
    console.log(`[local-runner] Could not send Discord summary: ${failureSummary.logMessage}`);
    summary = {
      status: failureSummary.status,
      reason: failureSummary.reason,
      message: failureSummary.message,
    };
  }
  stateLastDiscordSummary(options, summary);
  return summary;
}

function discordSummaryMessage(delivery) {
  if (delivery.sent) {
    return "Discord summary sent.";
  }
  const messages = {
    "not-live-run": "Discord summary skipped because this was a test run.",
    "empty-plan": "Discord summary skipped because there were no runnable items.",
    "not-configured": "Discord summary skipped because no webhook is configured for this runner.",
    "invalid-url": "Discord summary skipped because the configured webhook URL is not a Discord webhook.",
  };
  return messages[delivery.reason] || "Discord summary skipped.";
}

async function readRunnerResult(resultPath) {
  const raw = await fs.readFile(resultPath, "utf8").catch(() => "");
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    console.log("[local-runner] Runner result file could not be parsed; Discord summary will treat target results as unknown.");
    return null;
  }
}

function stateLastRunStarted(options, plan) {
  if (!options.state) {
    return;
  }
  options.state.lastRun = {
    queueName: options.queueName,
    headless: Boolean(options.headless),
    submit: Boolean(options.submit),
    itemCount: Array.isArray(plan?.items) ? plan.items.length : 0,
    runId: String(plan?.runId || ""),
    startedAt: new Date().toISOString(),
    finishedAt: "",
    exitCode: null,
    exitSignal: "",
    blockerCode: "",
    status: "running",
    discordSummary: null,
  };
}

function stateLastDiscordSummary(options, summary) {
  if (!options.state) {
    return;
  }
  options.state.lastDiscordSummary = summary;
  if (options.state.lastRun) {
    options.state.lastRun.discordSummary = summary;
  }
}

function localRunnerScriptPath() {
  return process.env.INWELL_LOCAL_RUNNER_SCRIPT || path.join(process.cwd(), "scripts", "tumblr-runner.mjs");
}

async function executeLocalRun(options, state) {
  if (state.running) {
    return { accepted: false, running: true };
  }

  state.running = true;
  state.status = "running";
  state.lastError = "";
  state.lastStartedAt = new Date().toISOString();
  state.lastFinishedAt = "";
  state.lastExitCode = null;
  state.lastExitSignal = "";
  state.lastBlockerCode = "";
  state.lastDiscordSummary = null;
  state.lastRun = initialLastRun(options, state.lastStartedAt);
  try {
    const { plan, discordWebhookUrl } = await fetchRunnerPlan(options);
    const result = await runPlan({ ...options, state, discordWebhookUrl: options.discordWebhookUrl || discordWebhookUrl || "" }, plan);
    const code = result.exitCode;
    state.lastExitCode = code;
    state.lastExitSignal = result.signal || "";
    state.lastFinishedAt = new Date().toISOString();
    state.lastError = code
      ? localRunnerExitMessage(code, options, state.lastExitSignal)
      : "";
    state.lastBlockerCode = code ? localRunnerBlockerCode(result.runnerResult, options) : "";
    if (state.lastRun) {
      state.lastRun.finishedAt = state.lastFinishedAt;
      state.lastRun.exitCode = code;
      state.lastRun.exitSignal = state.lastExitSignal;
      state.lastRun.blockerCode = state.lastBlockerCode;
      state.lastRun.status = code ? "error" : options.watch ? "watching" : "idle";
    }
    state.status = code ? "error" : options.watch ? "watching" : "idle";
    return { accepted: true, running: false, exitCode: code };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    state.lastBlockerCode = localRunnerBlockerCode({ message }, options);
    state.lastFinishedAt = new Date().toISOString();
    state.status = "error";
    if (state.lastRun) {
      state.lastRun.finishedAt = state.lastFinishedAt;
      state.lastRun.exitCode = 1;
      state.lastRun.exitSignal = "";
      state.lastRun.blockerCode = state.lastBlockerCode;
      state.lastRun.status = "error";
    }
    await postHeartbeat(options, "error").catch(() => undefined);
    throw error;
  } finally {
    state.running = false;
  }
}

function initialLastRun(options, startedAt) {
  return {
    queueName: options.queueName,
    headless: Boolean(options.headless),
    submit: Boolean(options.submit),
    itemCount: 0,
    runId: "",
    startedAt,
    finishedAt: "",
    exitCode: null,
    exitSignal: "",
    blockerCode: "",
    status: "planning",
    discordSummary: null,
  };
}

function localRunnerBlockerCode(result, options) {
  if (!options.headless) {
    return "";
  }
  if (result && typeof result.blockerCode === "string" && result.blockerCode) {
    return result.blockerCode;
  }
  if (result && typeof result.message === "string" && /Executable doesn't exist|browser.*install|playwright/i.test(result.message)) {
    return "headless_browser_unavailable";
  }
  return headlessBlockerCodes.runnerFailed;
}

function localRunnerExitMessage(code, options, signal = "") {
  const signalHint = signal ? ` after signal ${signal}` : "";
  const base = `Local runner exited with code ${code}${signalHint}.`;
  const modeHint = options.headless
    ? " Headless mode cannot show Tumblr login, captcha, or manual review prompts. Open the login window or rerun with Run headless off, then try again."
    : " Close any open Inkwell Tumblr browser windows, then try again.";
  return `${base}${modeHint} Check the runner log for details.`;
}

function companionStatus(options, state) {
  return {
    ok: true,
    version: LOCAL_COMPANION_VERSION,
    apiBaseUrl: options.apiBaseUrl,
    workspaceId: options.workspaceId,
    queueName: options.queueName,
    submit: options.submit,
    watching: options.watch,
    running: state.running,
    status: state.running ? "running" : state.status || (options.watch ? "watching" : "idle"),
    lastStartedAt: state.lastStartedAt || "",
    lastFinishedAt: state.lastFinishedAt || "",
    lastExitCode: state.lastExitCode ?? null,
    lastExitSignal: state.lastExitSignal || "",
    lastBlockerCode: state.lastBlockerCode || "",
    lastDiscordSummary: state.lastDiscordSummary || null,
    lastError: state.lastError || "",
    lastRun: state.lastRun || null,
  };
}

function localLoginScriptPath() {
  return process.env.INWELL_LOCAL_LOGIN_SCRIPT || path.join(process.cwd(), "scripts", "tumblr-login.mjs");
}

function launchLocalLogin(payload, options, state) {
  const loginOptions = {
    userDataDir: String(payload?.userDataDir || options.userDataDir || "").trim() || options.userDataDir,
    slowMo: String(payload?.slowMo || options.slowMo || "500"),
  };
  const loginArgs = [
    localLoginScriptPath(),
    "--user-data-dir",
    loginOptions.userDataDir,
    "--slow-mo",
    loginOptions.slowMo,
  ];
  const child = spawn(process.execPath, loginArgs, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  state.status = options.watch ? "watching" : "idle";
  state.lastError = "";
  state.lastStartedAt = new Date().toISOString();
  return {
    ...companionStatus(options, state),
    accepted: true,
    pid: child.pid,
    message: "Tumblr login window opened on this computer.",
  };
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bodyRejected = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (bodyRejected) {
        return;
      }
      body += chunk;
      if (body.length > 1024 * 64) {
        bodyRejected = true;
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload, origin = "") {
  const allowOrigin = origin || "null";
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Private-Network": "true",
    "Content-Type": "application/json",
    "Vary": "Origin",
  });
  if (status === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload));
}

async function readCompanionPayload(request, response, origin) {
  try {
    const payload = await readRequestJson(request);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      sendJson(response, 400, { error: "Request body must be a JSON object." }, origin);
      return null;
    }
    return payload;
  } catch (error) {
    const message = error instanceof Error && /Request body is too large/.test(error.message)
      ? "Request body is too large."
      : "Request body must be valid JSON.";
    sendJson(response, 400, { error: message }, origin);
    return null;
  }
}

async function handleCompanionRun(request, response, options, state, origin) {
  if (state.running) {
    sendJson(response, 409, { ...companionStatus(options, state), accepted: false, error: "Local runner is already running." }, origin);
    return;
  }
  const payload = await readCompanionPayload(request, response, origin);
  if (!payload) {
    return;
  }
  const runOptions = companionRunOptions(payload, options);
  void executeLocalRun(runOptions, state).catch((error) => {
    console.error(`[local-runner:error] ${error instanceof Error ? error.message : String(error)}`);
  });
  sendJson(response, 202, { ...companionStatus(runOptions, state), accepted: true }, origin);
}

function companionRunOptions(payload, options) {
  const runOptions = { ...options };
  if ("queueName" in payload) {
    runOptions.queueName = String(payload.queueName || options.queueName) || options.queueName;
  }
  if ("headless" in payload) {
    runOptions.headless = Boolean(payload.headless);
  }
  if ("submit" in payload) {
    runOptions.submit = Boolean(payload.submit);
  }
  return runOptions;
}

async function handleCompanionLogin(request, response, options, state, origin) {
  if (state.running) {
    sendJson(response, 409, { ...companionStatus(options, state), accepted: false, error: "Local runner is already running." }, origin);
    return;
  }
  const payload = await readCompanionPayload(request, response, origin);
  if (!payload) {
    return;
  }
  const login = launchLocalLogin(payload, options, state);
  sendJson(response, 202, login, origin);
}

function startCompanionServer(options, state) {
  const allowedOrigins = companionAllowedOrigins(options);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    const origin = requestOrigin(request);
    if (!isTrustedCompanionOrigin(origin, allowedOrigins)) {
      sendJson(response, 403, { error: "Origin is not allowed." });
      return;
    }
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {}, origin);
      return;
    }
    if (request.method === "GET" && url.pathname === "/status") {
      sendJson(response, 200, companionStatus(options, state), origin);
      return;
    }
    if (request.method === "POST" && url.pathname === "/run") {
      await handleCompanionRun(request, response, options, state, origin);
      return;
    }
    if (request.method === "POST" && url.pathname === "/login") {
      await handleCompanionLogin(request, response, options, state, origin);
      return;
    }
    sendJson(response, 404, { error: "Not found" }, origin);
  });

  server.listen(options.companionPort, "127.0.0.1", () => {
    console.log(`[local-runner] Companion server listening on http://127.0.0.1:${options.companionPort}`);
  });
  return server;
}

async function postHeartbeat(options, status) {
  const response = await fetch(`${options.apiBaseUrl}/runner/local-heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspace_id: options.workspaceId,
      queue_name: options.queueName,
      watching: options.watch,
      status,
      version: LOCAL_COMPANION_VERSION,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not send local runner heartbeat: ${response.status}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseLocalArgs(process.argv.slice(2));
  const state = {
    running: false,
    status: options.watch ? "watching" : "idle",
    lastError: "",
    lastStartedAt: "",
    lastFinishedAt: "",
    lastExitCode: null,
    lastExitSignal: "",
    lastBlockerCode: "",
    lastDiscordSummary: null,
    lastRun: null,
  };

  if (options.serve) {
    startCompanionServer(options, state);
    await postHeartbeat(options, options.watch ? "watching" : "idle").catch(() => undefined);
    if (!options.watch) {
      await new Promise(() => undefined);
      return;
    }
  }

  do {
    let code = 0;
    try {
      const result = await executeLocalRun(options, state);
      code = result.exitCode ?? 0;
    } catch (error) {
      if (!options.watch) {
        throw error;
      }
      code = 1;
      console.error(`[local-runner:error] ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!options.watch) {
      process.exitCode = code;
      return;
    }

    await wait(options.intervalSeconds * 1000);
  } while (options.watch);
}

main().catch((error) => {
  console.error(`[local-runner:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

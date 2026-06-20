#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const LOCAL_COMPANION_VERSION = "local-runner-2";

function parseLocalArgs(argv) {
  const options = {
    apiBaseUrl: "",
    token: process.env.INWELL_LOCAL_RUNNER_TOKEN || "",
    workspaceId: "",
    queueName: "Default queue",
    userDataDir: ".tumblr-runner-profile-local",
    mediaDir: "",
    slowMo: "500",
    submit: false,
    watch: false,
    noPause: false,
    serve: false,
    companionPort: 17842,
    intervalSeconds: 15,
    limit: "",
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

  const { plan } = await response.json();
  return plan;
}

async function runPlan(options, plan) {
  if (!plan?.items?.length) {
    console.log(`[local-runner] No runnable items in ${options.queueName}.`);
    await postHeartbeat(options, options.watch ? "watching" : "idle").catch(() => undefined);
    return 0;
  }

  await postHeartbeat(options, "running").catch(() => undefined);
  const planPath = path.join(os.tmpdir(), `inwell-local-runner-${plan.runId}.json`);
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  console.log(`[local-runner] Running ${plan.items.length} item(s) from ${options.queueName}.`);

  const runnerArgs = [
    path.join(process.cwd(), "scripts", "tumblr-runner.mjs"),
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
    "--user-data-dir",
    options.userDataDir,
  ];
  if (options.mediaDir) {
    runnerArgs.push("--media-dir", options.mediaDir);
  }
  if (options.submit) {
    runnerArgs.push("--submit");
  }
  if (options.noPause) {
    runnerArgs.push("--no-pause");
  }

  const child = spawn(process.execPath, runnerArgs, { stdio: "inherit" });
  const code = await new Promise((resolve) => child.on("close", resolve));
  await postHeartbeat(options, Number(code) ? "error" : options.watch ? "watching" : "idle").catch(() => undefined);
  return Number(code) || 0;
}

async function executeLocalRun(options, state) {
  if (state.running) {
    return { accepted: false, running: true };
  }

  state.running = true;
  state.status = "running";
  state.lastError = "";
  state.lastStartedAt = new Date().toISOString();
  try {
    const plan = await fetchRunnerPlan(options);
    const code = await runPlan(options, plan);
    state.lastExitCode = code;
    state.lastFinishedAt = new Date().toISOString();
    state.status = code ? "error" : options.watch ? "watching" : "idle";
    return { accepted: true, running: false, exitCode: code };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    state.lastFinishedAt = new Date().toISOString();
    state.status = "error";
    await postHeartbeat(options, "error").catch(() => undefined);
    throw error;
  } finally {
    state.running = false;
  }
}

function companionStatus(options, state) {
  return {
    ok: true,
    version: LOCAL_COMPANION_VERSION,
    apiBaseUrl: options.apiBaseUrl,
    workspaceId: options.workspaceId,
    queueName: options.queueName,
    watching: options.watch,
    running: state.running,
    status: state.running ? "running" : state.status || (options.watch ? "watching" : "idle"),
    lastStartedAt: state.lastStartedAt || "",
    lastFinishedAt: state.lastFinishedAt || "",
    lastExitCode: state.lastExitCode ?? null,
    lastError: state.lastError || "",
  };
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        reject(new Error("Request body is too large"));
        request.destroy();
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

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "Content-Type": "application/json",
  });
  if (status === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload));
}

function startCompanionServer(options, state) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }
    if (request.method === "GET" && url.pathname === "/status") {
      sendJson(response, 200, companionStatus(options, state));
      return;
    }
    if (request.method === "POST" && url.pathname === "/run") {
      if (state.running) {
        sendJson(response, 409, { ...companionStatus(options, state), accepted: false, error: "Local runner is already running." });
        return;
      }
      const payload = await readRequestJson(request).catch(() => ({}));
      const runOptions = { ...options };
      if (payload && typeof payload === "object" && "queueName" in payload) {
        runOptions.queueName = String(payload.queueName || options.queueName) || options.queueName;
      }
      void executeLocalRun(runOptions, state).catch((error) => {
        console.error(`[local-runner:error] ${error instanceof Error ? error.message : String(error)}`);
      });
      sendJson(response, 202, { ...companionStatus(runOptions, state), accepted: true });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
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
    const result = await executeLocalRun(options, state);
    const code = result.exitCode ?? 0;
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

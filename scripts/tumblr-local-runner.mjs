#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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
      version: "local-runner-1",
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

  do {
    const plan = await fetchRunnerPlan(options);
    const code = await runPlan(options, plan);
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

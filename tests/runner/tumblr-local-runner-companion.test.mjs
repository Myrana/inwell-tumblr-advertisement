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

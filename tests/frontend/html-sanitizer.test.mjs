import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";

const appUrl = "http://127.0.0.1:8124";

function stopProcessTree(childProcess) {
  if (!childProcess.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(childProcess.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  childProcess.kill();
}

function waitForServer(url, timeoutMs = 20000) {
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

      setTimeout(poll, 100);
    }

    poll();
  });
}

test("sanitizeHtml enforces the template allow list and escape fallback", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8124 --strictPort", {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });

  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage();
  await page.goto(appUrl);

  const cases = await page.evaluate(async () => {
    const { sanitizeHtml } = await import("/src/domain/htmlSanitizer.ts");
    const originalParser = window.DOMParser;
    const fallback = (() => {
      window.DOMParser = undefined;
      try {
        return sanitizeHtml(`<p onclick="x">Fallback & copy</p>`);
      } finally {
        window.DOMParser = originalParser;
      }
    })();

    return {
      allowed: sanitizeHtml(`<p>Hello <strong>reader</strong><em>today</em><br><a href="mailto:owner@example.test">mail</a></p>`),
      dangerous: sanitizeHtml(
        `<p onclick="window.__xss = true">Hello<script>window.__xss = true</script><style>body{display:none}</style><iframe srcdoc="<script>alert(1)</script>">hidden</iframe><img src=x onerror="window.__xss = true"><a href="javascript:alert(1)">bad</a><a href="data:text/html,evil">data</a><a href="https://forum.example.test/thread">good</a></p>`,
      ),
      fallback,
      unwrap: sanitizeHtml(`<div><span>Plain <em>copy</em></span></div>`),
    };
  });

  assert.equal(
    cases.allowed,
    `<p>Hello <strong>reader</strong><em>today</em><br><a href="mailto:owner@example.test" rel="noopener noreferrer" target="_blank">mail</a></p>`,
  );
  assert.match(
    cases.dangerous,
    /<p>Hello<a>bad<\/a><a>data<\/a><a href="https:\/\/forum\.example\.test\/thread" rel="noopener noreferrer" target="_blank">good<\/a><\/p>/,
  );
  assert.doesNotMatch(cases.dangerous, /script|style|iframe|img|onclick|onerror|javascript:|data:text/i);
  assert.equal(cases.unwrap, "Plain <em>copy</em>");
  assert.equal(cases.fallback, "&lt;p onclick=&quot;x&quot;&gt;Fallback &amp; copy&lt;/p&gt;");
});

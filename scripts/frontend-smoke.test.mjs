import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";

const appUrl = "http://127.0.0.1:8123";

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

      setTimeout(poll, 250);
    }

    void poll();
  });
}

test("custom blog submission flow does not blank the editor", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8123 --strictPort", {
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.addInitScript(() => {
    localStorage.setItem(
      "inwell-tumblr-submit-targets",
      JSON.stringify([
        { id: "allthingsroleplay", name: "allthingsroleplay", submitUrl: "https://allthingsroleplay.tumblr.com/submit" },
      ]),
    );
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "ad-custom",
        ads: [
          {
            id: "ad-custom",
            postType: "photo",
            title: "Custom target ad",
            content: "<p>Existing body</p>",
            destinationBlog: "allthingsroleplay",
            forumUrl: "https://forum.example",
            tags: ["jcink site"],
            imageCaption: "",
            imageName: "sample-forum-ad.png",
            imageDataUrl: "/sample-forum-ad.png",
            videoUrl: "",
            videoName: "",
            status: "draft",
            updatedAt: "2026-06-17T00:00:00.000Z",
          },
        ],
      }),
    );
  });

  await page.goto(appUrl);
  await assert.doesNotReject(() => page.getByRole("heading", { name: "Custom target ad" }).waitFor());

  const targetSelect = page.locator('label:has-text("Target Tumblr blog") select');
  const addBlogInput = page.locator('label:has-text("Add Tumblr submit URL") input');

  await addBlogInput.fill("https://another-rp.tumblr.com/submit");
  await page.getByRole("button", { name: "Add blog" }).click();
  await targetSelect.selectOption("another-rp");
  await page.getByRole("button", { name: "New" }).click();

  await page.getByRole("heading", { name: "Untitled saved submission" }).waitFor();
  assert.equal(await targetSelect.inputValue(), "another-rp");
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
  assert.match((await page.locator("main").textContent()) ?? "", /Advertisement workspace/);
});

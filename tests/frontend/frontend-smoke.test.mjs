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
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());

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
    localStorage.setItem(
      "inkwell-saved-templates",
      JSON.stringify([
        {
          id: "template-editor",
          name: "Editor quick template",
          content: "<p><strong>Quick saved copy</strong></p>",
          forumUrl: "",
          tags: [],
          updatedAt: "2026-06-17T00:00:00.000Z",
        },
      ]),
    );
  });

  await page.goto(appUrl);
  await assert.doesNotReject(() => page.getByRole("heading", { name: "Custom target ad" }).waitFor());

  const targetSelect = page.locator('label:has-text("Target Tumblr blog") select');
  const addBlogInput = page.locator('label:has-text("Add Tumblr submit URL") input');
  const forumInput = page.getByLabel("Forum link");
  const savedNameInput = page.getByLabel("Saved submission name");

  await addBlogInput.fill("https://another-rp.tumblr.com/submit");
  await page.getByRole("button", { name: "Add blog" }).click();
  assert.equal(await savedNameInput.inputValue(), "Custom target ad");
  await targetSelect.selectOption("another-rp");
  assert.equal(await forumInput.inputValue(), "https://forum.example");
  await page.getByRole("button", { name: "New" }).click();

  await page.getByRole("heading", { name: "Untitled saved submission" }).waitFor();
  assert.equal(await targetSelect.inputValue(), "");
  assert.equal(await forumInput.inputValue(), "");
  assert.equal(await savedNameInput.inputValue(), "");
  await targetSelect.selectOption("another-rp");
  assert.equal(await savedNameInput.inputValue(), "another-rp");
  assert.equal(await forumInput.inputValue(), "https://forum.example");
  await savedNameInput.fill("");
  await addBlogInput.fill("https://blank-name.tumblr.com/submit");
  await page.getByRole("button", { name: "Add blog" }).click();
  assert.equal(await savedNameInput.inputValue(), "blank-name");
  await forumInput.fill("https://forum.example/updated");
  const persistedTargets = await page.evaluate(() => JSON.parse(localStorage.getItem("inwell-tumblr-submit-targets") ?? "[]"));
  assert.equal(persistedTargets.find((target) => target.id === "blank-name")?.forumUrl, "https://forum.example/updated");
  await page.getByRole("heading", { name: "Media library" }).waitFor();
  await page.getByRole("button", { name: /Editor quick template/ }).click();
  await page.locator(".tumblr-rich-editor strong", { hasText: "Quick saved copy" }).waitFor();
  assert.equal(await page.getByText("Import this blog's tags from a screenshot").count(), 0);
  assert.equal(await page.getByLabel("jcink site").count(), 0);
  await page.getByPlaceholder("custom tag").fill("manual test tag");
  await page.getByRole("button", { name: "Add custom tag" }).click();
  assert.equal(await page.getByLabel("manual test tag").isChecked(), true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved. Start a new submission or keep editing this one.").waitFor();
  await page.getByRole("button", { name: "Keep editing" }).click();
  assert.equal(await page.getByText("Saved. Start a new submission or keep editing this one.").count(), 0);
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
  assert.match((await page.locator("main").textContent()) ?? "", /Advertisement workspace/);
});

test("templates can be saved and applied from their own workspace", { timeout: 40000 }, async (t) => {
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
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());

  await page.addInitScript(() => {
    localStorage.setItem(
      "inwell-tumblr-submit-targets",
      JSON.stringify([{ id: "custom-ads", name: "custom-ads", submitUrl: "https://custom-ads.tumblr.com/submit" }]),
    );
    localStorage.setItem(
      "inwell-ad-assistant-state",
      JSON.stringify({
        activeAdId: "ad-template",
        ads: [
          {
            id: "ad-template",
            postType: "photo",
            title: "All Things Roleplay",
            content: "<p>Original copy</p>",
            destinationBlog: "custom-ads",
            forumUrl: "https://forum.example/original",
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
  await page.getByLabel("Target Tumblr blog").selectOption("custom-ads");
  assert.equal(await page.getByText("Inkwell Ads").count(), 0);
  assert.equal(await page.getByText("jcink-directory").count(), 0);
  assert.equal(await page.getByText("roleplay-finder").count(), 0);

  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("heading", { name: "Saved templates", level: 1 }).waitFor();

  await page.getByLabel("Template name").fill("Reusable premium ad");
  await page.locator(".template-rich-editor").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+B" : "Control+B");
  await page.keyboard.type("Template bold copy");
  await page.getByRole("button", { name: "Save template" }).click();
  await page.getByText("Saved Reusable premium ad.").waitFor();
  await page.locator(".template-preview strong", { hasText: "Template bold copy" }).waitFor();
  await page.getByRole("button", { name: /Reusable premium ad/ }).click();

  await page.getByRole("heading", { name: "All Things Roleplay" }).waitFor();
  assert.match((await page.locator(".tumblr-rich-editor").textContent()) ?? "", /Template bold copy/);
  await page.locator(".tumblr-rich-editor strong", { hasText: "Template bold copy" }).waitFor();
  assert.equal(await page.getByLabel("Forum link").inputValue(), "https://forum.example/original");
  assert.equal(await page.getByLabel("jcink site").isChecked(), true);
  assert.equal(await page.getByLabel("premium jcink").count(), 0);

  await page.getByRole("button", { name: "Saved Submissions" }).click();
  await page.getByRole("heading", { name: "Saved submissions", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Queue" }).click();
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();
  assert.equal(pageErrors.length, 0, pageErrors.map((error) => error.message).join("\n"));
});

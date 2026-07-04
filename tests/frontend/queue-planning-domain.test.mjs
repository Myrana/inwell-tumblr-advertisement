import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";
import { stopProcessTree, waitForServer } from "./helpers/appTestServer.mjs";

const appUrl = "http://127.0.0.1:8126";

test("queue planning rejects archived ready ads until they are restored", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8126 --strictPort", {
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

  const result = await page.evaluate(async () => {
    const { planQueueTargetAdditions } = await import("/src/domain/queuePlanning.ts");
    const target = {
      id: "target-blog",
      name: "Target Blog",
      profileName: "Target profile",
      submitUrl: "https://target.example/submit",
      forumUrl: "https://forum.example/thread",
      postingRules: "",
    };
    const readyAd = (archived) => ({
      id: "ready-ad",
      postType: "text",
      title: "Ready ad",
      campaignName: "",
      content: "<p>Ready copy</p>",
      destinationBlog: "target-blog",
      forumUrl: "https://forum.example/thread",
      tags: ["wanted"],
      imageCaption: "",
      imageName: "",
      imageDataUrl: "",
      videoUrl: "",
      videoName: "",
      status: "ready",
      archived,
      updatedAt: "2026-06-20T12:00:00.000Z",
    });

    return {
      archivedPlan: planQueueTargetAdditions({
        ad: readyAd(true),
        queueName: "Default queue",
        targets: [target],
        tumblrAccountId: "tumblr-account",
      }),
      activePlan: planQueueTargetAdditions({
        ad: readyAd(false),
        queueName: "Default queue",
        targets: [target],
        tumblrAccountId: "tumblr-account",
      }),
    };
  });

  assert.equal(result.archivedPlan.status, "validation-error");
  assert.deepEqual(result.archivedPlan.validation, ["Restore this archived ad before queueing."]);
  assert.equal(result.activePlan.status, "ready");
  assert.equal(result.activePlan.items.length, 1);
  assert.equal(result.activePlan.items[0].adId, "ready-ad");
});

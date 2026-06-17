#!/usr/bin/env node
import path from "node:path";
import { chromium } from "playwright";
import { loadRunnerPlan, parseArgs, summarizeFrames } from "./tumblr-runner-core.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = await loadRunnerPlan(options.planPath);
  const context = await chromium.launchPersistentContext(path.resolve(options.userDataDir), {
    headless: true,
    slowMo: options.slowMo,
  });

  try {
    for (const item of plan.items) {
      await inspectItem(context, item);
    }
  } finally {
    await context.close();
  }
}

async function inspectItem(context, item) {
  const dashboard = await inspectUrl(context, "dashboard", "https://www.tumblr.com/dashboard");
  const directSubmitForm = await inspectUrl(
    context,
    "direct-submit-form",
    `https://www.tumblr.com/submit_form/${new URL(item.submitUrl).hostname}`,
  );
  const publicSubmitPage = await inspectUrl(context, "public-submit-page", item.submitUrl);

  const report = {
    targetName: item.targetName,
    submitUrl: item.submitUrl,
    postType: item.postType,
    dashboard: compactInspection(dashboard),
    directSubmitForm: compactInspection(directSubmitForm),
    publicSubmitPage: compactInspection(publicSubmitPage),
  };

  console.log(JSON.stringify(report, null, 2));
}

async function inspectUrl(context, label, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    const frames = [];
    for (const frame of page.frames()) {
      const info = await frame
        .evaluate(() => {
          const body = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
          return {
            title: document.title,
            url: location.href,
            forms: document.forms.length,
            inputs: document.querySelectorAll("input").length,
            textareas: document.querySelectorAll("textarea").length,
            contenteditable: document.querySelectorAll("[contenteditable='true']").length,
            buttons: document.querySelectorAll("button").length,
            hasLoginText: /log in|login|sign up|sign in/i.test(body),
            hasDeniedText: /request denied|permission/i.test(body),
            hasCaptchaText: /captcha|recaptcha|robot|verify/i.test(body),
            sample: body.slice(0, 450),
          };
        })
        .catch((error) => ({ url: frame.url(), error: error.message }));
      frames.push({ name: frame.name(), ...info });
    }

    return {
      label,
      finalUrl: page.url(),
      frameCount: frames.length,
      frames,
      ...summarizeFrames(frames),
    };
  } catch (error) {
    return {
      label,
      finalUrl: page.url(),
      error: error instanceof Error ? error.message : String(error),
      frames: [],
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function compactInspection(result) {
  return {
    finalUrl: result.finalUrl,
    frameCount: result.frameCount,
    likelyLoggedIn: Boolean(result.likelyLoggedIn),
    blocker: result.blocker || "",
    blockerUrl: result.blockerUrl || "",
    formFrame: result.formFrame
      ? {
          name: result.formFrame.name,
          title: result.formFrame.title,
          url: result.formFrame.url,
          controls: {
            inputs: result.formFrame.inputs,
            textareas: result.formFrame.textareas,
            contenteditable: result.formFrame.contenteditable,
            buttons: result.formFrame.buttons,
          },
          sample: result.formFrame.sample,
        }
      : null,
    error: result.error || "",
  };
}

main().catch((error) => {
  console.error(`[inspect:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";
import {
  createFrontendTestContext,
  stopProcessTree,
  waitForServer,
} from "./helpers/appTestServer.mjs";
import { openWorkspaceView } from "./helpers/workspaceNavigation.mjs";

const {
  apiHeaders,
  appUrl,
  port,
  routeAuthenticatedSession,
  routeEmptyWorkspaceApis,
} = createFrontendTestContext(8136);

function startVite(t) {
  const server = spawn(`npx vite --host 127.0.0.1 --port ${port} --strictPort`, {
    cwd: process.cwd(),
    shell: true,
    stdio: "ignore",
  });

  t.after(() => {
    stopProcessTree(server);
  });
}

async function openAuthenticatedPage(t, viewport) {
  startVite(t);
  await waitForServer(appUrl);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage(viewport ? { viewport } : undefined);
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  return page;
}

async function routePreviewFixture(page) {
  await page.route("http://127.0.0.1:8021/api/templates", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        templates: [
          {
            id: "template-visual",
            name: "Grass is Greener Ad",
            content: "<p>A slice-of-life supernatural RPG based around two neighboring towns.</p>",
            forum_url: "https://forum.example/grass",
            queue_name: "Adverts",
            tags: ["jcink premium", "supernatural", "mature content", "21+"],
            updated_at: "2026-06-20T23:17:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/queue", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        queue: [
          {
            id: "queue-visual",
            ad_id: "ad-visual",
            target_id: "target-visual",
            target_name: "jcinktinder",
            tumblr_account_id: "tumblr-runner",
            queue_name: "Adverts",
            submit_url: "https://jcinktinder.tumblr.com/submit",
            post_type: "photo",
            status: "failed",
            scheduled_for: null,
            timezone: "America/New_York",
            created_at: "2026-07-06T14:09:00.000Z",
            updated_at: "2026-07-06T14:09:00.000Z",
            last_run_at: "2026-07-06T14:09:00.000Z",
            posted_at: null,
            failed_at: "2026-07-06T14:09:00.000Z",
            notes: "The Playwright browser or tab closed before the runner finished.",
            runner_payload: "{}",
          },
          {
            id: "queue-text-visual",
            ad_id: "ad-text-visual",
            target_id: "target-text-visual",
            target_name: "texttarget",
            tumblr_account_id: "tumblr-runner",
            queue_name: "Adverts",
            submit_url: "https://texttarget.tumblr.com/submit",
            post_type: "text",
            status: "failed",
            scheduled_for: null,
            timezone: "America/New_York",
            created_at: "2026-07-06T14:09:00.000Z",
            updated_at: "2026-07-06T14:09:00.000Z",
            last_run_at: "2026-07-06T14:09:00.000Z",
            posted_at: null,
            failed_at: "2026-07-06T14:09:00.000Z",
            notes: "The Playwright browser or tab closed before the runner finished.",
            runner_payload: "{}",
          },
        ],
      }),
    }),
  );
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        advertisements: [
          {
            id: "saved-visual-image",
            post_type: "photo",
            title: "Image saved post",
            campaign_name: "Visual campaign",
            content: "<p>Saved advertisement copy with a real preview image.</p>",
            destination_blog: "allthingsroleplay",
            forum_url: "https://forum.example/image",
            tags: ["visual"],
            image_caption: "",
            image_name: "template-ad-preview.jpg",
            image_data_url: "/template-ad-preview.jpg",
            video_url: "",
            video_name: "",
            status: "draft",
            updated_at: "2026-06-20T12:00:00.000Z",
          },
          {
            id: "saved-visual-fallback",
            post_type: "text",
            title: "Fallback saved post",
            campaign_name: "Visual campaign",
            content: "<p>Saved advertisement copy without uploaded media.</p>",
            destination_blog: "allthingsroleplay",
            forum_url: "https://forum.example/fallback",
            tags: ["fallback"],
            image_caption: "",
            image_name: "",
            image_data_url: "",
            video_url: "",
            video_name: "",
            status: "draft",
            updated_at: "2026-06-20T12:05:00.000Z",
          },
        ],
      }),
    }),
  );
}

test("template preview graphics use framed shared assets in light and dark themes", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 1280, height: 900 });
  await routePreviewFixture(page);
  await page.goto(appUrl);
  await openWorkspaceView(page, "Templates");
  await page.getByRole("heading", { name: "Saved templates", level: 1 }).waitFor();

  const templatePreview = await page.evaluate(() => {
    const callout = document.querySelector(".template-callout-art");
    const calloutCard = callout?.querySelector("div");
    const calloutImage = callout?.querySelector("img");
    const thumb = document.querySelector(".template-library-detailed .template-media-thumb");
    const thumbImage = thumb?.querySelector("img");
    const light = {
      calloutBackground: callout ? getComputedStyle(callout).backgroundColor : "",
      calloutImageFit: calloutImage ? getComputedStyle(calloutImage).objectFit : "",
      calloutCardAspectRatio: calloutCard ? getComputedStyle(calloutCard).aspectRatio : "",
      thumbAspectRatio: thumb ? getComputedStyle(thumb).aspectRatio : "",
      thumbObjectFit: thumbImage ? getComputedStyle(thumbImage).objectFit : "",
      thumbOverflowsCard: thumb && thumb.closest(".template-card")
        ? thumb.getBoundingClientRect().right > thumb.closest(".template-card").getBoundingClientRect().right
        : true,
    };
    document.documentElement.dataset.theme = "dark";
    const dark = {
      calloutBackground: callout ? getComputedStyle(callout).backgroundColor : "",
      thumbBackground: thumb ? getComputedStyle(thumb).backgroundColor : "",
    };
    document.documentElement.dataset.theme = "light";
    return {
      imageSrc: calloutImage?.getAttribute("src") ?? "",
      imageComplete: Boolean(calloutImage?.complete),
      imageNaturalWidth: calloutImage?.naturalWidth ?? 0,
      light,
      dark,
    };
  });
  assert.equal(templatePreview.imageSrc, "/template-ad-preview.jpg");
  assert.equal(templatePreview.imageComplete, true);
  assert.ok(templatePreview.imageNaturalWidth > 0);
  assert.equal(templatePreview.light.calloutImageFit, "cover");
  assert.equal(templatePreview.light.calloutCardAspectRatio, "16 / 10");
  assert.equal(templatePreview.light.thumbAspectRatio, "1.78 / 1");
  assert.equal(templatePreview.light.thumbObjectFit, "cover");
  assert.equal(templatePreview.light.thumbOverflowsCard, false);
  assert.notEqual(templatePreview.dark.calloutBackground, templatePreview.light.calloutBackground);
  assert.notEqual(templatePreview.dark.thumbBackground, "rgba(0, 0, 0, 0)");
});

test("queue thumbnails use framed image and fallback states without overflow", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 1280, height: 900 });
  await routePreviewFixture(page);
  await page.goto(appUrl);
  await openWorkspaceView(page, "Queue");
  await page.getByRole("heading", { name: "Submission queue", level: 1 }).waitFor();

  const desktopQueueThumbs = await page.evaluate(() => {
    const photoThumb = document.querySelector(".queue-item-thumb");
    const textThumb = document.querySelectorAll(".queue-item-thumb")[1];
    const photoImage = photoThumb?.querySelector("img");
    const textIcon = textThumb?.querySelector("svg");
    const textBox = textThumb?.getBoundingClientRect();
    const textItemBox = textThumb?.closest(".queue-item")?.getBoundingClientRect();
    const light = {
      photoSrc: photoImage?.getAttribute("src") ?? "",
      photoComplete: Boolean(photoImage?.complete),
      photoNaturalWidth: photoImage?.naturalWidth ?? 0,
      photoObjectFit: photoImage ? getComputedStyle(photoImage).objectFit : "",
      photoWidth: Math.round(photoThumb?.getBoundingClientRect().width ?? 0),
      photoHeight: Math.round(photoThumb?.getBoundingClientRect().height ?? 0),
      fallbackIconBackground: textIcon ? getComputedStyle(textIcon).backgroundColor : "",
      fallbackIconRadius: textIcon ? getComputedStyle(textIcon).borderRadius : "",
      fallbackWidth: Math.round(textBox?.width ?? 0),
      fallbackHeight: Math.round(textBox?.height ?? 0),
      fallbackOverflowsItem: textBox && textItemBox ? textBox.right > textItemBox.right || textBox.left < textItemBox.left : true,
    };
    document.documentElement.dataset.theme = "dark";
    const dark = {
      thumbBackground: textThumb ? getComputedStyle(textThumb).backgroundColor : "",
      iconBackground: textIcon ? getComputedStyle(textIcon).backgroundColor : "",
    };
    document.documentElement.dataset.theme = "light";
    return { light, dark };
  });
  assert.equal(desktopQueueThumbs.light.photoSrc, "/template-ad-preview.jpg");
  assert.equal(desktopQueueThumbs.light.photoComplete, true);
  assert.ok(desktopQueueThumbs.light.photoNaturalWidth > 0);
  assert.equal(desktopQueueThumbs.light.photoObjectFit, "cover");
  assert.equal(desktopQueueThumbs.light.photoWidth, 82);
  assert.equal(desktopQueueThumbs.light.photoHeight, 82);
  assert.notEqual(desktopQueueThumbs.light.fallbackIconBackground, "rgba(0, 0, 0, 0)");
  assert.equal(desktopQueueThumbs.light.fallbackIconRadius, "8px");
  assert.equal(desktopQueueThumbs.light.fallbackWidth, 82);
  assert.equal(desktopQueueThumbs.light.fallbackHeight, 82);
  assert.equal(desktopQueueThumbs.light.fallbackOverflowsItem, false);
  assert.notEqual(desktopQueueThumbs.dark.thumbBackground, "rgba(0, 0, 0, 0)");
  assert.notEqual(desktopQueueThumbs.dark.iconBackground, "rgba(0, 0, 0, 0)");

  await page.setViewportSize({ width: 390, height: 900 });
  const mobileQueueThumbs = await page.evaluate(() => {
    const thumb = document.querySelector(".queue-item-thumb");
    const fallbackThumb = document.querySelectorAll(".queue-item-thumb")[1];
    const image = thumb?.querySelector("img");
    const thumbBox = thumb?.getBoundingClientRect();
    const fallbackBox = fallbackThumb?.getBoundingClientRect();
    const item = fallbackThumb?.closest(".queue-item");
    const itemBox = item?.getBoundingClientRect();
    return {
      src: image?.getAttribute("src") ?? "",
      complete: Boolean(image?.complete),
      naturalWidth: image?.naturalWidth ?? 0,
      objectFit: image ? getComputedStyle(image).objectFit : "",
      width: Math.round(thumbBox?.width ?? 0),
      height: Math.round(thumbBox?.height ?? 0),
      fallbackWidth: Math.round(fallbackBox?.width ?? 0),
      fallbackHeight: Math.round(fallbackBox?.height ?? 0),
      fallbackOverflowsItem: fallbackBox && itemBox ? fallbackBox.right > itemBox.right || fallbackBox.left < itemBox.left : true,
    };
  });
  assert.equal(mobileQueueThumbs.src, "/template-ad-preview.jpg");
  assert.equal(mobileQueueThumbs.complete, true);
  assert.ok(mobileQueueThumbs.naturalWidth > 0);
  assert.equal(mobileQueueThumbs.objectFit, "cover");
  assert.ok(mobileQueueThumbs.width <= 160);
  assert.equal(mobileQueueThumbs.width, mobileQueueThumbs.height);
  assert.ok(mobileQueueThumbs.fallbackWidth <= 160);
  assert.equal(mobileQueueThumbs.fallbackWidth, mobileQueueThumbs.fallbackHeight);
  assert.equal(mobileQueueThumbs.fallbackOverflowsItem, false);
});

test("saved library comfortable cards and preview popovers use stable media frames", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 1280, height: 900 });
  await routePreviewFixture(page);
  await page.goto(appUrl);
  await openWorkspaceView(page, "Content Library");
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();

  const cardMedia = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".advertisement-card")];
    const imageCard = cards.find((card) => card.textContent?.includes("Image saved post"));
    const fallbackCard = cards.find((card) => card.textContent?.includes("Fallback saved post"));
    const imageMedia = imageCard?.querySelector(".draft-card-media");
    const fallbackMedia = fallbackCard?.querySelector(".draft-card-media");
    const image = imageMedia?.querySelector("img");
    const fallback = fallbackMedia?.querySelector("span");
    const imageBox = imageMedia?.getBoundingClientRect();
    const imageCardBox = imageCard?.getBoundingClientRect();
    const fallbackBox = fallbackMedia?.getBoundingClientRect();
    const fallbackCardBox = fallbackCard?.getBoundingClientRect();
    const light = {
      imageSrc: image?.getAttribute("src") ?? "",
      imageComplete: Boolean(image?.complete),
      imageNaturalWidth: image?.naturalWidth ?? 0,
      imageObjectFit: image ? getComputedStyle(image).objectFit : "",
      imageAspectRatio: imageMedia ? getComputedStyle(imageMedia).aspectRatio : "",
      imageOverflowsCard: imageBox && imageCardBox ? imageBox.right > imageCardBox.right || imageBox.left < imageCardBox.left : true,
      fallbackText: fallback?.textContent ?? "",
      fallbackBackground: fallback ? getComputedStyle(fallback).backgroundColor : "",
      fallbackRadius: fallback ? getComputedStyle(fallback).borderRadius : "",
      fallbackOverflowsCard: fallbackBox && fallbackCardBox ? fallbackBox.right > fallbackCardBox.right || fallbackBox.left < fallbackCardBox.left : true,
    };
    document.documentElement.dataset.theme = "dark";
    const dark = {
      mediaBackground: imageMedia ? getComputedStyle(imageMedia).backgroundColor : "",
      fallbackBackground: fallback ? getComputedStyle(fallback).backgroundColor : "",
    };
    document.documentElement.dataset.theme = "light";
    return { light, dark };
  });
  assert.equal(cardMedia.light.imageSrc, "/template-ad-preview.jpg");
  assert.equal(cardMedia.light.imageComplete, true);
  assert.ok(cardMedia.light.imageNaturalWidth > 0);
  assert.equal(cardMedia.light.imageObjectFit, "cover");
  assert.equal(cardMedia.light.imageAspectRatio, "16 / 10");
  assert.equal(cardMedia.light.imageOverflowsCard, false);
  assert.equal(cardMedia.light.fallbackText, "F");
  assert.notEqual(cardMedia.light.fallbackBackground, "rgba(0, 0, 0, 0)");
  assert.equal(cardMedia.light.fallbackRadius, "8px");
  assert.equal(cardMedia.light.fallbackOverflowsCard, false);
  assert.notEqual(cardMedia.dark.mediaBackground, "rgba(0, 0, 0, 0)");
  assert.notEqual(cardMedia.dark.fallbackBackground, "rgba(0, 0, 0, 0)");

  await page
    .locator(".advertisement-card")
    .filter({ hasText: "Image saved post" })
    .locator(".draft-card-preview summary")
    .click();
  const popover = await page.evaluate(() => {
    const panel = document.querySelector(".draft-card-preview[open] > div");
    const image = panel?.querySelector("img");
    const panelBox = panel?.getBoundingClientRect();
    const imageBox = image?.getBoundingClientRect();
    return {
      imageAspectRatio: image ? getComputedStyle(image).aspectRatio : "",
      imageObjectFit: image ? getComputedStyle(image).objectFit : "",
      imageBorder: image ? getComputedStyle(image).borderTopWidth : "",
      imageBackground: image ? getComputedStyle(image).backgroundColor : "",
      imageOverflowsPanel: imageBox && panelBox ? imageBox.right > panelBox.right || imageBox.left < panelBox.left : true,
    };
  });
  assert.equal(popover.imageAspectRatio, "16 / 10");
  assert.equal(popover.imageObjectFit, "cover");
  assert.equal(popover.imageBorder, "1px");
  assert.notEqual(popover.imageBackground, "rgba(0, 0, 0, 0)");
  assert.equal(popover.imageOverflowsPanel, false);
});

test("saved library compact and gallery media frames stay stable", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 1280, height: 900 });
  await routePreviewFixture(page);
  await page.goto(appUrl);
  await openWorkspaceView(page, "Content Library");
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();

  await page.getByRole("button", { name: "Compact" }).click();
  const compactMedia = await page.evaluate(() => {
    const imageCard = [...document.querySelectorAll(".advertisement-card")].find((card) => card.textContent?.includes("Image saved post"));
    const fallbackCard = [...document.querySelectorAll(".advertisement-card")].find((card) => card.textContent?.includes("Fallback saved post"));
    const imageBox = imageCard?.querySelector(".draft-card-media")?.getBoundingClientRect();
    const fallbackBox = fallbackCard?.querySelector(".draft-card-media")?.getBoundingClientRect();
    return {
      listClass: document.querySelector(".saved-library-list")?.className ?? "",
      imageWidth: Math.round(imageBox?.width ?? 0),
      imageHeight: Math.round(imageBox?.height ?? 0),
      fallbackWidth: Math.round(fallbackBox?.width ?? 0),
      fallbackHeight: Math.round(fallbackBox?.height ?? 0),
    };
  });
  assert.match(compactMedia.listClass, /saved-library-list-compact/);
  assert.equal(compactMedia.imageWidth, 54);
  assert.equal(compactMedia.imageHeight, 54);
  assert.equal(compactMedia.fallbackWidth, 54);
  assert.equal(compactMedia.fallbackHeight, 54);

  await page.getByRole("button", { name: "Gallery" }).click();
  const galleryMedia = await page.evaluate(() => {
    const imageCard = [...document.querySelectorAll(".advertisement-card")].find((card) => card.textContent?.includes("Image saved post"));
    const fallbackCard = [...document.querySelectorAll(".advertisement-card")].find((card) => card.textContent?.includes("Fallback saved post"));
    const imageMedia = imageCard?.querySelector(".draft-card-media");
    const fallbackMedia = fallbackCard?.querySelector(".draft-card-media");
    const imageBox = imageMedia?.getBoundingClientRect();
    const fallbackBox = fallbackMedia?.getBoundingClientRect();
    const imageRatio = imageBox && imageBox.height ? Number((imageBox.width / imageBox.height).toFixed(2)) : 0;
    const fallbackRatio = fallbackBox && fallbackBox.height ? Number((fallbackBox.width / fallbackBox.height).toFixed(2)) : 0;
    return {
      listClass: document.querySelector(".saved-library-list")?.className ?? "",
      imageWidth: Math.round(imageBox?.width ?? 0),
      imageHeight: Math.round(imageBox?.height ?? 0),
      fallbackWidth: Math.round(fallbackBox?.width ?? 0),
      fallbackHeight: Math.round(fallbackBox?.height ?? 0),
      imageRatio,
      fallbackRatio,
    };
  });
  assert.match(galleryMedia.listClass, /saved-library-list-gallery/);
  assert.equal(galleryMedia.imageWidth, 96);
  assert.equal(galleryMedia.imageHeight, 96);
  assert.equal(galleryMedia.fallbackWidth, 96);
  assert.equal(galleryMedia.fallbackHeight, 96);
  assert.equal(galleryMedia.imageRatio, 1);
  assert.equal(galleryMedia.fallbackRatio, 1);
});

test("saved library mobile gallery and popover stay inside the viewport", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 390, height: 900 });
  await routePreviewFixture(page);
  await page.goto(appUrl);
  await openWorkspaceView(page, "Content Library");
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Gallery" }).click();

  const mobileGallery = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".advertisement-card")];
    const imageMedia = cards.find((card) => card.textContent?.includes("Image saved post"))?.querySelector(".draft-card-media");
    const fallbackMedia = cards.find((card) => card.textContent?.includes("Fallback saved post"))?.querySelector(".draft-card-media");
    const imageBox = imageMedia?.getBoundingClientRect();
    const fallbackBox = fallbackMedia?.getBoundingClientRect();
    const imageCardBox = imageMedia?.closest(".advertisement-card")?.getBoundingClientRect();
    const fallbackCardBox = fallbackMedia?.closest(".advertisement-card")?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      imageOverflowsCard: imageBox && imageCardBox ? imageBox.right > imageCardBox.right || imageBox.left < imageCardBox.left : true,
      fallbackOverflowsCard: fallbackBox && fallbackCardBox ? fallbackBox.right > fallbackCardBox.right || fallbackBox.left < fallbackCardBox.left : true,
      imageWidth: Math.round(imageBox?.width ?? 0),
      fallbackWidth: Math.round(fallbackBox?.width ?? 0),
    };
  });
  assert.ok(mobileGallery.overflow <= 1);
  assert.equal(mobileGallery.imageOverflowsCard, false);
  assert.equal(mobileGallery.fallbackOverflowsCard, false);
  assert.ok(mobileGallery.imageWidth <= 390);
  assert.ok(mobileGallery.fallbackWidth <= 390);

  await page
    .locator(".advertisement-card")
    .filter({ hasText: "Image saved post" })
    .locator(".draft-card-preview summary")
    .click();
  const mobilePopover = await page.evaluate(() => {
    const panel = document.querySelector(".draft-card-preview[open] > div");
    const image = panel?.querySelector("img");
    const panelBox = panel?.getBoundingClientRect();
    const imageBox = image?.getBoundingClientRect();
    return {
      panelWidth: Math.round(panelBox?.width ?? 0),
      panelLeft: Math.round(panelBox?.left ?? 0),
      panelRight: Math.round(panelBox?.right ?? 0),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      imageAspectRatio: image ? getComputedStyle(image).aspectRatio : "",
      imageOverflowsPanel: imageBox && panelBox ? imageBox.right > panelBox.right || imageBox.left < panelBox.left : true,
    };
  });
  assert.ok(mobilePopover.panelWidth <= 390);
  assert.ok(mobilePopover.panelLeft >= 0);
  assert.ok(mobilePopover.panelRight <= 390);
  assert.ok(mobilePopover.overflow <= 1);
  assert.equal(mobilePopover.imageAspectRatio, "16 / 10");
  assert.equal(mobilePopover.imageOverflowsPanel, false);
});

test("runner hero styling stays operational in light and dark themes", { timeout: 40000 }, async (t) => {
  const page = await openAuthenticatedPage(t, { width: 1280, height: 900 });
  await page.goto(appUrl);
  await openWorkspaceView(page, "Runner");
  await page.getByLabel("Runner health summary").waitFor();

  const runnerHero = await page.evaluate(() => {
    const hero = document.querySelector(".runner-hero");
    const title = hero?.querySelector("h2");
    const light = {
      background: hero ? getComputedStyle(hero).backgroundColor : "",
      backgroundImage: hero ? getComputedStyle(hero).backgroundImage : "",
      borderLeftWidth: hero ? getComputedStyle(hero).borderLeftWidth : "",
      titleSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
    };
    document.documentElement.dataset.theme = "dark";
    const dark = {
      background: hero ? getComputedStyle(hero).backgroundColor : "",
      backgroundImage: hero ? getComputedStyle(hero).backgroundImage : "",
      borderLeftWidth: hero ? getComputedStyle(hero).borderLeftWidth : "",
    };
    document.documentElement.dataset.theme = "light";
    return { light, dark };
  });
  assert.equal(runnerHero.light.background, "rgb(255, 255, 255)");
  assert.equal(runnerHero.light.backgroundImage, "none");
  assert.equal(runnerHero.light.borderLeftWidth, "4px");
  assert.ok(runnerHero.light.titleSize < 28);
  assert.notEqual(runnerHero.dark.background, runnerHero.light.background);
  assert.equal(runnerHero.dark.backgroundImage, "none");
  assert.equal(runnerHero.dark.borderLeftWidth, "4px");
});

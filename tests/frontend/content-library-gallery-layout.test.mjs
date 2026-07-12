import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";
import { createFrontendTestContext, stopProcessTree, waitForServer } from "./helpers/appTestServer.mjs";

const { apiHeaders, appUrl, routeAuthenticatedSession, routeEmptyWorkspaceApis } = createFrontendTestContext(8137);

const advertisement = {
  id: "gallery-ad",
  post_type: "photo",
  title: "Gallery layout advertisement",
  campaign_name: "Adverts",
  content: "<p>Prepared gallery content</p>",
  destination_blog: "allthingsroleplay",
  forum_url: "https://forum.example/thread",
  tags: ["wanted"],
  image_caption: "<p>Prepared caption</p>",
  image_name: "gallery.png",
  image_data_url: "data:image/png;base64,iVBORw0KGgo=",
  video_url: "",
  video_name: "",
  status: "ready",
  updated_at: "2026-07-12T12:00:00.000Z",
};

const secondAdvertisement = {
  ...advertisement,
  id: "gallery-ad-two",
  title: "Second gallery advertisement",
  destination_blog: "jcinktinder",
  updated_at: "2026-07-12T12:05:00.000Z",
};

async function openContentLibrary(page) {
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Operations dashboard", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Prep content", exact: true }).first().click();
  await page.getByRole("heading", { name: "Content library", level: 1 }).waitFor();
}

async function routeLibraryFixture(page) {
  await page.route("http://127.0.0.1:8021/api/**", (route) => route.abort());
  await page.route("http://127.0.0.1:17842/status", (route) => route.abort());
  await routeAuthenticatedSession(page);
  await routeEmptyWorkspaceApis(page);
  await page.route("http://127.0.0.1:8021/api/advertisements", (route) =>
    route.fulfill({ contentType: "application/json", headers: apiHeaders, body: JSON.stringify({ advertisements: [advertisement, secondAdvertisement] }) })
  );
  await page.route("http://127.0.0.1:8021/api/settings", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: apiHeaders,
      body: JSON.stringify({
        settings: {
          submitTargets: [{
            id: "allthingsroleplay",
            name: "allthingsroleplay",
            profileName: "All Things Roleplay ads",
            submitUrl: "https://allthingsroleplay.tumblr.com/submit",
            forumUrl: "https://forum.example/thread",
            postingRules: "Use photo posts.",
          }, {
            id: "jcinktinder",
            name: "jcinktinder",
            profileName: "Jcink Tinder ads",
            submitUrl: "https://jcinktinder.tumblr.com/submit",
            forumUrl: "https://forum.example/thread",
            postingRules: "Use photo posts.",
          }],
          queueDefinitions: [
            { id: "default-queue", name: "Default queue" },
            { id: "adverts", name: "Adverts" },
          ],
          tagProfiles: {},
        },
      }),
    })
  );
}

async function assertGalleryContained(page, width) {
  await page.setViewportSize({ width, height: 760 });
  const card = page.locator(".saved-library-list-gallery .advertisement-card").first();
  await card.getByRole("button", { name: "Queue", exact: true }).click();
  await card.getByLabel(/Choose queue for/).waitFor();
  await card.getByLabel("More advertisement actions").click();
  await card.getByRole("button", { name: "Archive" }).waitFor();

  const state = await card.evaluate((element) => {
    const selectors = [
      ".draft-card-media",
      ".draft-row-summary",
      ".draft-row-actions",
      ".content-queue-picker",
      ".draft-card-overflow",
      ".draft-card-overflow > div",
    ];
    const cardBox = element.getBoundingClientRect();
    const regions = selectors.map((selector) => element.querySelector(selector)?.getBoundingClientRect()).filter(Boolean);
    const viewportContainsHorizontally = (box) => box.left >= -1 && box.right <= window.innerWidth + 1;
    const cardContains = (box) => box.left >= cardBox.left - 1 && box.right <= cardBox.right + 1;
    const picker = element.querySelector(".content-queue-picker")?.getBoundingClientRect();
    const menu = element.querySelector(".draft-card-overflow > div")?.getBoundingClientRect();
    const intersects = (left, right) => Boolean(
      left && right && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    );
    return {
      measuredRegionCount: regions.length,
      cardInViewport: viewportContainsHorizontally(cardBox),
      regionsInViewport: regions.every(viewportContainsHorizontally),
      regionsInCard: regions.every(cardContains),
      pickerMenuOverlap: intersects(picker, menu),
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      regionBounds: regions.map((region) => ({ left: Math.round(region.left), right: Math.round(region.right), width: Math.round(region.width) })),
    };
  });

  assert.equal(state.measuredRegionCount, 6);
  assert.equal(state.cardInViewport, true);
  assert.equal(state.regionsInViewport, true, JSON.stringify(state.regionBounds));
  assert.equal(state.regionsInCard, true);
  assert.equal(state.pickerMenuOverlap, false);
  assert.ok(state.documentOverflow <= 1);
  assert.equal(await card.getByLabel("Queue destination").isVisible(), true);
  assert.equal(await card.getByRole("button", { name: "Queue here" }).isVisible(), true);
  assert.equal(await card.getByRole("button", { name: "Archive" }).isVisible(), true);
  await card.getByRole("button", { name: "Archive" }).focus();
  assert.equal(await card.getByRole("button", { name: "Archive" }).isEnabled(), true);
}

test("gallery card controls stay contained with picker and menu open", { timeout: 40000 }, async (t) => {
  const server = spawn("npx vite --host 127.0.0.1 --port 8137 --strictPort", {
    cwd: process.cwd(), shell: true, stdio: "ignore",
  });
  t.after(() => stopProcessTree(server));
  await waitForServer(appUrl);
  const browser = await chromium.launch();
  t.after(async () => browser.close());

  for (const width of [1180, 1016, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 760 } });
    await routeLibraryFixture(page);
    await page.goto(appUrl);
    await openContentLibrary(page);
    await page.getByRole("button", { name: "Gallery" }).click();
    const cards = page.locator(".saved-library-list-gallery .advertisement-card");
    assert.equal(await cards.count(), 2);
    await assertGalleryContained(page, width);
    if (width > 1120) {
      const geometry = await cards.evaluateAll((items) => {
        const [first, second] = items.map((item) => item.getBoundingClientRect());
        return {
          sameRow: Math.abs(first.top - second.top) <= 1,
          separated: first.right <= second.left || second.right <= first.left,
          bothInViewport: [first, second].every((box) => box.left >= -1 && box.right <= window.innerWidth + 1),
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      assert.equal(geometry.sameRow, true);
      assert.equal(geometry.separated, true);
      assert.equal(geometry.bothInViewport, true);
      assert.ok(geometry.documentOverflow <= 1);
    }
    await page.close();
  }
});

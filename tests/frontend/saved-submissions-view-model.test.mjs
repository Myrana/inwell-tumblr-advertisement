import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

async function importViewModel() {
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    return await server.ssrLoadModule("/src/components/savedSubmissionsViewModel.ts");
  } finally {
    await server.close();
  }
}

function makeAd(overrides) {
  return {
    id: overrides.id,
    postType: "text",
    title: overrides.title,
    campaignName: overrides.campaignName || "",
    content: overrides.content || "<p>Ready copy</p>",
    destinationBlog: "allthingsroleplay",
    forumUrl: overrides.forumUrl ?? "https://forum.example/thread",
    tags: overrides.tags || ["wanted"],
    imageCaption: "",
    imageName: "",
    imageDataUrl: "",
    videoUrl: "",
    videoName: "",
    status: "draft",
    updatedAt: overrides.updatedAt,
    archived: overrides.archived || false,
  };
}

test("saved submissions view model keeps displayed and selected counts aligned", async () => {
  const { buildSavedSubmissionsViewModel } = await importViewModel();
  const ads = [
    makeAd({ id: "alpha-ready", title: "Alpha ready", campaignName: "Alpha", updatedAt: "2026-06-20T12:00:00.000Z" }),
    makeAd({ id: "beta-ready", title: "Beta ready", campaignName: "Beta", updatedAt: "2026-06-20T12:05:00.000Z" }),
    makeAd({ id: "alpha-needs-work", title: "Alpha missing link", campaignName: "Alpha", forumUrl: "", tags: [], updatedAt: "2026-06-20T12:10:00.000Z" }),
    makeAd({ id: "archived-ready", title: "Archived ready", campaignName: "Alpha", archived: true, updatedAt: "2026-06-20T12:15:00.000Z" }),
  ];

  const searched = buildSavedSubmissionsViewModel(ads, "all", "active", "updated-desc", ["alpha-ready"], "Beta");
  assert.deepEqual(searched.displayedLibraryAdIds, ["beta-ready"]);
  assert.equal(searched.displayedLibraryCount, 1);
  assert.equal(searched.displayedReadyCount, 1);
  assert.equal(searched.displayedNeedsWorkCount, 0);
  assert.equal(searched.selectedDisplayedCount, 0);
  assert.equal(searched.selectedReadyDraftCount, 0);
  assert.deepEqual(searched.sortedReadyAds.map((ad) => ad.id), ["beta-ready"]);

  const needsWork = buildSavedSubmissionsViewModel(ads, "campaign:Alpha", "active", "updated-desc", ["alpha-needs-work"], "", "needs-work");
  assert.deepEqual(needsWork.displayedLibraryAdIds, ["alpha-needs-work"]);
  assert.equal(needsWork.campaignReadyCount, 1);
  assert.equal(needsWork.campaignNeedsWorkCount, 1);
  assert.equal(needsWork.displayedReadyCount, 0);
  assert.equal(needsWork.displayedNeedsWorkCount, 1);
  assert.equal(needsWork.selectedDisplayedCount, 1);
  assert.equal(needsWork.selectedReadyDraftCount, 0);

  const hiddenSelection = buildSavedSubmissionsViewModel(ads, "campaign:Beta", "active", "updated-desc", ["alpha-ready"], "");
  assert.deepEqual(hiddenSelection.displayedLibraryAdIds, ["beta-ready"]);
  assert.equal(hiddenSelection.selectedDisplayedCount, 0);
  assert.deepEqual(hiddenSelection.sortedReadyAds.map((ad) => ad.id), ["beta-ready"]);
});

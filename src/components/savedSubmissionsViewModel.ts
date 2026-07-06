import { hasLibraryContent } from "../domain/ads";
import { isQueueableAdvertisement } from "../domain/adEligibility";
import { findDuplicateContentMatches, mapDuplicateMatchesByAdId } from "../domain/duplicates";
import { Advertisement } from "../domain/types";

export type LibrarySortMode = "updated-desc" | "campaign-asc" | "campaign-desc";
export type CampaignFilterKey = "all" | "unassigned" | `campaign:${string}`;
export type ArchiveFilter = "active" | "archived" | "all";
export type LibraryViewMode = "comfortable" | "compact" | "gallery";
export type LibraryWorkFilter = "all" | "needs-work";

export function campaignReadinessSummary(campaignAds: Advertisement[]) {
  const activeAds = campaignAds.filter((ad) => !ad.archived);
  const readyCount = activeAds.filter(isQueueableAdvertisement).length;
  const needsWork = activeAds.length - readyCount;
  const archivedCount = campaignAds.length - activeAds.length;
  return `${readyCount} ready - ${needsWork} needs work${archivedCount ? ` - ${archivedCount} archived` : ""}`;
}

export function buildSavedSubmissionsViewModel(
  ads: Advertisement[],
  selectedCampaignKey: CampaignFilterKey,
  archiveFilter: ArchiveFilter,
  sortMode: LibrarySortMode,
  selectedDraftIds: string[] = [],
  searchTerm = "",
  workFilter: LibraryWorkFilter = "all",
) {
  const libraryAds = ads.filter(hasLibraryContent);
  const archivedAds = libraryAds.filter((ad) => ad.archived);
  const activeLibraryAds = libraryAds.filter((ad) => !ad.archived);
  const visibleLibraryAds = archiveFilter === "archived" ? archivedAds : archiveFilter === "all" ? libraryAds : activeLibraryAds;
  const readyAds = visibleLibraryAds.filter(isQueueableAdvertisement);
  const needsWorkCount = visibleLibraryAds.filter((ad) => !ad.archived).length - readyAds.length;
  const selectedCampaignName = selectedCampaignKey.startsWith("campaign:") ? selectedCampaignKey.slice("campaign:".length) : "";
  const selectedCampaignAds = visibleLibraryAds.filter((ad) => {
    const campaignName = ad.campaignName?.trim() || "";
    if (selectedCampaignKey === "all") {
      return true;
    }
    if (selectedCampaignKey === "unassigned") {
      return !campaignName;
    }
    return campaignName === selectedCampaignName;
  });
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const searchedCampaignAds = normalizedSearch
    ? selectedCampaignAds.filter((ad) => {
        const haystack = [
          ad.title,
          ad.campaignName,
          ad.destinationBlog,
          ad.forumUrl,
          ad.content,
          ad.postType,
          ad.status,
          ...ad.tags,
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedSearch);
      })
    : selectedCampaignAds;
  const displayedCampaignAds =
    workFilter === "needs-work"
      ? searchedCampaignAds.filter((ad) => !ad.archived && !isQueueableAdvertisement(ad))
      : searchedCampaignAds;
  const campaignReadyAds = selectedCampaignAds.filter(isQueueableAdvertisement);
  const campaignNeedsWorkCount = selectedCampaignAds.filter((ad) => !ad.archived).length - campaignReadyAds.length;
  const campaignNames = Array.from(new Set(visibleLibraryAds.map((ad) => ad.campaignName?.trim()).filter(Boolean) as string[])).sort((first, second) =>
    first.localeCompare(second, undefined, { sensitivity: "base" }),
  );
  const unassignedAds = visibleLibraryAds.filter((ad) => !ad.campaignName?.trim());
  const selectedCampaignLabel = selectedCampaignKey === "all" ? "All campaigns" : selectedCampaignKey === "unassigned" ? "Unassigned" : selectedCampaignName;
  const duplicateMatches = findDuplicateContentMatches(selectedCampaignAds);
  const duplicateMatchesByAdId = mapDuplicateMatchesByAdId(duplicateMatches);
  const duplicateItemCount = duplicateMatches.reduce((total, match) => total + match.adIds.length, 0);
  const sortedLibraryAds = [...displayedCampaignAds].sort((first, second) => {
    if (sortMode === "updated-desc") {
      return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
    }

    const firstCampaign = first.campaignName?.trim() || "";
    const secondCampaign = second.campaignName?.trim() || "";
    if (!firstCampaign || !secondCampaign) {
      return firstCampaign ? -1 : secondCampaign ? 1 : (first.title || "").localeCompare(second.title || "", undefined, { sensitivity: "base" });
    }

    const campaignComparison = firstCampaign.localeCompare(secondCampaign, undefined, { sensitivity: "base" });
    const titleComparison = (first.title || "").localeCompare(second.title || "", undefined, { sensitivity: "base" });

    return sortMode === "campaign-asc" ? campaignComparison || titleComparison : -campaignComparison || titleComparison;
  });
  const sortedReadyAds = sortedLibraryAds.filter(isQueueableAdvertisement);
  const displayedReadyCount = sortedReadyAds.length;
  const displayedNeedsWorkCount = sortedLibraryAds.filter((ad) => !ad.archived).length - displayedReadyCount;
  const queueableAdIds = new Set(sortedReadyAds.map((ad) => ad.id));
  const displayedLibraryAdIds = sortedLibraryAds.map((ad) => ad.id);
  const selectedLibraryAdIds = new Set(displayedLibraryAdIds);
  const selectedLibraryCount = selectedDraftIds.filter((id) => selectedLibraryAdIds.has(id)).length;
  const selectedReadyDrafts = sortedReadyAds.filter((ad) => selectedDraftIds.includes(ad.id));
  const selectedReadyDraftCount = selectedReadyDrafts.length;

  return {
    activeLibraryAds,
    archivedAds,
    campaignNeedsWorkCount,
    campaignNames,
    campaignReadyCount: campaignReadyAds.length,
    duplicateItemCount,
    duplicateMatches,
    duplicateMatchesByAdId,
    displayedLibraryAdIds,
    displayedLibraryCount: sortedLibraryAds.length,
    displayedNeedsWorkCount,
    displayedReadyCount,
    libraryAds,
    needsWorkCount,
    queueableAdIds,
    readyAds,
    selectedCampaignAds,
    searchTerm: normalizedSearch,
    selectedCampaignLabel,
    selectedDisplayedCount: selectedLibraryCount,
    selectedReadyDraftCount,
    selectedReadyDrafts,
    sortedLibraryAds,
    sortedReadyAds,
    unassignedAds,
    visibleLibraryAds,
  };
}

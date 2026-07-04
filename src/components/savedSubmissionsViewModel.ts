import { hasLibraryContent } from "../domain/ads";
import { isQueueableAdvertisement } from "../domain/adEligibility";
import { findDuplicateContentMatches, mapDuplicateMatchesByAdId } from "../domain/duplicates";
import { Advertisement } from "../domain/types";

export type LibrarySortMode = "updated-desc" | "campaign-asc" | "campaign-desc";
export type CampaignFilterKey = "all" | "unassigned" | `campaign:${string}`;
export type ArchiveFilter = "active" | "archived" | "all";

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
  const selectedReadyAds = selectedCampaignAds.filter(isQueueableAdvertisement);
  const selectedNeedsWorkCount = selectedCampaignAds.filter((ad) => !ad.archived).length - selectedReadyAds.length;
  const campaignNames = Array.from(new Set(visibleLibraryAds.map((ad) => ad.campaignName?.trim()).filter(Boolean) as string[])).sort((first, second) =>
    first.localeCompare(second, undefined, { sensitivity: "base" }),
  );
  const unassignedAds = visibleLibraryAds.filter((ad) => !ad.campaignName?.trim());
  const selectedCampaignLabel = selectedCampaignKey === "all" ? "All campaigns" : selectedCampaignKey === "unassigned" ? "Unassigned" : selectedCampaignName;
  const duplicateMatches = findDuplicateContentMatches(selectedCampaignAds);
  const duplicateMatchesByAdId = mapDuplicateMatchesByAdId(duplicateMatches);
  const duplicateItemCount = duplicateMatches.reduce((total, match) => total + match.adIds.length, 0);
  const sortedLibraryAds = [...selectedCampaignAds].sort((first, second) => {
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
  const queueableAdIds = new Set(sortedReadyAds.map((ad) => ad.id));
  const selectedLibraryAdIds = new Set(selectedCampaignAds.map((ad) => ad.id));
  const selectedLibraryCount = selectedDraftIds.filter((id) => selectedLibraryAdIds.has(id)).length;
  const selectedReadyDrafts = sortedReadyAds.filter((ad) => selectedDraftIds.includes(ad.id));
  const batchQueueDrafts = selectedDraftIds.length > 0 ? selectedReadyDrafts : sortedReadyAds;

  return {
    activeLibraryAds,
    archivedAds,
    campaignNames,
    duplicateItemCount,
    duplicateMatches,
    duplicateMatchesByAdId,
    libraryAds,
    needsWorkCount,
    batchQueueDrafts,
    queueableAdIds,
    readyAds,
    selectedCampaignAds,
    selectedCampaignLabel,
    selectedLibraryCount,
    selectedNeedsWorkCount,
    selectedReadyAds,
    sortedLibraryAds,
    sortedReadyAds,
    unassignedAds,
    visibleLibraryAds,
  };
}

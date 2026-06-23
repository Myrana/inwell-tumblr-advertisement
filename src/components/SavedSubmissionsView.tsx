import { AlertTriangle, Archive, FilePlus2, Link, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { hasLibraryContent } from "../domain/ads";
import { findDuplicateContentMatches, mapDuplicateMatchesByAdId } from "../domain/duplicates";
import { formatDate, formatStatus } from "../domain/format";
import { scoreDraftReadiness, validateAdvertisement } from "../domain/post";
import { Advertisement, QueueDefinition } from "../domain/types";

type LibrarySortMode = "updated-desc" | "campaign-asc" | "campaign-desc";
type CampaignFilterKey = "all" | "unassigned" | `campaign:${string}`;

type SavedSubmissionsViewProps = {
  activeAdId: string;
  ads: Advertisement[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  onDeleteDraft: (id: string) => void;
  onCreateDraft: () => void;
  onQueueDraft: (id: string, queueName: string) => void;
  onSelectDraft: (id: string) => void;
};

export function SavedSubmissionsView({
  activeAdId,
  ads,
  activeQueueName,
  queueOptions,
  onDeleteDraft,
  onCreateDraft,
  onQueueDraft,
  onSelectDraft,
}: SavedSubmissionsViewProps) {
  const libraryAds = ads.filter(hasLibraryContent);
  const readyAds = libraryAds.filter((ad) => validateAdvertisement(ad).length === 0);
  const needsWorkCount = libraryAds.length - readyAds.length;
  const [selectedCampaignKey, setSelectedCampaignKey] = useState<CampaignFilterKey>("all");
  const selectedCampaignName = selectedCampaignKey.startsWith("campaign:") ? selectedCampaignKey.slice("campaign:".length) : "";
  const selectedCampaignAds = libraryAds.filter((ad) => {
    const campaignName = ad.campaignName?.trim() || "";
    if (selectedCampaignKey === "all") {
      return true;
    }
    if (selectedCampaignKey === "unassigned") {
      return !campaignName;
    }
    return campaignName === selectedCampaignName;
  });
  const selectedReadyAds = selectedCampaignAds.filter((ad) => validateAdvertisement(ad).length === 0);
  const selectedNeedsWorkCount = selectedCampaignAds.length - selectedReadyAds.length;
  const campaignNames = Array.from(new Set(libraryAds.map((ad) => ad.campaignName?.trim()).filter(Boolean) as string[])).sort((first, second) =>
    first.localeCompare(second, undefined, { sensitivity: "base" }),
  );
  const unassignedAds = libraryAds.filter((ad) => !ad.campaignName?.trim());
  const selectedCampaignLabel =
    selectedCampaignKey === "all" ? "All campaigns" : selectedCampaignKey === "unassigned" ? "Unassigned" : selectedCampaignName;
  const duplicateMatches = findDuplicateContentMatches(selectedCampaignAds);
  const duplicateMatchesByAdId = mapDuplicateMatchesByAdId(duplicateMatches);
  const duplicateItemCount = duplicateMatches.reduce((total, match) => total + match.adIds.length, 0);
  const [queuePickerAdId, setQueuePickerAdId] = useState("");
  const [selectedQueueName, setSelectedQueueName] = useState(activeQueueName);
  const [batchQueueName, setBatchQueueName] = useState(activeQueueName || queueOptions[0]?.name || "");
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<LibrarySortMode>("updated-desc");
  const selectedLibraryCount = selectedDraftIds.filter((id) => selectedCampaignAds.some((ad) => ad.id === id)).length;
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
  const sortedReadyAds = sortedLibraryAds.filter((ad) => validateAdvertisement(ad).length === 0);

  function toggleDraftSelection(adId: string, selected: boolean) {
    setSelectedDraftIds((current) => (selected ? Array.from(new Set([...current, adId])) : current.filter((id) => id !== adId)));
  }

  function startQueue(adId: string) {
    if (queueOptions.length > 1) {
      setQueuePickerAdId(adId);
      setSelectedQueueName(activeQueueName || queueOptions[0]?.name || "");
      return;
    }

    onQueueDraft(adId, activeQueueName || queueOptions[0]?.name || "");
  }

  function queueReadyDrafts() {
    const queueName = batchQueueName || activeQueueName || queueOptions[0]?.name || "";
    sortedReadyAds.forEach((ad) => onQueueDraft(ad.id, queueName));
  }

  function campaignReadinessSummary(campaignAds: Advertisement[]) {
    const readyCount = campaignAds.filter((ad) => validateAdvertisement(ad).length === 0).length;
    const needsWork = campaignAds.length - readyCount;
    return `${readyCount} ready - ${needsWork} needs work`;
  }

  return (
    <section className="draft-table" aria-label="Content library">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">Advertisement Library</span>
          <h2>Content library</h2>
          <p>Browse the archive, check readiness, and queue finished ads without digging through drafts.</p>
        </div>
        <Archive size={18} />
      </div>
      {libraryAds.length ? (
        <div className="batch-prep-panel" aria-label="Batch prep assistant">
          <div>
            <strong>Batch prep assistant</strong>
            <span>
              {selectedCampaignLabel}: {selectedReadyAds.length} ready to queue - {selectedNeedsWorkCount} need edits
            </span>
            {selectedCampaignKey !== "all" ? <span>All saved: {readyAds.length} ready - {needsWorkCount} need edits</span> : null}
            {duplicateMatches.length ? (
              <span className="duplicate-check-summary" aria-label="Duplicate content check">
                <AlertTriangle size={14} />
                {duplicateItemCount} possible duplicates in {duplicateMatches.length} group{duplicateMatches.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <label>
            Batch queue destination
            <select value={batchQueueName} onChange={(event) => setBatchQueueName(event.target.value)}>
              {queueOptions.map((queue) => (
                <option key={queue.id} value={queue.name}>
                  {queue.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary compact-button" type="button" onClick={queueReadyDrafts} disabled={!selectedReadyAds.length || !batchQueueName}>
            <Send size={16} />
            {selectedCampaignKey === "all" ? "Queue ready drafts" : "Queue ready campaign"}
          </button>
        </div>
      ) : null}
      {libraryAds.length ? (
        <div className="campaign-library-layout">
          <aside className="campaign-filter-panel" aria-label="Campaign library">
            <strong>Campaigns</strong>
            <button
              className={selectedCampaignKey === "all" ? "campaign-filter-button active" : "campaign-filter-button"}
              type="button"
              onClick={() => setSelectedCampaignKey("all")}
            >
              <span>All campaigns</span>
              <small>{campaignReadinessSummary(libraryAds)}</small>
            </button>
            <button
              className={selectedCampaignKey === "unassigned" ? "campaign-filter-button active" : "campaign-filter-button"}
              type="button"
              onClick={() => setSelectedCampaignKey("unassigned")}
            >
              <span>Unassigned</span>
              <small>{campaignReadinessSummary(unassignedAds)}</small>
            </button>
            {campaignNames.map((campaignName) => {
              const campaignKey: CampaignFilterKey = `campaign:${campaignName}`;
              const campaignAds = libraryAds.filter((ad) => ad.campaignName?.trim() === campaignName);
              return (
                <button
                  className={selectedCampaignKey === campaignKey ? "campaign-filter-button active" : "campaign-filter-button"}
                  key={campaignName}
                  type="button"
                  onClick={() => setSelectedCampaignKey(campaignKey)}
                >
                  <span>{campaignName}</span>
                  <small>{campaignReadinessSummary(campaignAds)}</small>
                </button>
              );
            })}
          </aside>
          <div className="campaign-library-results">
            <div className="bulk-edit-panel sort-panel" aria-label="Saved sorting controls">
              <label className="bulk-select">
                <input
                  checked={selectedCampaignAds.length > 0 && selectedLibraryCount === selectedCampaignAds.length}
                  type="checkbox"
                  onChange={(event) => setSelectedDraftIds(event.target.checked ? sortedLibraryAds.map((ad) => ad.id) : [])}
                />
                Select all visible items
              </label>
              <label>
                Sort library
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as LibrarySortMode)}>
                  <option value="updated-desc">Newest first</option>
                  <option value="campaign-asc">A-Z</option>
                  <option value="campaign-desc">Z-A</option>
                </select>
              </label>
            </div>
            {libraryAds.length && !sortedLibraryAds.length ? (
              <div className="library-empty campaign-empty">
                <strong>No ads in {selectedCampaignLabel}.</strong>
                <span>Choose another campaign or assign a campaign from the editor.</span>
              </div>
            ) : null}
            {sortedLibraryAds.map((ad) => {
              const duplicateMatch = duplicateMatchesByAdId.get(ad.id);
              const duplicatePeerNames = duplicateMatch?.labels.filter((label, index) => duplicateMatch.adIds[index] !== ad.id) ?? [];
              const readiness = scoreDraftReadiness(ad);

              return (
                <article className={ad.id === activeAdId ? "draft-row advertisement-card selected" : "draft-row advertisement-card"} key={ad.id}>
            <label className="bulk-select row-select draft-card-select" aria-label="Select saved item">
              <input
                checked={selectedDraftIds.includes(ad.id)}
                type="checkbox"
                onChange={(event) => toggleDraftSelection(ad.id, event.target.checked)}
              />
              Select
            </label>
            <div className="draft-card-media" aria-hidden="true">
              {ad.imageDataUrl ? (
                <img src={ad.imageDataUrl} alt="" />
              ) : (
                <span>{(ad.title || "Inkwell").slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="draft-row-summary">
              <div className="draft-card-header">
                <div className="draft-card-title-group">
                  <span className="draft-card-kicker">Saved advertisement</span>
                  <div className="draft-card-title-row">
                    <strong className="draft-card-title">{ad.title || "Untitled advertisement"}</strong>
                  </div>
                </div>
              </div>
              <div className="draft-row-meta">
                {duplicateMatch ? (
                  <span className="duplicate-pill" title={`Matches ${duplicatePeerNames.join(", ")}`}>
                    <AlertTriangle size={14} />
                    <b>Possible duplicate</b>
                    {duplicatePeerNames[0] || "Saved submission"}
                  </span>
                ) : null}
                <span><b>Type</b>{ad.postType}</span>
                <span><b>Status</b>{formatStatus(ad.status)}</span>
                <span className={readiness.percent === 100 ? "readiness-pill ready" : "readiness-pill"}>
                  <b>Readiness</b>{readiness.label}
                </span>
                {ad.campaignName ? <span><b>Campaign</b>{ad.campaignName}</span> : null}
                <span><b>Target</b>{ad.destinationBlog || "No target"}</span>
                <span><b>Updated</b>{formatDate(ad.updatedAt)}</span>
              </div>
            </div>
            <div className="draft-row-actions">
              <a href={ad.forumUrl || "#"} aria-label="Forum URL">
                <Link size={18} />
              </a>
              <button className="secondary compact-button" type="button" onClick={() => startQueue(ad.id)}>
                <Send size={16} />
                Queue
              </button>
              <button className="secondary compact-button" type="button" onClick={() => onSelectDraft(ad.id)}>
                Edit
              </button>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => onDeleteDraft(ad.id)}
              aria-label="Delete content library item"
              title="Delete content library item"
            >
              <Trash2 size={18} />
            </button>
            {queuePickerAdId === ad.id ? (
              <form
                className="content-queue-picker"
                aria-label={`Choose queue for ${ad.title || "content library item"}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  onQueueDraft(ad.id, selectedQueueName);
                }}
              >
                <label>
                  Queue destination
                  <select value={selectedQueueName} onChange={(event) => setSelectedQueueName(event.target.value)}>
                    {queueOptions.map((queue) => (
                      <option key={queue.id} value={queue.name}>
                        {queue.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary compact-button" type="submit">
                  Queue here
                </button>
              </form>
            ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="library-empty">
          <strong>Your notebook is empty.</strong>
          <span>No content saved yet. Create your first advertisement and begin building your archive.</span>
          <button className="primary compact-button" type="button" onClick={onCreateDraft}>
            <FilePlus2 size={16} />
            Create advertisement
          </button>
        </div>
      )}
    </section>
  );
}

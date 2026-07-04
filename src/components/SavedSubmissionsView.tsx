import { AlertTriangle, Archive, FilePlus2, Send } from "lucide-react";
import { useState } from "react";
import { SavedSubmissionsList } from "./SavedSubmissionsList";
import {
  ArchiveFilter,
  CampaignFilterKey,
  LibrarySortMode,
  buildSavedSubmissionsViewModel,
  campaignReadinessSummary,
} from "./savedSubmissionsViewModel";
import { DuplicateContentMatch } from "../domain/duplicates";
import { Advertisement, QueueDefinition } from "../domain/types";

type SavedSubmissionsViewProps = {
  activeAdId: string;
  ads: Advertisement[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  onDeleteDraft: (id: string) => void;
  onCreateDraft: () => void;
  onArchiveDraft: (id: string, archived: boolean) => void;
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
  onArchiveDraft,
  onQueueDraft,
  onSelectDraft,
}: SavedSubmissionsViewProps) {
  const [selectedCampaignKey, setSelectedCampaignKey] = useState<CampaignFilterKey>("all");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("active");
  const [queuePickerAdId, setQueuePickerAdId] = useState("");
  const [selectedQueueName, setSelectedQueueName] = useState(activeQueueName);
  const [batchQueueName, setBatchQueueName] = useState(activeQueueName || queueOptions[0]?.name || "");
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<LibrarySortMode>("updated-desc");
  const {
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
    unassignedAds,
    visibleLibraryAds,
  } = buildSavedSubmissionsViewModel(ads, selectedCampaignKey, archiveFilter, sortMode, selectedDraftIds);

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
    batchQueueDrafts.forEach((ad) => onQueueDraft(ad.id, queueName));
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
          <button className="primary compact-button" type="button" onClick={queueReadyDrafts} disabled={!batchQueueDrafts.length || !batchQueueName}>
            <Send size={16} />
            {selectedCampaignKey === "all" ? "Queue ready drafts" : "Queue ready campaign"}
          </button>
        </div>
      ) : null}
      {libraryAds.length ? (
        <div className="campaign-library-layout">
          <CampaignLibraryFilters
            activeLibraryCount={activeLibraryAds.length}
            archiveFilter={archiveFilter}
            archivedCount={archivedAds.length}
            campaignNames={campaignNames}
            libraryAds={libraryAds}
            selectedCampaignKey={selectedCampaignKey}
            unassignedAds={unassignedAds}
            visibleLibraryAds={visibleLibraryAds}
            onArchiveFilterChange={setArchiveFilter}
            onCampaignFilterChange={setSelectedCampaignKey}
          />
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
            <DuplicateReviewPanel
              duplicateItemCount={duplicateItemCount}
              duplicateMatches={duplicateMatches}
              onArchiveDraft={onArchiveDraft}
              onSelectDraft={onSelectDraft}
            />
            {libraryAds.length && !sortedLibraryAds.length ? (
              <div className="library-empty campaign-empty">
                <strong>No ads in {selectedCampaignLabel}.</strong>
                <span>Choose another campaign, switch the archive filter, or assign a campaign from the editor.</span>
              </div>
            ) : null}
            <SavedSubmissionsList
              activeAdId={activeAdId}
              ads={sortedLibraryAds}
              duplicateMatchesByAdId={duplicateMatchesByAdId}
              queueableAdIds={queueableAdIds}
              queueOptions={queueOptions}
              queuePickerAdId={queuePickerAdId}
              selectedDraftIds={selectedDraftIds}
              selectedQueueName={selectedQueueName}
              onArchiveDraft={onArchiveDraft}
              onDeleteDraft={onDeleteDraft}
              onQueueDraft={onQueueDraft}
              onSelectDraft={onSelectDraft}
              onSelectedQueueNameChange={setSelectedQueueName}
              onStartQueue={startQueue}
              onToggleDraftSelection={toggleDraftSelection}
            />
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

type CampaignLibraryFiltersProps = {
  activeLibraryCount: number;
  archiveFilter: ArchiveFilter;
  archivedCount: number;
  campaignNames: string[];
  libraryAds: Advertisement[];
  selectedCampaignKey: CampaignFilterKey;
  unassignedAds: Advertisement[];
  visibleLibraryAds: Advertisement[];
  onArchiveFilterChange: (filter: ArchiveFilter) => void;
  onCampaignFilterChange: (filter: CampaignFilterKey) => void;
};

function CampaignLibraryFilters({
  activeLibraryCount,
  archiveFilter,
  archivedCount,
  campaignNames,
  libraryAds,
  selectedCampaignKey,
  unassignedAds,
  visibleLibraryAds,
  onArchiveFilterChange,
  onCampaignFilterChange,
}: CampaignLibraryFiltersProps) {
  return (
    <aside className="campaign-filter-panel" aria-label="Campaign library">
      <strong>Library state</strong>
      <button className={archiveFilter === "active" ? "campaign-filter-button active" : "campaign-filter-button"} type="button" onClick={() => onArchiveFilterChange("active")}>
        <span>Active</span>
        <small>{activeLibraryCount} visible</small>
      </button>
      <button className={archiveFilter === "archived" ? "campaign-filter-button active" : "campaign-filter-button"} type="button" onClick={() => onArchiveFilterChange("archived")}>
        <span>Archived</span>
        <small>{archivedCount} hidden</small>
      </button>
      <button className={archiveFilter === "all" ? "campaign-filter-button active" : "campaign-filter-button"} type="button" onClick={() => onArchiveFilterChange("all")}>
        <span>All saved</span>
        <small>{libraryAds.length} total</small>
      </button>
      <strong>Campaigns</strong>
      <button
        className={selectedCampaignKey === "all" ? "campaign-filter-button active" : "campaign-filter-button"}
        type="button"
        onClick={() => onCampaignFilterChange("all")}
      >
        <span>All campaigns</span>
        <small>{campaignReadinessSummary(libraryAds)}</small>
      </button>
      <button
        className={selectedCampaignKey === "unassigned" ? "campaign-filter-button active" : "campaign-filter-button"}
        type="button"
        onClick={() => onCampaignFilterChange("unassigned")}
      >
        <span>Unassigned</span>
        <small>{campaignReadinessSummary(unassignedAds)}</small>
      </button>
      {campaignNames.map((campaignName) => {
        const campaignKey: CampaignFilterKey = `campaign:${campaignName}`;
        const campaignAds = visibleLibraryAds.filter((ad) => ad.campaignName?.trim() === campaignName);
        return (
          <button
            className={selectedCampaignKey === campaignKey ? "campaign-filter-button active" : "campaign-filter-button"}
            key={campaignName}
            type="button"
            onClick={() => onCampaignFilterChange(campaignKey)}
          >
            <span>{campaignName}</span>
            <small>{campaignReadinessSummary(campaignAds)}</small>
          </button>
        );
      })}
    </aside>
  );
}

type DuplicateReviewPanelProps = {
  duplicateItemCount: number;
  duplicateMatches: DuplicateContentMatch[];
  onArchiveDraft: (id: string, archived: boolean) => void;
  onSelectDraft: (id: string) => void;
};

function DuplicateReviewPanel({ duplicateItemCount, duplicateMatches, onArchiveDraft, onSelectDraft }: DuplicateReviewPanelProps) {
  if (!duplicateMatches.length) {
    return null;
  }

  return (
    <div className="duplicate-review-panel" aria-label="Duplicate review workflow">
      <div>
        <strong>Duplicate review</strong>
        <span>{duplicateItemCount} saved ads need a keep, edit, or archive decision.</span>
      </div>
      {duplicateMatches.slice(0, 3).map((match) => {
        const firstAdId = match.adIds[0] || "";
        const lastAdId = match.adIds[match.adIds.length - 1] || "";
        return (
          <article key={match.groupKey}>
            <span>{match.labels.join(" / ")}</span>
            <div>
              <button className="secondary compact-button" type="button" onClick={() => onSelectDraft(firstAdId)} disabled={!firstAdId}>
                Edit first
              </button>
              <button className="secondary compact-button" type="button" onClick={() => onArchiveDraft(lastAdId, true)} disabled={!lastAdId}>
                Archive latest
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

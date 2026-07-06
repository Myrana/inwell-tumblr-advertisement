import { AlertTriangle, Archive, FilePlus2, GalleryHorizontal, Layers3, List, Search, Send } from "lucide-react";
import { useState } from "react";
import { SavedSubmissionsList } from "./SavedSubmissionsList";
import {
  ArchiveFilter,
  CampaignFilterKey,
  LibrarySortMode,
  LibraryViewMode,
  LibraryWorkFilter,
  buildSavedSubmissionsViewModel,
  campaignReadinessSummary,
} from "./savedSubmissionsViewModel";
import { DuplicateContentMatch } from "../domain/duplicates";
import { Advertisement, QueueDefinition } from "../domain/types";
import "./savedSubmissionsView.css";

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
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<LibraryViewMode>("comfortable");
  const [workFilter, setWorkFilter] = useState<LibraryWorkFilter>("all");
  const {
    activeLibraryAds,
    archivedAds,
    campaignNames,
    duplicateItemCount,
    duplicateMatches,
    duplicateMatchesByAdId,
    displayedLibraryAdIds,
    displayedLibraryCount,
    displayedNeedsWorkCount,
    displayedReadyCount,
    libraryAds,
    needsWorkCount,
    queueableAdIds,
    readyAds,
    selectedCampaignLabel,
    selectedDisplayedCount,
    selectedReadyDraftCount,
    selectedReadyDrafts,
    sortedLibraryAds,
    sortedReadyAds,
    unassignedAds,
    visibleLibraryAds,
    searchTerm: normalizedSearchTerm,
  } = buildSavedSubmissionsViewModel(ads, selectedCampaignKey, archiveFilter, sortMode, selectedDraftIds, searchTerm, workFilter);
  const selectedQueueableCount = selectedReadyDraftCount;

  function toggleDraftSelection(adId: string, selected: boolean) {
    setSelectedDraftIds((current) => (selected ? Array.from(new Set([...current, adId])) : current.filter((id) => id !== adId)));
  }

  function reviewIncompleteAds() {
    setArchiveFilter("active");
    setSelectedCampaignKey("all");
    setSearchTerm("");
    setWorkFilter("needs-work");
    setSelectedDraftIds([]);
  }

  function startQueue(adId: string) {
    if (queueOptions.length > 1) {
      setQueuePickerAdId(adId);
      setSelectedQueueName(activeQueueName || queueOptions[0]?.name || "");
      return;
    }

    onQueueDraft(adId, activeQueueName || queueOptions[0]?.name || "");
  }

  function queueDrafts(drafts: Advertisement[]) {
    const queueName = batchQueueName || activeQueueName || queueOptions[0]?.name || "";
    drafts.forEach((ad) => onQueueDraft(ad.id, queueName));
  }

  function queueDisplayedReadyDrafts() {
    queueDrafts(sortedReadyAds);
  }

  function queueSelectedReadyDrafts() {
    queueDrafts(selectedReadyDrafts);
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
      <LibraryCommandCenter
        activeCount={activeLibraryAds.length}
        archivedCount={archivedAds.length}
        campaignCount={campaignNames.length}
        displayedCount={displayedLibraryCount}
        displayedReadyCount={displayedReadyCount}
        hasQueueDestination={Boolean(batchQueueName)}
        needsWorkCount={needsWorkCount}
        readyCount={readyAds.length}
        selectedCampaignLabel={selectedCampaignLabel}
        onCreateDraft={onCreateDraft}
        onQueueDisplayedReadyDrafts={queueDisplayedReadyDrafts}
        onReviewIncompleteAds={reviewIncompleteAds}
      />
      {libraryAds.length ? (
        <div className="batch-prep-panel" aria-label="Batch prep assistant">
          <div>
            <Layers3 size={18} />
            <strong>Batch prep assistant</strong>
            <span>
              {selectedCampaignLabel}: {displayedReadyCount} ready to queue - {displayedNeedsWorkCount} need edits
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
          <button className="primary compact-button" type="button" onClick={queueDisplayedReadyDrafts} disabled={!sortedReadyAds.length || !batchQueueName}>
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
            <div className="library-search-toolbar" aria-label="Library search and view options">
              <label className="library-search-field">
                <Search size={16} />
                <span>Search saved advertisements</span>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  onInput={(event) => setSearchTerm(event.currentTarget.value)}
                  placeholder="Search title, blog, campaign, tags, or copy"
                />
              </label>
              <div className="library-view-toggle" role="group" aria-label="Library view mode">
                <button className={viewMode === "comfortable" ? "active" : ""} type="button" onClick={() => setViewMode("comfortable")}>
                  <Layers3 size={16} />
                  Comfortable
                </button>
                <button className={viewMode === "compact" ? "active" : ""} type="button" onClick={() => setViewMode("compact")}>
                  <List size={16} />
                  Compact
                </button>
                <button className={viewMode === "gallery" ? "active" : ""} type="button" onClick={() => setViewMode("gallery")}>
                  <GalleryHorizontal size={16} />
                  Gallery
                </button>
              </div>
            </div>
            {workFilter === "needs-work" ? (
              <div className="library-filter-notice" role="status">
                <span>Showing advertisements that need edits.</span>
                <button className="secondary compact-button" type="button" onClick={() => setWorkFilter("all")}>
                  Show all
                </button>
              </div>
            ) : null}
            <LibrarySelectionToolbar
              queueName={batchQueueName}
              selectedCount={selectedDisplayedCount}
              selectedReadyCount={selectedQueueableCount}
              onClearSelection={() => setSelectedDraftIds([])}
              onQueueSelectedReadyDrafts={queueSelectedReadyDrafts}
            />
            <div className="bulk-edit-panel sort-panel" aria-label="Saved sorting controls">
              <label className="bulk-select">
                <input
                  checked={displayedLibraryCount > 0 && selectedDisplayedCount === displayedLibraryCount}
                  type="checkbox"
                  onChange={(event) => setSelectedDraftIds(event.target.checked ? displayedLibraryAdIds : [])}
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
                <strong>{normalizedSearchTerm ? "No advertisements match that search." : workFilter === "needs-work" ? "No incomplete advertisements are visible." : `No ads in ${selectedCampaignLabel}.`}</strong>
                <span>{normalizedSearchTerm ? "Search title, Tumblr blog, campaign, tags, or copy, then clear the field to return to the full library." : workFilter === "needs-work" ? "Clear the review filter to return to the full library." : "Choose another campaign, switch the archive filter, or assign a campaign from the editor."}</span>
              </div>
            ) : null}
            <div className={`saved-library-list saved-library-list-${viewMode}`}>
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

type LibraryCommandCenterProps = {
  activeCount: number;
  archivedCount: number;
  campaignCount: number;
  displayedCount: number;
  displayedReadyCount: number;
  hasQueueDestination: boolean;
  needsWorkCount: number;
  readyCount: number;
  selectedCampaignLabel: string;
  onCreateDraft: () => void;
  onQueueDisplayedReadyDrafts: () => void;
  onReviewIncompleteAds: () => void;
};

function LibraryCommandCenter({
  activeCount,
  archivedCount,
  campaignCount,
  displayedCount,
  displayedReadyCount,
  hasQueueDestination,
  needsWorkCount,
  readyCount,
  selectedCampaignLabel,
  onCreateDraft,
  onQueueDisplayedReadyDrafts,
  onReviewIncompleteAds,
}: LibraryCommandCenterProps) {
  return (
    <section className="library-command-center" aria-label="Library command center">
      <div>
        <span>Library command center</span>
        <h3>
          {readyCount} ready, {needsWorkCount} need edits, {archivedCount} archived.
        </h3>
        <p>
          {selectedCampaignLabel}: {displayedReadyCount} ready to queue from {displayedCount} visible item{displayedCount === 1 ? "" : "s"}.
        </p>
      </div>
      <div className="library-command-stats" aria-label="Library summary">
        <article>
          <strong>{activeCount}</strong>
          <span>Active</span>
        </article>
        <article>
          <strong>{readyCount}</strong>
          <span>Ready</span>
        </article>
        <article>
          <strong>{campaignCount || "0"}</strong>
          <span>Campaigns</span>
        </article>
      </div>
      <div className="library-command-actions">
        <button className="secondary compact-button" type="button" onClick={onReviewIncompleteAds} disabled={!needsWorkCount}>
          <AlertTriangle size={16} />
          Review Incomplete
        </button>
        <button className="primary compact-button" type="button" onClick={onQueueDisplayedReadyDrafts} disabled={!displayedReadyCount || !hasQueueDestination}>
          <Send size={16} />
          Queue All Ready
        </button>
        <button className="secondary compact-button" type="button" onClick={onCreateDraft}>
          <FilePlus2 size={16} />
          Create New Advertisement
        </button>
      </div>
    </section>
  );
}

type LibrarySelectionToolbarProps = {
  queueName: string;
  selectedCount: number;
  selectedReadyCount: number;
  onClearSelection: () => void;
  onQueueSelectedReadyDrafts: () => void;
};

function LibrarySelectionToolbar({
  queueName,
  selectedCount,
  selectedReadyCount,
  onClearSelection,
  onQueueSelectedReadyDrafts,
}: LibrarySelectionToolbarProps) {
  if (!selectedCount) {
    return null;
  }

  return (
    <div className="library-selection-toolbar" aria-label="Selected library actions">
      <strong>{selectedCount} selected</strong>
      <span>{selectedReadyCount} ready for {queueName || "the selected queue"}</span>
      <button className="primary compact-button" type="button" onClick={onQueueSelectedReadyDrafts} disabled={!selectedReadyCount || !queueName}>
        <Send size={16} />
        Queue selected ready
      </button>
      <button className="secondary compact-button" type="button" onClick={onClearSelection}>
        Clear selection
      </button>
    </div>
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
        <span><Archive size={14} /> Active <b>{activeLibraryCount}</b></span>
        <small>{activeLibraryCount} visible</small>
      </button>
      <button className={archiveFilter === "archived" ? "campaign-filter-button active" : "campaign-filter-button"} type="button" onClick={() => onArchiveFilterChange("archived")}>
        <span><Archive size={14} /> Archived <b>{archivedCount}</b></span>
        <small>{archivedCount} hidden</small>
      </button>
      <button className={archiveFilter === "all" ? "campaign-filter-button active" : "campaign-filter-button"} type="button" onClick={() => onArchiveFilterChange("all")}>
        <span><Layers3 size={14} /> All saved <b>{libraryAds.length}</b></span>
        <small>{libraryAds.length} total</small>
      </button>
      <strong>Campaigns</strong>
      <button
        className={selectedCampaignKey === "all" ? "campaign-filter-button active" : "campaign-filter-button"}
        type="button"
        onClick={() => onCampaignFilterChange("all")}
      >
        <span><Layers3 size={14} /> All campaigns <b>{libraryAds.length}</b></span>
        <small>{campaignReadinessSummary(libraryAds)}</small>
      </button>
      <button
        className={selectedCampaignKey === "unassigned" ? "campaign-filter-button active" : "campaign-filter-button"}
        type="button"
        onClick={() => onCampaignFilterChange("unassigned")}
      >
        <span><FilePlus2 size={14} /> Unassigned <b>{unassignedAds.length}</b></span>
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
            <span><Layers3 size={14} /> {campaignName} <b>{campaignAds.length}</b></span>
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

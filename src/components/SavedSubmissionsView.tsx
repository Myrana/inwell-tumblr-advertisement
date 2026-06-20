import { AlertTriangle, Archive, Link, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { hasLibraryContent } from "../domain/ads";
import { findDuplicateContentMatches, mapDuplicateMatchesByAdId } from "../domain/duplicates";
import { formatDate, formatStatus } from "../domain/format";
import { validateAdvertisement } from "../domain/post";
import { Advertisement, QueueDefinition } from "../domain/types";

type SavedSubmissionsViewProps = {
  activeAdId: string;
  ads: Advertisement[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  onDeleteDraft: (id: string) => void;
  onBulkUpdateDrafts: (ids: string[], patch: { campaignName?: string; tag?: string }) => void;
  onQueueDraft: (id: string, queueName: string) => void;
  onSelectDraft: (id: string) => void;
};

export function SavedSubmissionsView({
  activeAdId,
  ads,
  activeQueueName,
  queueOptions,
  onDeleteDraft,
  onBulkUpdateDrafts,
  onQueueDraft,
  onSelectDraft,
}: SavedSubmissionsViewProps) {
  const libraryAds = ads.filter(hasLibraryContent);
  const readyAds = libraryAds.filter((ad) => validateAdvertisement(ad).length === 0);
  const needsWorkCount = libraryAds.length - readyAds.length;
  const duplicateMatches = findDuplicateContentMatches(libraryAds);
  const duplicateMatchesByAdId = mapDuplicateMatchesByAdId(duplicateMatches);
  const duplicateItemCount = duplicateMatches.reduce((total, match) => total + match.adIds.length, 0);
  const [queuePickerAdId, setQueuePickerAdId] = useState("");
  const [selectedQueueName, setSelectedQueueName] = useState(activeQueueName);
  const [batchQueueName, setBatchQueueName] = useState(activeQueueName || queueOptions[0]?.name || "");
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [bulkCampaignName, setBulkCampaignName] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const selectedLibraryCount = selectedDraftIds.filter((id) => libraryAds.some((ad) => ad.id === id)).length;

  function toggleDraftSelection(adId: string, selected: boolean) {
    setSelectedDraftIds((current) => (selected ? Array.from(new Set([...current, adId])) : current.filter((id) => id !== adId)));
  }

  function applyBulkDraftUpdate() {
    const selectedIds = selectedDraftIds.filter((id) => libraryAds.some((ad) => ad.id === id));
    if (!selectedIds.length) {
      return;
    }

    onBulkUpdateDrafts(selectedIds, { campaignName: bulkCampaignName, tag: bulkTag });
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
    readyAds.forEach((ad) => onQueueDraft(ad.id, queueName));
  }

  return (
    <section className="draft-table" aria-label="Content library">
      <div className="panel-heading">
        <h2>Content library</h2>
        <Archive size={18} />
      </div>
      {libraryAds.length ? (
        <div className="batch-prep-panel" aria-label="Batch prep assistant">
          <div>
            <strong>Batch prep assistant</strong>
            <span>
              {readyAds.length} ready to queue - {needsWorkCount} need edits
            </span>
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
          <button className="primary compact-button" type="button" onClick={queueReadyDrafts} disabled={!readyAds.length || !batchQueueName}>
            <Send size={16} />
            Queue ready drafts
          </button>
        </div>
      ) : null}
      {libraryAds.length ? (
        <div className="bulk-edit-panel" aria-label="Saved bulk editor">
          <label className="bulk-select">
            <input
              checked={selectedLibraryCount === libraryAds.length}
              type="checkbox"
              onChange={(event) => setSelectedDraftIds(event.target.checked ? libraryAds.map((ad) => ad.id) : [])}
            />
            Select all saved items
          </label>
          <label>
            Campaign
            <input value={bulkCampaignName} onChange={(event) => setBulkCampaignName(event.target.value)} placeholder="Campaign name" />
          </label>
          <label>
            Add tag
            <input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} placeholder="wanted" />
          </label>
          <button className="secondary compact-button" type="button" onClick={applyBulkDraftUpdate} disabled={!selectedLibraryCount}>
            Update {selectedLibraryCount || "selected"}
          </button>
        </div>
      ) : null}
      {libraryAds.length ? null : (
        <div className="library-empty">
          <strong>No content saved yet</strong>
          <span>New submissions will appear here after you add details, copy, media, or a target blog.</span>
        </div>
      )}
      {libraryAds.map((ad) => {
        const duplicateMatch = duplicateMatchesByAdId.get(ad.id);
        const duplicatePeerNames = duplicateMatch?.labels.filter((label, index) => duplicateMatch.adIds[index] !== ad.id) ?? [];

        return (
          <article className={ad.id === activeAdId ? "draft-row selected" : "draft-row"} key={ad.id}>
          <div className="draft-row-summary">
            <label className="bulk-select row-select">
              <input
                checked={selectedDraftIds.includes(ad.id)}
                type="checkbox"
                onChange={(event) => toggleDraftSelection(ad.id, event.target.checked)}
              />
              Select saved item
            </label>
            <strong>{ad.title || "Untitled submission"}</strong>
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
    </section>
  );
}

import { AlertTriangle, Archive, Eye, Link, MoreHorizontal, RotateCcw, Send, Trash2 } from "lucide-react";
import { DuplicateContentMatch } from "../domain/duplicates";
import { formatDate, formatStatus } from "../domain/format";
import { scoreDraftReadiness } from "../domain/post";
import { Advertisement, QueueDefinition } from "../domain/types";

type SavedSubmissionsListProps = {
  activeAdId: string;
  ads: Advertisement[];
  duplicateMatchesByAdId: Map<string, DuplicateContentMatch>;
  queueableAdIds: Set<string>;
  queueOptions: QueueDefinition[];
  queuePickerAdId: string;
  selectedDraftIds: string[];
  selectedQueueName: string;
  onArchiveDraft: (id: string, archived: boolean) => void;
  onDeleteDraft: (id: string) => void;
  onQueueDraft: (id: string, queueName: string) => void;
  onSelectDraft: (id: string) => void;
  onSelectedQueueNameChange: (queueName: string) => void;
  onStartQueue: (id: string) => void;
  onToggleDraftSelection: (adId: string, selected: boolean) => void;
};

type SavedSubmissionActionsProps = {
  ad: Advertisement;
  canQueueAd: boolean;
  queueOptions: QueueDefinition[];
  queuePickerAdId: string;
  selectedQueueName: string;
  onArchiveDraft: (id: string, archived: boolean) => void;
  onDeleteDraft: (id: string) => void;
  onQueueDraft: (id: string, queueName: string) => void;
  onSelectDraft: (id: string) => void;
  onSelectedQueueNameChange: (queueName: string) => void;
  onStartQueue: (id: string) => void;
};

function plainTextExcerpt(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function SavedSubmissionsList({
  activeAdId,
  ads,
  duplicateMatchesByAdId,
  queueableAdIds,
  queueOptions,
  queuePickerAdId,
  selectedDraftIds,
  selectedQueueName,
  onArchiveDraft,
  onDeleteDraft,
  onQueueDraft,
  onSelectDraft,
  onSelectedQueueNameChange,
  onStartQueue,
  onToggleDraftSelection,
}: SavedSubmissionsListProps) {
  return (
    <>
      {ads.map((ad) => {
        const duplicateMatch = duplicateMatchesByAdId.get(ad.id);
        const duplicatePeerNames = duplicateMatch?.labels.filter((_, index) => duplicateMatch.adIds[index] !== ad.id) ?? [];
        const readiness = scoreDraftReadiness(ad);
        const canQueueAd = queueableAdIds.has(ad.id);

        return (
          <article className={`${ad.id === activeAdId ? "draft-row advertisement-card selected" : "draft-row advertisement-card"}${ad.archived ? " archived" : ""}`} key={ad.id}>
            <label className="bulk-select row-select draft-card-select" aria-label="Select saved item">
              <input
                checked={selectedDraftIds.includes(ad.id)}
                type="checkbox"
                onChange={(event) => onToggleDraftSelection(ad.id, event.target.checked)}
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
            <SavedSubmissionActions
              ad={ad}
              canQueueAd={canQueueAd}
              queueOptions={queueOptions}
              queuePickerAdId={queuePickerAdId}
              selectedQueueName={selectedQueueName}
              onArchiveDraft={onArchiveDraft}
              onDeleteDraft={onDeleteDraft}
              onQueueDraft={onQueueDraft}
              onSelectDraft={onSelectDraft}
              onSelectedQueueNameChange={onSelectedQueueNameChange}
              onStartQueue={onStartQueue}
            />
          </article>
        );
      })}
    </>
  );
}

function SavedSubmissionActions({
  ad,
  canQueueAd,
  queueOptions,
  queuePickerAdId,
  selectedQueueName,
  onArchiveDraft,
  onDeleteDraft,
  onQueueDraft,
  onSelectDraft,
  onSelectedQueueNameChange,
  onStartQueue,
}: SavedSubmissionActionsProps) {
  return (
    <>
      <div className="draft-row-actions">
        <a href={ad.forumUrl || "#"} aria-label="Forum URL">
          <Link size={18} />
        </a>
        <details className="draft-card-preview">
          <summary>
            <Eye size={16} />
            Preview
          </summary>
          <div>
            {ad.imageDataUrl ? <img src={ad.imageDataUrl} alt="" /> : null}
            <strong>Preview excerpt</strong>
            <span>{plainTextExcerpt(ad.content) || "No advertisement copy saved yet."}</span>
          </div>
        </details>
        <button className="primary compact-button" type="button" onClick={() => onStartQueue(ad.id)} disabled={!canQueueAd}>
          <Send size={16} />
          {ad.archived ? "Restore to queue" : "Queue"}
        </button>
        <button className="secondary compact-button" type="button" onClick={() => onSelectDraft(ad.id)}>
          Edit
        </button>
        <details className="draft-card-overflow">
          <summary aria-label="More advertisement actions" title="More advertisement actions">
            <MoreHorizontal size={18} />
          </summary>
          <div>
            <button className="secondary compact-button" type="button" onClick={() => onArchiveDraft(ad.id, !ad.archived)}>
              {ad.archived ? <RotateCcw size={16} /> : <Archive size={16} />}
              {ad.archived ? "Unarchive" : "Archive"}
            </button>
            <button className="secondary compact-button" type="button" onClick={() => onDeleteDraft(ad.id)}>
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </details>
      </div>
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
            <select value={selectedQueueName} onChange={(event) => onSelectedQueueNameChange(event.target.value)}>
              {queueOptions.map((queue) => (
                <option key={queue.id} value={queue.name}>
                  {queue.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary compact-button" type="submit" disabled={!canQueueAd}>
            Queue here
          </button>
        </form>
      ) : null}
    </>
  );
}

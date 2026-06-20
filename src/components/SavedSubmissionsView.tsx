import { Archive, Link, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { hasLibraryContent } from "../domain/ads";
import { formatDate, formatStatus } from "../domain/format";
import { validateAdvertisement } from "../domain/post";
import { Advertisement, QueueDefinition } from "../domain/types";

type SavedSubmissionsViewProps = {
  activeAdId: string;
  ads: Advertisement[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  onDeleteDraft: (id: string) => void;
  onQueueDraft: (id: string, queueName: string) => void;
  onSelectDraft: (id: string) => void;
};

export function SavedSubmissionsView({
  activeAdId,
  ads,
  activeQueueName,
  queueOptions,
  onDeleteDraft,
  onQueueDraft,
  onSelectDraft,
}: SavedSubmissionsViewProps) {
  const libraryAds = ads.filter(hasLibraryContent);
  const readyAds = libraryAds.filter((ad) => validateAdvertisement(ad).length === 0);
  const needsWorkCount = libraryAds.length - readyAds.length;
  const [queuePickerAdId, setQueuePickerAdId] = useState("");
  const [selectedQueueName, setSelectedQueueName] = useState(activeQueueName);
  const [batchQueueName, setBatchQueueName] = useState(activeQueueName || queueOptions[0]?.name || "");

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
      {libraryAds.length ? null : (
        <div className="library-empty">
          <strong>No content saved yet</strong>
          <span>New submissions will appear here after you add details, copy, media, or a target blog.</span>
        </div>
      )}
      {libraryAds.map((ad) => (
        <article className={ad.id === activeAdId ? "draft-row selected" : "draft-row"} key={ad.id}>
          <div className="draft-row-summary">
            <strong>{ad.title || "Untitled submission"}</strong>
            <div className="draft-row-meta">
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
      ))}
    </section>
  );
}

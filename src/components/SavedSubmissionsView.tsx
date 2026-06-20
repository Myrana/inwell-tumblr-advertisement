import { Archive, Link, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { hasLibraryContent } from "../domain/ads";
import { formatDate, formatStatus } from "../domain/format";
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
  const [queuePickerAdId, setQueuePickerAdId] = useState("");
  const [selectedQueueName, setSelectedQueueName] = useState(activeQueueName);

  function startQueue(adId: string) {
    if (queueOptions.length > 1) {
      setQueuePickerAdId(adId);
      setSelectedQueueName(activeQueueName || queueOptions[0]?.name || "");
      return;
    }

    onQueueDraft(adId, activeQueueName || queueOptions[0]?.name || "");
  }

  return (
    <section className="draft-table" aria-label="Content library">
      <div className="panel-heading">
        <h2>Content library</h2>
        <Archive size={18} />
      </div>
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

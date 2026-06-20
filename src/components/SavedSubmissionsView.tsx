import { Archive, Link, Send, Trash2 } from "lucide-react";
import { hasLibraryContent } from "../domain/ads";
import { formatDate, formatStatus } from "../domain/format";
import { Advertisement } from "../domain/types";

type SavedSubmissionsViewProps = {
  activeAdId: string;
  ads: Advertisement[];
  onDeleteDraft: (id: string) => void;
  onQueueDraft: (id: string) => void;
  onSelectDraft: (id: string) => void;
};

export function SavedSubmissionsView({ activeAdId, ads, onDeleteDraft, onQueueDraft, onSelectDraft }: SavedSubmissionsViewProps) {
  const libraryAds = ads.filter(hasLibraryContent);

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
              <span>{ad.postType}</span>
              <span>{formatStatus(ad.status)}</span>
              <span>{ad.destinationBlog || "No target"}</span>
              <span>{formatDate(ad.updatedAt)}</span>
            </div>
          </div>
          <div className="draft-row-actions">
            <a href={ad.forumUrl || "#"} aria-label="Forum URL">
              <Link size={18} />
            </a>
            <button className="secondary compact-button" type="button" onClick={() => onQueueDraft(ad.id)}>
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
        </article>
      ))}
    </section>
  );
}

import { Archive, Link, Trash2 } from "lucide-react";
import { formatDate, formatStatus } from "../domain/format";
import { Advertisement } from "../domain/types";

type SavedSubmissionsViewProps = {
  activeAdId: string;
  ads: Advertisement[];
  onDeleteDraft: (id: string) => void;
  onSelectDraft: (id: string) => void;
};

export function SavedSubmissionsView({ activeAdId, ads, onDeleteDraft, onSelectDraft }: SavedSubmissionsViewProps) {
  return (
    <section className="draft-table" aria-label="Saved submissions">
      <div className="panel-heading">
        <h2>Saved submissions</h2>
        <Archive size={18} />
      </div>
      {ads.map((ad) => (
        <article className={ad.id === activeAdId ? "draft-row selected" : "draft-row"} key={ad.id}>
          <button type="button" onClick={() => onSelectDraft(ad.id)}>
            <strong>{ad.title || "Untitled saved submission"}</strong>
            <span>{ad.postType} - {formatStatus(ad.status)} - {formatDate(ad.updatedAt)}</span>
          </button>
          <a href={ad.forumUrl || "#"} aria-label="Forum URL">
            <Link size={18} />
          </a>
          <button
            className="icon-button"
            type="button"
            onClick={() => onDeleteDraft(ad.id)}
            aria-label="Delete saved submission"
            title="Delete saved submission"
          >
            <Trash2 size={18} />
          </button>
        </article>
      ))}
    </section>
  );
}

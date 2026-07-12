import { AlertTriangle, Send } from "lucide-react";
import { KeyboardEvent, useEffect, useRef } from "react";
import type { Advertisement } from "../../domain/types";

type BatchQueuePreviewPanelProps = {
  queueName: string;
  readyDrafts: Advertisement[];
  skippedDrafts: Advertisement[];
  duplicateAdIds: Set<string>;
  failedIds: Set<string>;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BatchQueuePreviewPanel({
  queueName,
  readyDrafts,
  skippedDrafts,
  duplicateAdIds,
  failedIds,
  pending,
  onCancel,
  onConfirm,
}: BatchQueuePreviewPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, []);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="batch-queue-preview" role="dialog" aria-modal="true" aria-label="Batch queue preview" ref={dialogRef} onKeyDown={handleDialogKeyDown}>
      <div className="batch-queue-preview-card">
        <div className="batch-queue-preview-heading">
          <div>
            <span className="panel-kicker">Confirm batch</span>
            <h3>Preview queue additions</h3>
            <p>{readyDrafts.length} advertisement{readyDrafts.length === 1 ? "" : "s"} will be added to {queueName}.</p>
          </div>
          <Send size={20} />
        </div>

        <section aria-label="Ready queue additions">
          <strong>Ready to queue</strong>
          <ul>
            {readyDrafts.map((draft) => (
              <li key={draft.id}>
                <span>{draft.title || "Untitled advertisement"}</span>
                <small>{draft.destinationBlog || "No destination"} · {draft.postType}</small>
                {duplicateAdIds.has(draft.id) ? <em><AlertTriangle size={13} /> Possible duplicate</em> : null}
                {failedIds.has(draft.id) ? <em><AlertTriangle size={13} /> Could not save</em> : null}
              </li>
            ))}
          </ul>
        </section>

        {skippedDrafts.length ? (
          <section aria-label="Skipped queue additions">
            <strong>Skipped because they need work</strong>
            <ul>
              {skippedDrafts.map((draft) => <li key={draft.id}>{draft.title || "Untitled advertisement"}</li>)}
            </ul>
          </section>
        ) : null}

        <div className="batch-queue-preview-actions">
          <button className="primary compact-button" type="button" onClick={onConfirm} disabled={!readyDrafts.length || pending}>
            {pending ? "Adding…" : `Add ${readyDrafts.length} to queue`}
          </button>
          <button className="secondary compact-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

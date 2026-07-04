import { Send } from "lucide-react";
import { TumblrSubmitTarget } from "../../domain/types";
import "./queuePreview.css";

type QueuePreviewPanelProps = {
  queueName: string;
  targets: TumblrSubmitTarget[];
  onCancel: () => void;
  onConfirm: () => void;
};

export function QueuePreviewPanel({
  queueName,
  targets,
  onCancel,
  onConfirm,
}: QueuePreviewPanelProps) {
  if (!targets.length) {
    return null;
  }

  return (
    <div className="queue-preview-panel" role="dialog" aria-label="Queue preview">
      <div>
        <strong>Preview queue additions</strong>
        <span>
          {targets.length} target{targets.length === 1 ? "" : "s"} will be added to {queueName || "the selected queue"}.
        </span>
      </div>
      <ul>
        {targets.map((target) => (
          <li key={target.id}>
            <strong>{target.name}</strong>
            <span>{target.submitUrl}</span>
          </li>
        ))}
      </ul>
      <div className="queue-confirmation-actions">
        <button className="primary" type="button" onClick={onConfirm}>
          <Send size={18} />
          Add {targets.length} to queue
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

import { formatDate, formatSubmissionStatus } from "../../domain/format";
import type { SubmissionQueueItem } from "../../domain/types";

type QueueItemMetaRowProps = {
  item: SubmissionQueueItem;
};

export function QueueItemMetaRow({ item }: QueueItemMetaRowProps) {
  return (
    <div className="queue-item-meta-row" aria-label={`${item.targetName} queue metadata`}>
      <span className={`queue-status-chip queue-status-${item.status}`}>{formatSubmissionStatus(item.status)}</span>
      <span>{item.queueName}</span>
      <span>Updated {formatDate(item.updatedAt)}</span>
      {item.lastRunAt ? <span>Last run {formatDate(item.lastRunAt)}</span> : null}
    </div>
  );
}

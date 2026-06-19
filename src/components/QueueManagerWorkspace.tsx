import { FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { QueueDefinition, SubmissionQueueItem } from "../domain/types";

type QueueManagerWorkspaceProps = {
  activeQueueName: string;
  queueNameDraft: string;
  queueOptions: QueueDefinition[];
  submissionQueue: SubmissionQueueItem[];
  onClearQueue: (queueName: string, completedOnly: boolean) => void;
  onCreateQueue: (event: FormEvent) => void;
  onQueueNameDraftChange: (value: string) => void;
  onSelectQueue: (queueName: string) => void;
};

const completedStatuses = new Set(["submitted", "posted", "failed"]);

export function QueueManagerWorkspace({
  activeQueueName,
  queueNameDraft,
  queueOptions,
  submissionQueue,
  onClearQueue,
  onCreateQueue,
  onQueueNameDraftChange,
  onSelectQueue,
}: QueueManagerWorkspaceProps) {
  return (
    <section className="submission-queue-panel queue-workspace" aria-label="Queue management">
      <div className="panel-heading">
        <h2>Queues</h2>
        <Trash2 size={18} />
      </div>

      <form className="queue-management-form" onSubmit={onCreateQueue}>
        <label>
          New queue name
          <input
            value={queueNameDraft}
            onChange={(event) => onQueueNameDraftChange(event.target.value)}
            placeholder="Wanted ads"
          />
        </label>
        <button className="secondary" type="submit">
          <Plus size={18} />
          Add queue
        </button>
      </form>

      <div className="queue-management-list">
        {queueOptions.map((queue) => {
          const items = submissionQueue.filter((item) => item.queueName === queue.name);
          const completedCount = items.filter((item) => completedStatuses.has(item.status)).length;

          return (
            <article className={queue.name === activeQueueName ? "queue-management-row selected" : "queue-management-row"} key={queue.id}>
              <button type="button" onClick={() => onSelectQueue(queue.name)}>
                <strong>{queue.name}</strong>
                <span>
                  {items.length} item{items.length === 1 ? "" : "s"} - {completedCount} complete
                </span>
              </button>
              <div className="queue-item-actions">
                <button className="secondary" type="button" onClick={() => onClearQueue(queue.name, true)} disabled={!completedCount}>
                  Clear completed
                </button>
                <button className="secondary" type="button" onClick={() => onClearQueue(queue.name, false)} disabled={!items.length}>
                  Clear queue
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

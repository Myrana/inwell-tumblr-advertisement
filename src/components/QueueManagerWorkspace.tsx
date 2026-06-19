import { FormEvent } from "react";
import { ListChecks, Plus } from "lucide-react";
import { QueueDefinition, SubmissionQueueItem } from "../domain/types";

type QueueManagerWorkspaceProps = {
  activeQueueName: string;
  queueNameDraft: string;
  queueOptions: QueueDefinition[];
  queueStatus: string;
  submissionQueue: SubmissionQueueItem[];
  onCreateQueue: (event: FormEvent) => void;
  onQueueNameDraftChange: (value: string) => void;
  onRenameQueue: (currentName: string, nextName: string) => void;
  onSelectQueue: (queueName: string) => void;
};

const completedStatuses = new Set(["submitted", "posted", "failed"]);

export function QueueManagerWorkspace({
  activeQueueName,
  queueNameDraft,
  queueOptions,
  queueStatus,
  submissionQueue,
  onCreateQueue,
  onQueueNameDraftChange,
  onRenameQueue,
  onSelectQueue,
}: QueueManagerWorkspaceProps) {
  return (
    <section className="submission-queue-panel queue-workspace" aria-label="Queue management">
      <div className="panel-heading">
        <h2>Queues</h2>
        <ListChecks size={18} />
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

      {queueStatus ? <p className="queue-status">{queueStatus}</p> : null}

      <div className="queue-management-list">
        {queueOptions.length ? queueOptions.map((queue) => {
          const items = submissionQueue.filter((item) => item.queueName === queue.name);
          const completedCount = items.filter((item) => completedStatuses.has(item.status)).length;

          return (
            <article className={queue.name === activeQueueName ? "queue-management-row selected" : "queue-management-row"} key={queue.id}>
              <div className="queue-management-summary">
                <button type="button" onClick={() => onSelectQueue(queue.name)}>
                  <strong>{queue.name}</strong>
                  <span>
                    {items.length} item{items.length === 1 ? "" : "s"} - {completedCount} complete
                  </span>
                </button>
                <form
                  className="queue-rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    onRenameQueue(queue.name, String(data.get("queueName") ?? ""));
                  }}
                >
                  <label>
                    Queue name
                    <input name="queueName" defaultValue={queue.name} />
                  </label>
                  <button className="secondary" type="submit">
                    Save name
                  </button>
                </form>
              </div>
              <div className="queue-item-actions">
                <button className="secondary" type="button" onClick={() => onSelectQueue(queue.name)}>
                  <ListChecks size={16} />
                  Open queue
                </button>
              </div>
            </article>
          );
        }) : (
          <p className="queue-empty">Create your first queue when you are ready to organize submissions.</p>
        )}
      </div>
    </section>
  );
}

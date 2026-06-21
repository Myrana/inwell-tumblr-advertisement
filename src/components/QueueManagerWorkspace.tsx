import { FormEvent } from "react";
import { CalendarDays, ListChecks, Plus, Trash2 } from "lucide-react";
import { formatEasternRun, nextDailyRunAt } from "../domain/schedule";
import { QueueDefinition, QueueScheduleSettings, SubmissionQueueItem } from "../domain/types";

type QueueManagerWorkspaceProps = {
  activeQueueName: string;
  queueNameDraft: string;
  queueOptions: QueueDefinition[];
  queueScheduleSettings: QueueScheduleSettings;
  queueStatus: string;
  submissionQueue: SubmissionQueueItem[];
  onCreateQueue: (event: FormEvent) => void;
  onDeleteQueue: (queueName: string) => void;
  onQueueNameDraftChange: (value: string) => void;
  onSelectQueue: (queueName: string) => void;
};

const completedStatuses = new Set(["submitted", "posted", "failed"]);

export function QueueManagerWorkspace({
  activeQueueName,
  queueNameDraft,
  queueOptions,
  queueScheduleSettings,
  queueStatus,
  submissionQueue,
  onCreateQueue,
  onDeleteQueue,
  onQueueNameDraftChange,
  onSelectQueue,
}: QueueManagerWorkspaceProps) {
  const defaultSchedule = {
    enabled: queueScheduleSettings.enabled,
    dailyTime: queueScheduleSettings.dailyTime,
    timezone: queueScheduleSettings.timezone,
  };

  return (
    <section className="submission-queue-panel queue-workspace" aria-label="Queue management">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">Blog Tracker</span>
          <h2>Queues</h2>
          <p>Keep Tumblr submission lanes, schedules, and reusable blog requirements in one place.</p>
        </div>
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

      {queueOptions.length ? (
        <section className="content-calendar-panel" aria-label="Content calendar">
          <div className="panel-heading">
            <h2>Content calendar</h2>
            <CalendarDays size={18} />
          </div>
          <div className="content-calendar-grid">
            {queueOptions.map((queue) => {
              const schedule = queueScheduleSettings.perQueue[queue.name] ?? defaultSchedule;
              const items = submissionQueue.filter((item) => item.queueName === queue.name && !completedStatuses.has(item.status));
              const nextRun = schedule.enabled ? formatEasternRun(nextDailyRunAt(schedule)) : "Not scheduled";

              return (
                <article className="content-calendar-card" key={queue.id}>
                  <span className="blog-card-kicker">Submission lane</span>
                  <strong>{queue.name}</strong>
                  <span>{nextRun}</span>
                  <small>
                    {items.length} queued item{items.length === 1 ? "" : "s"}
                  </small>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="queue-management-list">
        {queueOptions.length ? queueOptions.map((queue) => {
          const items = submissionQueue.filter((item) => item.queueName === queue.name);
          const completedCount = items.filter((item) => completedStatuses.has(item.status)).length;

          return (
            <article className={queue.name === activeQueueName ? "queue-management-row selected" : "queue-management-row"} key={queue.id}>
              <div className="queue-management-summary">
                <button type="button" onClick={() => onSelectQueue(queue.name)}>
                  <span className="blog-card-kicker">Tumblr blog set</span>
                  <strong>{queue.name}</strong>
                  <span>
                    {items.length} item{items.length === 1 ? "" : "s"} - {completedCount} complete
                  </span>
                </button>
              </div>
              <div className="queue-item-actions">
                <button className="secondary" type="button" onClick={() => onSelectQueue(queue.name)}>
                  <ListChecks size={16} />
                  Open queue
                </button>
                <button className="secondary" type="button" onClick={() => onDeleteQueue(queue.name)}>
                  <Trash2 size={16} />
                  Delete queue
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

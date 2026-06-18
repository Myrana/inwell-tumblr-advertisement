import { List, Play, Plus, Send } from "lucide-react";
import { formatDate, formatSubmissionStatus } from "../domain/format";
import { queueLogGroups, runnerLogExplanation, visibleRunnerLogs } from "../domain/runnerLogs";
import { formatEasternRun, nextDailyRunAt, scheduleSummary } from "../domain/schedule";
import {
  QueueScheduleSettings,
  RunnerLog,
  RunnerSettings,
  RunnerStatus,
  SubmissionQueueItem,
  SubmissionStatus,
  TumblrSubmitTarget,
} from "../domain/types";

type QueueWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  activeSubmitTarget: TumblrSubmitTarget;
  queueStatus: string;
  queueScheduleSettings: QueueScheduleSettings;
  runnerSettings: RunnerSettings;
  runnerState: RunnerStatus | null;
  runnerLogs: RunnerLog[];
  targetOptions: TumblrSubmitTarget[];
  onClearCompleted: () => void;
  onQueueTargets: (targets: TumblrSubmitTarget[]) => void;
  onQueueScheduleSettingsChange: (patch: Partial<QueueScheduleSettings>) => void;
  onRefreshRunnerStatus: () => void;
  onRunnerSettingsChange: (patch: Partial<RunnerSettings>) => void;
  onStartRunner: () => void;
  onUpdateQueueItem: (id: string, status: SubmissionStatus, notes: string) => void;
};

export function QueueWorkspace({
  activeQueue,
  activeSubmitTarget,
  queueStatus,
  queueScheduleSettings,
  runnerSettings,
  runnerState,
  runnerLogs,
  targetOptions,
  onClearCompleted,
  onQueueTargets,
  onQueueScheduleSettingsChange,
  onRefreshRunnerStatus,
  onRunnerSettingsChange,
  onStartRunner,
  onUpdateQueueItem,
}: QueueWorkspaceProps) {
  const statusCounts = activeQueue.reduce<Record<SubmissionStatus, number>>(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { queued: 0, scheduled: 0, running: 0, submitted: 0, posted: 0, "needs-review": 0, failed: 0 },
  );
  const scopedLogs = visibleRunnerLogs(runnerLogs, false);
  const logGroups = queueLogGroups(activeQueue, scopedLogs);
  const nextRunAt = queueScheduleSettings.enabled ? nextDailyRunAt(queueScheduleSettings) : "";

  function queueItemExplanation(item: SubmissionQueueItem) {
    const logs = logGroups.find((group) => group.item.id === item.id)?.logs ?? [];
    const reviewLog = logs.find((log) => log.level === "error") ?? logs.find((log) => log.level === "warning");
    return reviewLog ? runnerLogExplanation(reviewLog) || reviewLog.message : item.notes;
  }

  return (
    <section className="submission-queue-panel queue-workspace" aria-label="Tumblr submission queue">
      <div className="panel-heading">
        <h2>Submission queue</h2>
        <Send size={18} />
      </div>
      <div className="queue-monitor-grid" aria-label="Queue monitoring summary">
        {Object.entries(statusCounts).map(([status, count]) => (
          <div className="queue-monitor-stat" key={status}>
            <span>{formatSubmissionStatus(status as SubmissionStatus)}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <div className="runner-control-panel queue-daily-panel" aria-label="Daily automation schedule">
        <div className="field-grid three">
          <label className="runner-submit-toggle">
            <input
              checked={queueScheduleSettings.enabled}
              type="checkbox"
              onChange={(event) => onQueueScheduleSettingsChange({ enabled: event.target.checked })}
            />
            Run this queue daily
          </label>
          <label>
            Daily run time
            <input
              type="time"
              value={queueScheduleSettings.dailyTime}
              onChange={(event) => onQueueScheduleSettingsChange({ dailyTime: event.target.value })}
            />
          </label>
          <label>
            Timezone
            <input readOnly value="America/New_York" />
          </label>
        </div>
        <p className="queue-schedule-summary">{scheduleSummary(queueScheduleSettings)}</p>
        {nextRunAt ? <p className="queue-empty">Next queued local run: {formatEasternRun(nextRunAt)} ET</p> : null}
      </div>
      <div className="runner-control-panel" aria-label="Local Tumblr runner controls">
        <div className="field-grid three">
          <label>
            Media folder
            <input
              value={runnerSettings.mediaDir}
              onChange={(event) => onRunnerSettingsChange({ mediaDir: event.target.value })}
              placeholder="C:\Users\mandy\OneDrive\Desktop\rp\Grass is Greener"
            />
          </label>
          <label>
            Slow motion
            <input
              min={0}
              max={5000}
              step={100}
              type="number"
              value={runnerSettings.slowMo}
              onChange={(event) => onRunnerSettingsChange({ slowMo: Number(event.target.value) || 0 })}
            />
          </label>
          <label className="runner-submit-toggle">
            <input
              checked={runnerSettings.submit}
              type="checkbox"
              onChange={(event) => onRunnerSettingsChange({ submit: event.target.checked })}
            />
            Click Submit after filling
          </label>
        </div>
        <div className="queue-actions">
          <button className="primary" type="button" onClick={onStartRunner} disabled={!activeQueue.length}>
            <Play size={18} />
            Run queue
          </button>
          <button className="secondary" type="button" onClick={onRefreshRunnerStatus}>
            Refresh runner status
          </button>
          {runnerState ? (
            <span className="runner-state">
              {runnerState.running ? `Running: ${runnerState.pid}` : "Not running"}
            </span>
          ) : null}
        </div>
      </div>
      <div className="queue-actions">
        <button className="secondary" type="button" onClick={() => onQueueTargets([activeSubmitTarget])}>
          <Plus size={18} />
          Queue current
        </button>
        <button className="secondary" type="button" onClick={() => onQueueTargets(targetOptions)}>
          <List size={18} />
          Queue all targets
        </button>
        <button className="secondary" type="button" onClick={onClearCompleted}>
          Clear completed
        </button>
      </div>
      {queueStatus ? <p className="queue-status">{queueStatus}</p> : null}
      <div className="queue-list">
        {activeQueue.length ? (
          activeQueue.map((item) => (
            <article className="queue-item" key={item.id}>
              <div>
                <strong>{item.targetName}</strong>
                <span>{item.postType} - {formatSubmissionStatus(item.status)} - {formatDate(item.updatedAt)}</span>
                <a href={item.submitUrl} target="_blank" rel="noreferrer">
                  {item.submitUrl}
                </a>
              </div>
              {item.status === "failed" || item.status === "needs-review" ? null : <p>{item.notes}</p>}
              {item.status === "failed" || item.status === "needs-review" ? (
                <div className={`queue-item-explanation ${item.status === "failed" ? "failed" : "warning"}`} role="status">
                  <strong>{item.status === "failed" ? "Why this failed" : "Needs review because"}</strong>
                  <span>{queueItemExplanation(item)}</span>
                </div>
              ) : null}
              <details className="queue-item-overrides">
                <summary>Manual override</summary>
                <div className="queue-item-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => onUpdateQueueItem(item.id, "queued", "Requeued for the next automation run.")}
                  >
                    Requeue
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => onUpdateQueueItem(item.id, "posted", "Marked posted after Tumblr accepted the form.")}
                  >
                    Mark posted
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => onUpdateQueueItem(item.id, "failed", "Marked failed for runner retry or review.")}
                  >
                    Mark failed
                  </button>
                </div>
              </details>
              {logGroups.find((group) => group.item.id === item.id)?.logs.length ? (
                <div className="queue-item-log-list" aria-label={`Runner logs for ${item.targetName}`}>
                  {logGroups
                    .find((group) => group.item.id === item.id)
                    ?.logs.slice(0, 4)
                    .map((log) => (
                      <article className={`queue-log queue-log-${log.level}`} key={log.id}>
                        <strong>{log.message}</strong>
                        <span>{formatDate(log.createdAt)}</span>
                      </article>
                    ))}
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <p className="queue-empty">Queue one or more Tumblr blogs, then run the automation step.</p>
        )}
      </div>
    </section>
  );
}

import { ChevronDown, List, Pencil, Play, Plus, Send, Terminal, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDate, formatSubmissionStatus } from "../domain/format";
import { queueLogGroups, runnerLogExplanation, visibleRunnerLogs } from "../domain/runnerLogs";
import { formatEasternRun, nextDailyRunAt, scheduleSummary } from "../domain/schedule";
import {
  QueueDefinition,
  QueueScheduleSettings,
  RunnerLog,
  RunnerSettings,
  RunnerStatus,
  SubmissionQueueItem,
  SubmissionStatus,
  TumblrAccount,
  TumblrSubmitTarget,
} from "../domain/types";

type QueueWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  activeSubmitTarget: TumblrSubmitTarget;
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  queueStatus: string;
  queueScheduleSettings: QueueScheduleSettings;
  runnerSettings: RunnerSettings;
  runnerState: RunnerStatus | null;
  runnerLogs: RunnerLog[];
  targetOptions: TumblrSubmitTarget[];
  tumblrAccounts: TumblrAccount[];
  onClearQueue: (queueName: string, completedOnly: boolean) => void;
  onEditQueueItem: (id: string) => void;
  onQueueTargets: (targets: TumblrSubmitTarget[]) => void;
  onRenameQueue: (currentName: string, nextName: string) => void;
  onSelectQueue: (queueName: string) => void;
  onQueueScheduleSettingsChange: (patch: Partial<QueueScheduleSettings>) => void;
  onRefreshRunnerStatus: () => void;
  onRunnerSettingsChange: (patch: Partial<RunnerSettings>) => void;
  onShowLocalRunnerCommand: () => void;
  onStartRunner: () => void;
  onUpdateQueueItem: (id: string, status: SubmissionStatus, notes: string) => void;
};

type QueueSectionKey = "overview" | "schedule" | "runner" | "actions" | "submissions";

export function QueueWorkspace({
  activeQueue,
  activeSubmitTarget,
  activeQueueName,
  queueOptions,
  queueStatus,
  queueScheduleSettings,
  runnerSettings,
  runnerState,
  runnerLogs,
  targetOptions,
  tumblrAccounts,
  onClearQueue,
  onEditQueueItem,
  onQueueTargets,
  onRenameQueue,
  onSelectQueue,
  onQueueScheduleSettingsChange,
  onRefreshRunnerStatus,
  onRunnerSettingsChange,
  onShowLocalRunnerCommand,
  onStartRunner,
  onUpdateQueueItem,
}: QueueWorkspaceProps) {
  const [openSections, setOpenSections] = useState<Record<QueueSectionKey, boolean>>({
    overview: true,
    schedule: false,
    runner: false,
    actions: false,
    submissions: true,
  });
  const statusCounts = activeQueue.reduce<Record<SubmissionStatus, number>>(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { queued: 0, scheduled: 0, running: 0, submitted: 0, posted: 0, "needs-review": 0, failed: 0 },
  );
  const scopedLogs = visibleRunnerLogs(runnerLogs, false);
  const logGroups = queueLogGroups(activeQueue, scopedLogs);
  const localRunner = runnerState?.local_runner;
  const localRunnerLabel = localRunner?.online
    ? `Local runner online${localRunner.queue_name ? `: ${localRunner.queue_name}` : ""}`
    : "Local runner offline";
  const nextRunAt = queueScheduleSettings.enabled ? nextDailyRunAt(queueScheduleSettings) : "";
  const completedCount = statusCounts.submitted + statusCounts.posted + statusCounts.failed;

  function queueItemExplanation(item: SubmissionQueueItem) {
    const logs = logGroups.find((group) => group.item.id === item.id)?.logs ?? [];
    const reviewLog = logs.find((log) => log.level === "error") ?? logs.find((log) => log.level === "warning");
    return reviewLog ? runnerLogExplanation(reviewLog) || reviewLog.message : item.notes;
  }

  function setSectionOpen(section: QueueSectionKey, open: boolean) {
    setOpenSections((current) => ({ ...current, [section]: open }));
  }

  function sectionToggle(section: QueueSectionKey, title: string, summary: string) {
    return (
      <button type="button" aria-label={`Toggle ${title.toLowerCase()} section`} onClick={() => setSectionOpen(section, !openSections[section])}>
        <ChevronDown size={18} className={openSections[section] ? "open" : ""} />
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
      </button>
    );
  }

  return (
    <section className="submission-queue-panel queue-workspace" aria-label="Tumblr submission queue">
      <div className="panel-heading">
        <h2>Submission queue</h2>
        <Send size={18} />
      </div>

      <section className="workflow-section queue-workflow-section">
        <div className="workflow-section-header">
          {sectionToggle("overview", "Queue overview", `${activeQueueName || "No queue selected"} - ${activeQueue.length} item${activeQueue.length === 1 ? "" : "s"}`)}
          <span className={activeQueue.length ? "section-state ready" : "section-state warning"}>{activeQueue.length ? "Ready" : "Empty"}</span>
        </div>

        {openSections.overview ? (
          <div className="workflow-section-body">
            <div className="queue-selector-panel" aria-label="Queue selector">
              <label>
                Active queue
                <select value={activeQueueName} onChange={(event) => onSelectQueue(event.target.value)}>
                  {queueOptions.map((queue) => (
                    <option key={queue.id} value={queue.name}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              </label>
              {activeQueueName ? (
                <form
                  className="queue-rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    onRenameQueue(activeQueueName, String(data.get("queueName") ?? ""));
                  }}
                >
                  <label>
                    Queue name
                    <input name="queueName" defaultValue={activeQueueName} key={activeQueueName} />
                  </label>
                  <button className="secondary" type="submit">
                    Save name
                  </button>
                </form>
              ) : null}
            </div>
            <div className="queue-monitor-grid" aria-label="Queue monitoring summary">
              {Object.entries(statusCounts).map(([status, count]) => (
                <div className="queue-monitor-stat" key={status}>
                  <span>{formatSubmissionStatus(status as SubmissionStatus)}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="workflow-section queue-workflow-section">
        <div className="workflow-section-header">
          {sectionToggle("schedule", "Schedule", scheduleSummary(queueScheduleSettings))}
          <span className={queueScheduleSettings.enabled ? "section-state ready" : "section-state warning"}>
            {queueScheduleSettings.enabled ? "On" : "Off"}
          </span>
        </div>

        {openSections.schedule ? (
          <div className="workflow-section-body">
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
          </div>
        ) : null}
      </section>

      <section className="workflow-section queue-workflow-section">
        <div className="workflow-section-header">
          {sectionToggle("runner", "Runner settings", runnerSettings.tumblrAccountId ? "Tumblr account selected" : "Select a Tumblr account before running")}
          <span className={runnerSettings.tumblrAccountId ? "section-state ready" : "section-state"}>{runnerSettings.tumblrAccountId ? "Ready" : "Needs info"}</span>
        </div>

        {openSections.runner ? (
          <div className="workflow-section-body">
            <div className="runner-control-panel" aria-label="Local Tumblr runner controls">
              <div className="field-grid two">
                <label>
                  Tumblr account
                  <select
                    value={runnerSettings.tumblrAccountId}
                    onChange={(event) => onRunnerSettingsChange({ tumblrAccountId: event.target.value })}
                  >
                    <option value="">Select account</option>
                    {tumblrAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayName}
                      </option>
                    ))}
                  </select>
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
            </div>
          </div>
        ) : null}
      </section>

      <section className="workflow-section queue-workflow-section">
        <div className="workflow-section-header">
          {sectionToggle("actions", "Queue actions", activeQueue.length ? "Run, add, or clear queue items" : "Add submissions before running")}
          <span className={activeQueue.length ? "section-state ready" : "section-state warning"}>{activeQueue.length ? "Ready" : "Empty"}</span>
        </div>

        {openSections.actions ? (
          <div className="workflow-section-body">
            <div className="queue-actions">
              <button className="primary" type="button" onClick={onStartRunner} disabled={!activeQueue.length}>
                <Play size={18} />
                Run locally
              </button>
              <button className="secondary" type="button" onClick={onRefreshRunnerStatus}>
                Refresh runner status
              </button>
              <button className="secondary" type="button" onClick={onShowLocalRunnerCommand} disabled={!activeQueue.length}>
                <Terminal size={18} />
                Show local command
              </button>
              {runnerState ? (
                <span className="runner-state">
                  {localRunnerLabel}
                </span>
              ) : null}
            </div>
            <div className="queue-actions queue-maintenance-actions">
              <button className="secondary" type="button" onClick={() => onQueueTargets([activeSubmitTarget])}>
                <Plus size={18} />
                Queue current
              </button>
              <button className="secondary" type="button" onClick={() => onQueueTargets(targetOptions)}>
                <List size={18} />
                Queue all targets
              </button>
            </div>
            <div className="queue-actions queue-maintenance-actions" aria-label="Queue maintenance">
              <button className="secondary" type="button" onClick={() => onClearQueue(activeQueueName, true)} disabled={!completedCount}>
                <Trash2 size={16} />
                Clear completed
              </button>
              <button className="secondary" type="button" onClick={() => onClearQueue(activeQueueName, false)} disabled={!activeQueue.length}>
                <Trash2 size={16} />
                Clear queue
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {queueStatus ? <p className="queue-status">{queueStatus}</p> : null}

      <section className="workflow-section queue-workflow-section">
        <div className="workflow-section-header">
          {sectionToggle("submissions", "Queued submissions", `${activeQueue.length} item${activeQueue.length === 1 ? "" : "s"}`)}
          <span className={activeQueue.length ? "section-state ready" : "section-state warning"}>{activeQueue.length ? "Ready" : "Empty"}</span>
        </div>

        {openSections.submissions ? (
          <div className="workflow-section-body">
            <div className="queue-list">
              {activeQueue.length ? (
                activeQueue.map((item) => (
                  <article className="queue-item" key={item.id}>
                    <div className="queue-item-header">
                      <div>
                        <strong>{item.targetName}</strong>
                        <span>{item.postType} - {formatSubmissionStatus(item.status)} - {formatDate(item.updatedAt)}</span>
                        <a href={item.submitUrl} target="_blank" rel="noreferrer">
                          {item.submitUrl}
                        </a>
                      </div>
                      <button className="secondary" type="button" onClick={() => onEditQueueItem(item.id)}>
                        <Pencil size={16} />
                        Edit submission
                      </button>
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
                <p className="queue-empty">Queue one or more Tumblr blogs into {activeQueueName}, then run the automation step.</p>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}

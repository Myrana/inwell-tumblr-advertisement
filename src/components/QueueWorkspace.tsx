import { ChevronDown, Download, Pencil, Play, PlugZap, Send, Terminal, TestTube2 } from "lucide-react";
import { useState } from "react";
import { formatDate, formatSubmissionStatus } from "../domain/format";
import { queueLogGroups, runnerLogExplanation, visibleRunnerLogs } from "../domain/runnerLogs";
import { formatEasternRun, nextDailyRunAt, scheduleSummary } from "../domain/schedule";
import {
  QueueDefinition,
  QueueSchedulePreference,
  RunnerLog,
  SubmissionQueueItem,
  SubmissionStatus,
} from "../domain/types";

type RunnerActivity = {
  status: string;
  detail: string;
};

type QueueWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  queueStatus: string;
  queueScheduleSettings: QueueSchedulePreference;
  runnerConnectionLabel: string;
  runnerActivity: RunnerActivity;
  runnerHeadless: boolean;
  runnerSubmitApproved: boolean;
  runnerLogs: RunnerLog[];
  onEditQueueItem: (id: string) => void;
  onRenameQueue: (currentName: string, nextName: string) => void;
  onSelectQueue: (queueName: string) => void;
  onQueueScheduleSettingsChange: (patch: Partial<QueueSchedulePreference>) => void;
  onCopyLocalRunnerSetup: () => void;
  onDownloadLocalRunner: () => void;
  onLaunchLocalRunner: () => void;
  onStartRunner: () => void;
  onStartTestRun: () => void;
  onRunnerHeadlessChange: (headless: boolean) => void;
  onRunnerSubmitApprovedChange: (submit: boolean) => void;
  showLaunchLocalRunner: boolean;
  onRetryQueueItemTestRun: (id: string) => void;
  onUpdateQueueItem: (id: string, status: SubmissionStatus, notes: string) => void;
};

type QueueSectionKey = "overview" | "schedule" | "submissions";

export function QueueWorkspace({
  activeQueue,
  activeQueueName,
  queueOptions,
  queueStatus,
  queueScheduleSettings,
  runnerConnectionLabel,
  runnerActivity,
  runnerHeadless,
  runnerSubmitApproved,
  runnerLogs,
  onEditQueueItem,
  onRenameQueue,
  onSelectQueue,
  onQueueScheduleSettingsChange,
  onCopyLocalRunnerSetup,
  onDownloadLocalRunner,
  onLaunchLocalRunner,
  onStartRunner,
  onStartTestRun,
  onRunnerHeadlessChange,
  onRunnerSubmitApprovedChange,
  showLaunchLocalRunner,
  onRetryQueueItemTestRun,
  onUpdateQueueItem,
}: QueueWorkspaceProps) {
  const [openSections, setOpenSections] = useState<Record<QueueSectionKey, boolean>>({
    overview: true,
    schedule: false,
    submissions: true,
  });
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

  function recoveryGuidance(item: SubmissionQueueItem) {
    if (item.status === "failed") {
      return "Use Retry test run after fixing the blocker. It will prepare Tumblr again without submitting.";
    }
    return "Review the open Tumblr page, then requeue or mark posted once the submission state is clear.";
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

      <section className="queue-command-panel" aria-label="Queue actions">
        <div className="queue-command-group">
          <div className="queue-command-heading">
            <strong>Local runner</strong>
            <span>{runnerConnectionLabel}</span>
          </div>
          <div className="queue-action-row">
            <button className="primary" type="button" onClick={() => onStartRunner()} disabled={!activeQueue.length}>
              <Play size={18} />
              Run
            </button>
            <button className="secondary" type="button" onClick={onStartTestRun} disabled={!activeQueue.length}>
              <TestTube2 size={18} />
              Test run
            </button>
            {showLaunchLocalRunner ? (
              <button className="secondary" type="button" onClick={onLaunchLocalRunner}>
                <PlugZap size={18} />
                Start
              </button>
            ) : null}
            <button className="secondary" type="button" onClick={onDownloadLocalRunner}>
              <Download size={18} />
              Download
            </button>
            <button className="secondary" type="button" onClick={onCopyLocalRunnerSetup} disabled={!activeQueue.length}>
              <Terminal size={18} />
              Setup
            </button>
          </div>
        </div>
      </section>

      <section className="runner-activity-panel" aria-label="Local runner activity">
        <div>
          <strong>{runnerActivity.status}</strong>
          <span>{runnerActivity.detail}</span>
        </div>
        <label className="runner-submit-toggle runner-headless-toggle">
          <input
            checked={runnerHeadless}
            type="checkbox"
            onChange={(event) => onRunnerHeadlessChange(event.target.checked)}
          />
          Run headless
        </label>
        <label className="runner-submit-toggle runner-headless-toggle">
          <input
            checked={runnerSubmitApproved}
            type="checkbox"
            onChange={(event) => onRunnerSubmitApprovedChange(event.target.checked)}
          />
          Approve live posting
        </label>
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
                        <div>
                          <strong>{item.status === "failed" ? "Why this failed" : "Needs review because"}</strong>
                          <span>{queueItemExplanation(item)}</span>
                          <small>{recoveryGuidance(item)}</small>
                        </div>
                        <div className="queue-item-actions queue-item-review-actions">
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => onRetryQueueItemTestRun(item.id)}
                          >
                            <TestTube2 size={16} />
                            Retry test run
                          </button>
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
                        </div>
                      </div>
                    ) : null}
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

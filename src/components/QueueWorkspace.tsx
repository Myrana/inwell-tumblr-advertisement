import { Archive, ChevronDown, FilePlus2, ListChecks, Pencil, Send, TestTube2 } from "lucide-react";
import { useState } from "react";
import { formatDate, formatSubmissionStatus } from "../domain/format";
import { isCompletedQueueItem, postHistoryArchiveItems } from "../domain/queue";
import { queueLogGroups, runnerLogExplanation, runnerLogPostedUrl, visibleRunnerLogs } from "../domain/runnerLogs";
import { formatEasternRun, nextDailyRunAt, scheduleSummary } from "../domain/schedule";
import {
  QueueDefinition,
  QueueSchedulePreference,
  RunnerLog,
  SubmissionQueueItem,
  SubmissionStatus,
} from "../domain/types";

type QueueWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  queueStatus: string;
  queueScheduleSettings: QueueSchedulePreference;
  runnerLogs: RunnerLog[];
  onEditQueueItem: (id: string) => void;
  onRenameQueue: (currentName: string, nextName: string) => void;
  onSelectQueue: (queueName: string) => void;
  onQueueScheduleSettingsChange: (patch: Partial<QueueSchedulePreference>) => void;
  onRetryQueueItemTestRun: (id: string) => void;
  onBulkUpdateQueueItems: (ids: string[], status: SubmissionStatus, notes: string) => void;
  onUpdateQueueItem: (id: string, status: SubmissionStatus, notes: string) => void;
  onCreateSubmission: () => void;
  onManageBlogs: () => void;
};

type QueueSectionKey = "overview" | "schedule" | "submissions" | "history";

const schedulePresets = [
  { label: "Morning", value: "09:00" },
  { label: "Afternoon", value: "13:00" },
  { label: "Evening", value: "18:00" },
];

export function QueueWorkspace({
  activeQueue,
  activeQueueName,
  queueOptions,
  queueStatus,
  queueScheduleSettings,
  runnerLogs,
  onEditQueueItem,
  onRenameQueue,
  onSelectQueue,
  onQueueScheduleSettingsChange,
  onRetryQueueItemTestRun,
  onBulkUpdateQueueItems,
  onUpdateQueueItem,
  onCreateSubmission,
  onManageBlogs,
}: QueueWorkspaceProps) {
  const [openSections, setOpenSections] = useState<Record<QueueSectionKey, boolean>>({
    overview: true,
    schedule: false,
    submissions: true,
    history: true,
  });
  const [selectedQueueItemIds, setSelectedQueueItemIds] = useState<string[]>([]);
  const [bulkQueueStatus, setBulkQueueStatus] = useState<SubmissionStatus>("queued");
  const [bulkQueueNotes, setBulkQueueNotes] = useState("Bulk updated from queue workspace.");
  const statusCounts = activeQueue.reduce<Record<SubmissionStatus, number>>(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { queued: 0, scheduled: 0, running: 0, submitted: 0, posted: 0, "needs-review": 0, failed: 0 },
  );
  const scopedLogs = visibleRunnerLogs(runnerLogs, false);
  const logGroups = queueLogGroups(activeQueue, scopedLogs);
  const allLogGroups = queueLogGroups(activeQueue, runnerLogs);
  const nextRunAt = queueScheduleSettings.enabled ? nextDailyRunAt(queueScheduleSettings) : "";
  const activeSubmissionItems = activeQueue.filter((item) => !isCompletedQueueItem(item));
  const postHistoryItems = postHistoryArchiveItems(activeQueue);
  const selectedActiveQueueCount = selectedQueueItemIds.filter((id) => activeSubmissionItems.some((item) => item.id === id)).length;

  function queueItemExplanation(item: SubmissionQueueItem) {
    const logs = logGroups.find((group) => group.item.id === item.id)?.logs ?? [];
    const reviewLog = logs.find((log) => log.level === "error") ?? logs.find((log) => log.level === "warning");
    return reviewLog ? runnerLogExplanation(reviewLog) || reviewLog.message : item.notes;
  }

  function queueItemPostedUrl(item: SubmissionQueueItem) {
    const logs = allLogGroups.find((group) => group.item.id === item.id)?.logs ?? [];
    const postedLog = [...logs].reverse().find((log) => runnerLogPostedUrl(log));
    return postedLog ? runnerLogPostedUrl(postedLog) : "";
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

  function toggleQueueItemSelection(itemId: string, selected: boolean) {
    setSelectedQueueItemIds((current) => (selected ? Array.from(new Set([...current, itemId])) : current.filter((id) => id !== itemId)));
  }

  function applyBulkQueueUpdate() {
    const selectedIds = selectedQueueItemIds.filter((id) => activeSubmissionItems.some((item) => item.id === id));
    if (!selectedIds.length) {
      return;
    }

    onBulkUpdateQueueItems(selectedIds, bulkQueueStatus, bulkQueueNotes);
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
                    disabled={!queueScheduleSettings.enabled}
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
              <div className="schedule-preset-row" aria-label="Schedule presets">
                {schedulePresets.map((preset) => (
                  <button
                    className={queueScheduleSettings.dailyTime === preset.value ? "secondary active" : "secondary"}
                    disabled={!queueScheduleSettings.enabled}
                    key={preset.value}
                    type="button"
                    onClick={() => onQueueScheduleSettingsChange({ dailyTime: preset.value })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="queue-schedule-summary">{scheduleSummary(queueScheduleSettings)}</p>
              <p className="queue-empty">This schedule applies only to {activeQueueName || "the selected queue"}.</p>
              {nextRunAt ? <p className="queue-empty">Next queued local run: {formatEasternRun(nextRunAt)} ET</p> : null}
            </div>
          </div>
        ) : null}
      </section>

      {queueStatus ? <p className="queue-status">{queueStatus}</p> : null}

      <section className="workflow-section queue-workflow-section">
        <div className="workflow-section-header">
          {sectionToggle("submissions", "Queued submissions", `${activeSubmissionItems.length} active item${activeSubmissionItems.length === 1 ? "" : "s"}`)}
          <span className={activeSubmissionItems.length ? "section-state ready" : "section-state warning"}>{activeSubmissionItems.length ? "Ready" : "Empty"}</span>
        </div>

        {openSections.submissions ? (
          <div className="workflow-section-body">
            {activeSubmissionItems.length ? (
              <div className="bulk-edit-panel" aria-label="Queue bulk editor">
                <label className="bulk-select">
                  <input
                    checked={selectedActiveQueueCount === activeSubmissionItems.length}
                    type="checkbox"
                    onChange={(event) => setSelectedQueueItemIds(event.target.checked ? activeSubmissionItems.map((item) => item.id) : [])}
                  />
                  Select all pending items
                </label>
                <label>
                  Status
                  <select value={bulkQueueStatus} onChange={(event) => setBulkQueueStatus(event.target.value as SubmissionStatus)}>
                    <option value="queued">Queued</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="needs-review">Needs review</option>
                    <option value="failed">Failed</option>
                    <option value="posted">Posted</option>
                    <option value="submitted">Submitted</option>
                  </select>
                </label>
                <label>
                  Notes
                  <input value={bulkQueueNotes} onChange={(event) => setBulkQueueNotes(event.target.value)} />
                </label>
                <button className="secondary compact-button" type="button" onClick={applyBulkQueueUpdate} disabled={!selectedActiveQueueCount}>
                  Update {selectedActiveQueueCount || "selected"}
                </button>
              </div>
            ) : null}
            <div className="queue-list">
              {activeSubmissionItems.length ? (
                activeSubmissionItems.map((item) => (
                  <article className="queue-item" key={item.id}>
                    {(() => {
                      const postedUrl = queueItemPostedUrl(item);
                      return postedUrl ? (
                        <a className="queue-posted-link" href={postedUrl} target="_blank" rel="noreferrer">
                          Posted Tumblr link
                        </a>
                      ) : null;
                    })()}
                    <div className="queue-item-header">
                      <div>
                        <label className="bulk-select row-select">
                          <input
                            checked={selectedQueueItemIds.includes(item.id)}
                            type="checkbox"
                            onChange={(event) => toggleQueueItemSelection(item.id, event.target.checked)}
                          />
                          Select queue item
                        </label>
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
                <div className="queue-empty action-empty">
                  <strong>No submissions queued for {activeQueueName || "this lane"}.</strong>
                  <span>Write an advertisement, then add it to a blog lane when it is ready.</span>
                  <div className="empty-action-row">
                    <button className="primary compact-button" type="button" onClick={onCreateSubmission}>
                      <FilePlus2 size={16} />
                      Write advertisement
                    </button>
                    <button className="secondary compact-button" type="button" onClick={onManageBlogs}>
                      <ListChecks size={16} />
                      Blog tracker
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="workflow-section queue-workflow-section" aria-label="Post history archive">
        <div className="workflow-section-header">
          {sectionToggle("history", "Post history", `${postHistoryItems.length} completed item${postHistoryItems.length === 1 ? "" : "s"}`)}
          <span className={postHistoryItems.length ? "section-state ready" : "section-state warning"}>{postHistoryItems.length ? "Archived" : "Empty"}</span>
        </div>

        {openSections.history ? (
          <div className="workflow-section-body">
            {postHistoryItems.length ? (
              <div className="post-history-list">
                {postHistoryItems.map((item) => {
                  const postedUrl = queueItemPostedUrl(item);
                  const completedAt = item.postedAt || item.updatedAt;

                  return (
                    <article className="post-history-item" key={item.id}>
                      <div className="post-history-heading">
                        <Archive size={18} />
                        <div>
                          <strong>{item.targetName}</strong>
                          <span>{formatSubmissionStatus(item.status)} - {formatDate(completedAt)}</span>
                        </div>
                      </div>
                      <div className="post-history-meta">
                        <span><b>Type</b>{item.postType}</span>
                        <span><b>Queue</b>{item.queueName}</span>
                        <span><b>Updated</b>{formatDate(item.updatedAt)}</span>
                      </div>
                      {item.notes ? <p>{item.notes}</p> : null}
                      <div className="post-history-actions">
                        {postedUrl ? (
                          <a className="queue-posted-link" href={postedUrl} target="_blank" rel="noreferrer">
                            Posted Tumblr link
                          </a>
                        ) : null}
                        <button className="secondary compact-button" type="button" onClick={() => onEditQueueItem(item.id)}>
                          <Pencil size={16} />
                          Edit archived post
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="queue-empty">Completed Tumblr submissions will appear here after they are marked submitted or posted.</p>
            )}
          </div>
        ) : null}
      </section>
    </section>
  );
}

import { AlertTriangle, Archive, ChevronDown, Clipboard, FilePlus2, ListChecks, Pencil, PlayCircle, Send, TestTube2 } from "lucide-react";
import { useState } from "react";
import { formatDate, formatSubmissionStatus } from "../domain/format";
import { isCompletedQueueItem, postHistoryArchiveItems } from "../domain/queue";
import { attentionQueueItems, automationRunnableQueueItems, queueFlowSummary, queueReadiness } from "../domain/queueAutomation";
import { queueLogGroups, runnerLogExplanation, runnerLogPostedUrl, visibleRunnerLogs } from "../domain/runnerLogs";
import { formatEasternRun, nextDailyRunAt, scheduleSummary } from "../domain/schedule";
import { ScheduleRunnerReadiness } from "../domain/localRunnerReadiness";
import { runnerAccountReadiness } from "../domain/tumblrAccounts";
import { QueueItemMetaRow } from "./queue/QueueItemMetaRow";
import { QueueItemThumbnail } from "./queue/QueueItemThumbnail";
import { QueueFlowOverview, QueueFlowSummaryPanel } from "./queue/QueueFlowSummaryPanel";
import { QueueScheduleReadinessGrid } from "./queue/QueueScheduleReadinessGrid";
import { WorkspaceActionButton, WorkspaceActionRow } from "./ui/WorkspaceActions";
import "./queue/queueWorkspace.css";
import {
  QueueDefinition,
  QueueSchedulePreference,
  Advertisement,
  RunnerActivity,
  RunnerLog,
  SubmissionQueueItem,
  SubmissionStatus,
  TumblrSubmitTarget,
  TumblrAccount,
  WorkspaceView,
} from "../domain/types";

type QueueWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  queueStatus: string;
  queueTransitionBusy: boolean;
  queueScheduleSettings: QueueSchedulePreference;
  runnerActivity: RunnerActivity;
  scheduleRunnerReadiness: ScheduleRunnerReadiness;
  runnerSubmitApproved: boolean;
  savedDraftCount: number;
  sourceAds: Advertisement[];
  submitTargets: TumblrSubmitTarget[];
  selectedTumblrAccountId: string;
  tumblrAccounts: TumblrAccount[];
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
  onManageAccounts: () => void;
  onOpenSavedLibrary: () => void;
  onOpenRunner: () => void;
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
  queueTransitionBusy,
  queueScheduleSettings,
  runnerActivity,
  scheduleRunnerReadiness,
  runnerSubmitApproved,
  savedDraftCount,
  sourceAds,
  submitTargets,
  selectedTumblrAccountId,
  tumblrAccounts,
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
  onManageAccounts,
  onOpenSavedLibrary,
  onOpenRunner,
}: QueueWorkspaceProps) {
  const [openSections, setOpenSections] = useState<Record<QueueSectionKey, boolean>>({
    overview: true,
    schedule: false,
    submissions: true,
    history: true,
  });
  const [selectedQueueItemIds, setSelectedQueueItemIds] = useState<string[]>([]);
  const [copiedDiscordItemId, setCopiedDiscordItemId] = useState("");
  const [copiedAllDiscordUpdates, setCopiedAllDiscordUpdates] = useState(false);
  const [postHistoryCopyStatus, setPostHistoryCopyStatus] = useState("");
  const [bulkQueueStatus, setBulkQueueStatus] = useState<SubmissionStatus>("queued");
  const [bulkQueueNotes, setBulkQueueNotes] = useState("Bulk updated from queue workspace.");
  const [localQueueActionBusy, setLocalQueueActionBusy] = useState(false);
  const statusCounts = activeQueue.reduce<Record<SubmissionStatus, number>>(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { queued: 0, scheduled: 0, running: 0, submitted: 0, posted: 0, "needs-review": 0, failed: 0 },
  );
  const scopedLogs = visibleRunnerLogs(runnerLogs, false);
  const logGroups = queueLogGroups(activeQueue, scopedLogs);
  const allLogGroups = queueLogGroups(activeQueue, runnerLogs);
  const nextRunAt = queueScheduleSettings.enabled ? nextDailyRunAt(queueScheduleSettings) : "";
  const scheduleRunnerBlocked = queueScheduleSettings.enabled && !scheduleRunnerReadiness.ready;
  const activeSubmissionItems = activeQueue.filter((item) => !isCompletedQueueItem(item));
  const automationRunnableItems = automationRunnableQueueItems(activeQueue);
  const attentionItems = attentionQueueItems(activeQueue);
  const postHistoryItems = postHistoryArchiveItems(activeQueue);
  const accountReadiness = runnerAccountReadiness(tumblrAccounts, selectedTumblrAccountId);
  const connectedAccountCount = accountReadiness.connectedAccounts.length;
  const selectedActiveQueueCount = selectedQueueItemIds.filter((id) => activeSubmissionItems.some((item) => item.id === id)).length;
  const scheduleWillRun = queueScheduleSettings.enabled && !scheduleRunnerBlocked && accountReadiness.ready && automationRunnableItems.length > 0;
  const scheduleAutomationBlocker = scheduleRunnerBlocked
    ? { label: scheduleRunnerReadiness.label, detail: scheduleRunnerReadiness.detail || runnerActivity.detail }
    : !accountReadiness.ready
      ? { label: "Needs account", detail: accountReadiness.blocker || "Select a connected Tumblr account." }
      : null;
  const queueActionsBusy = queueTransitionBusy || localQueueActionBusy;
  const queueRunnerReadiness = queueReadiness({
    activeQueueName,
    activeQueue,
    connectedAccountCount,
    runnerActivity,
    scheduledRunnerReady: scheduleRunnerReadiness.ready,
    scheduledRunnerDetail: scheduleRunnerReadiness.detail,
    accountBlocker: accountReadiness.blocker,
    selectedConnectedAccount: accountReadiness.ready,
    savedDraftCount,
    submitApproved: runnerSubmitApproved,
  });
  const queueRunnerReady = queueRunnerReadiness.canRun;
  const queueRunnerBannerTitle = queueRunnerReady ? "Runner is available for this queue" : queueRunnerReadiness.title;
  const queueRunnerBannerDetail = queueRunnerReady ? `${runnerActivity.status}: ${queueRunnerReadiness.detail}` : queueRunnerReadiness.detail;
  const flowSummary = queueFlowSummary({
    activeQueue,
    activeQueueName,
    queueScheduleEnabled: queueScheduleSettings.enabled,
    runnerDetail: scheduleRunnerReadiness.detail || runnerActivity.detail,
    runnerReady: scheduleRunnerReadiness.ready,
    savedDraftCount,
    selectedConnectedAccount: accountReadiness.ready,
    sourceAds,
    submitTargets,
  });
  const queueRunnerAction = queueRunnerReady ? { label: "Runner Controls", action: onOpenRunner } : queueRunnerActionFor(queueRunnerReadiness.primaryAction.view, {
    onCreateSubmission,
    onManageAccounts,
    onManageBlogs,
    onOpenSavedLibrary,
    onOpenRunner,
    onReviewQueue: () => setSectionOpen("submissions", true),
  });

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

  function discordCompletionMessage(item: SubmissionQueueItem) {
    const completedAt = item.postedAt || item.updatedAt || item.createdAt;
    return `\u2705 Advert posted\n\nQueue: ${item.queueName}\nTarget: ${item.targetName}\nPosted at: ${formatDiscordPostedAt(completedAt)}`;
  }

  async function copyDiscordCompletionMessage(item: SubmissionQueueItem) {
    if (!navigator.clipboard?.writeText) {
      setPostHistoryCopyStatus("Clipboard is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(discordCompletionMessage(item));
      setCopiedDiscordItemId(item.id);
      setCopiedAllDiscordUpdates(false);
      setPostHistoryCopyStatus("Discord update copied.");
    } catch {
      setPostHistoryCopyStatus("Could not copy Discord update. Check browser clipboard permission.");
    }
  }

  async function copyAllDiscordCompletionMessages() {
    if (!navigator.clipboard?.writeText || !postHistoryItems.length) {
      setPostHistoryCopyStatus("Clipboard is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(postHistoryItems.map(discordCompletionMessage).join("\n\n---\n\n"));
      setCopiedAllDiscordUpdates(true);
      setCopiedDiscordItemId("");
      setPostHistoryCopyStatus("Discord updates copied.");
    } catch {
      setPostHistoryCopyStatus("Could not copy Discord updates. Check browser clipboard permission.");
    }
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

    void runQueueAction(() => onBulkUpdateQueueItems(selectedIds, bulkQueueStatus, bulkQueueNotes));
  }

  async function runQueueAction(action: () => unknown | Promise<unknown>) {
    setLocalQueueActionBusy(true);
    try {
      await action();
    } finally {
      setLocalQueueActionBusy(false);
    }
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

      <QueueFlowSummaryPanel
        activeQueueName={activeQueueName}
        attentionCount={attentionItems.length}
        completedCount={postHistoryItems.length}
        flowSummary={flowSummary}
        nextRunLabel={nextRunAt ? ` Next local run is ${formatEasternRun(nextRunAt)} ET.` : " Daily automation is off."}
        runnableCount={automationRunnableItems.length}
        onCreateSubmission={onCreateSubmission}
        onOpenRunner={onOpenRunner}
      />

      {attentionItems.length ? (
        <section className="queue-attention-banner" aria-label="Queue review required">
          <AlertTriangle size={24} />
          <div>
            <strong>{attentionItems.length} item{attentionItems.length === 1 ? "" : "s"} need review</strong>
            <span>
              {automationRunnableItems.length
                ? "Review items are parked; runnable submissions can continue."
                : "Clear failed or review-needed submissions before relying on automation."}
            </span>
          </div>
          <WorkspaceActionButton variant="primary" compact icon={<PlayCircle size={16} />} onClick={() => setSectionOpen("submissions", true)}>
            Review queue
          </WorkspaceActionButton>
        </section>
      ) : null}

      <section className={queueRunnerReady ? "queue-runner-banner ready" : "queue-runner-banner"} aria-label="Queue runner status">
        <div>
          <strong>{queueRunnerBannerTitle}</strong>
          <span>{queueRunnerBannerDetail}</span>
        </div>
        <WorkspaceActionButton variant={queueRunnerReady ? "tertiary" : "primary"} compact icon={<PlayCircle size={16} />} onClick={queueRunnerAction.action}>
          {queueRunnerAction.label}
        </WorkspaceActionButton>
      </section>

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
            <QueueFlowOverview
              activeQueue={activeQueue}
              activeQueueName={activeQueueName}
              flowSummary={flowSummary}
              statusCounts={statusCounts}
            />
          </div>
        ) : null}
      </section>

      <section className="workflow-section queue-workflow-section">
        <div className="workflow-section-header">
          {sectionToggle("schedule", "Schedule", scheduleSummary(queueScheduleSettings))}
          <span className={queueScheduleSettings.enabled && !scheduleRunnerBlocked ? "section-state ready" : "section-state warning"}>
            {scheduleRunnerBlocked ? scheduleRunnerReadiness.label : queueScheduleSettings.enabled ? "On" : "Off"}
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
              <QueueScheduleReadinessGrid
                runnableItemCount={automationRunnableItems.length}
                attentionItemCount={attentionItems.length}
                automationBlockedDetail={scheduleAutomationBlocker?.detail}
                automationBlockedLabel={scheduleAutomationBlocker?.label}
                enabled={queueScheduleSettings.enabled}
                nextRunAt={nextRunAt}
                runnerReady={scheduleRunnerReadiness.ready}
                willRun={scheduleWillRun}
              />
              {scheduleRunnerBlocked ? (
                <div className="queue-item-explanation warning queue-schedule-recovery" role="status">
                  <div>
                    <strong>Daily automation is waiting for the local runner</strong>
                    <span>{scheduleRunnerReadiness.detail || runnerActivity.detail}</span>
                    <small>If the scheduled time already passed today, open Runner controls and run this queue once after the runner is watching.</small>
                  </div>
                  <WorkspaceActionButton variant="secondary" compact icon={<PlayCircle size={16} />} onClick={onOpenRunner}>
                    Open runner
                  </WorkspaceActionButton>
                </div>
              ) : null}
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
                <WorkspaceActionButton variant="secondary" compact onClick={applyBulkQueueUpdate} disabled={!selectedActiveQueueCount || queueActionsBusy}>
                  Update {selectedActiveQueueCount || "selected"}
                </WorkspaceActionButton>
              </div>
            ) : null}
            <div className="queue-list">
              {activeSubmissionItems.length ? (
                [...flowSummary.lanes.runnable, ...flowSummary.lanes.running, ...flowSummary.lanes.attention].map((item) => (
                  <article className="queue-item density-surface" key={item.id}>
                    {(() => {
                      const postedUrl = queueItemPostedUrl(item);
                      return postedUrl ? (
                        <a className="queue-posted-link" href={postedUrl} target="_blank" rel="noreferrer">
                          Posted Tumblr link
                        </a>
                      ) : null;
                    })()}
                    <div className="queue-item-header">
                      <QueueItemThumbnail postType={item.postType} />
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
                        <span>{item.postType} - {flowSummary.statusLabels[item.status]} - {formatDate(item.updatedAt)}</span>
                        <QueueItemMetaRow item={item} />
                        <a href={item.submitUrl} target="_blank" rel="noreferrer">
                          {item.submitUrl}
                        </a>
                      </div>
                      <WorkspaceActionButton variant="secondary" icon={<Pencil size={16} />} onClick={() => onEditQueueItem(item.id)}>
                        Edit submission
                      </WorkspaceActionButton>
                    </div>
                    {item.status === "failed" || item.status === "needs-review" ? null : <p>{item.notes}</p>}
                    {item.status === "failed" || item.status === "needs-review" ? (
                      <div className={`queue-item-explanation ${item.status === "failed" ? "failed" : "warning"}`} role="status">
                        <div>
                          <strong>{item.status === "failed" ? "Why this failed" : "Needs review because"}</strong>
                          <span>{queueItemExplanation(item)}</span>
                          <small>{recoveryGuidance(item)}</small>
                        </div>
                        <WorkspaceActionRow className="queue-item-actions queue-item-review-actions">
                          <WorkspaceActionButton
                            variant="secondary"
                            icon={<TestTube2 size={16} />}
                            disabled={queueActionsBusy}
                            onClick={() => void runQueueAction(() => onRetryQueueItemTestRun(item.id))}
                          >
                            Retry test run
                          </WorkspaceActionButton>
                          <WorkspaceActionButton
                            variant="secondary"
                            disabled={queueActionsBusy}
                            onClick={() => void runQueueAction(() => onUpdateQueueItem(item.id, "queued", "Requeued for the next automation run."))}
                          >
                            Requeue
                          </WorkspaceActionButton>
                          <WorkspaceActionButton
                            variant="secondary"
                            disabled={queueActionsBusy}
                            onClick={() => void runQueueAction(() => onUpdateQueueItem(item.id, "posted", "Marked posted after Tumblr accepted the form."))}
                          >
                            Mark posted
                          </WorkspaceActionButton>
                        </WorkspaceActionRow>
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
                  <span>{flowSummary.emptyReasons[0] || "Write an advertisement, then add it to a blog lane when it is ready."}</span>
                  {flowSummary.emptyReasons.length > 1 ? (
                    <ul className="queue-empty-reasons">
                      {flowSummary.emptyReasons.slice(1).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : null}
                  <WorkspaceActionRow className="empty-action-row">
                    <WorkspaceActionButton variant="primary" compact icon={<FilePlus2 size={16} />} onClick={onCreateSubmission}>
                      Write advertisement
                    </WorkspaceActionButton>
                    <WorkspaceActionButton variant="tertiary" compact icon={<ListChecks size={16} />} onClick={onManageBlogs}>
                      Blog tracker
                    </WorkspaceActionButton>
                  </WorkspaceActionRow>
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
              <>
                <div className="post-history-actions">
                  <WorkspaceActionButton variant="secondary" compact icon={<Clipboard size={16} />} onClick={() => void copyAllDiscordCompletionMessages()}>
                    {copiedAllDiscordUpdates ? "All Discord updates copied" : "Copy all Discord updates"}
                  </WorkspaceActionButton>
                </div>
                {postHistoryCopyStatus ? <p className="queue-status" role="status">{postHistoryCopyStatus}</p> : null}
                <div className="post-history-list compact-history">
                  {postHistoryItems.map((item) => {
                    const postedUrl = queueItemPostedUrl(item);
                    const completedAt = item.postedAt || item.updatedAt;

                    return (
                      <article className="post-history-item density-surface" key={item.id}>
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
                          <WorkspaceActionButton variant="secondary" compact icon={<Pencil size={16} />} onClick={() => onEditQueueItem(item.id)}>
                            Edit archived post
                          </WorkspaceActionButton>
                          <WorkspaceActionButton variant="secondary" compact icon={<Clipboard size={16} />} onClick={() => void copyDiscordCompletionMessage(item)}>
                            {copiedDiscordItemId === item.id ? "Discord update copied" : "Copy Discord update"}
                          </WorkspaceActionButton>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="queue-empty action-empty">
                <strong>No completed submissions yet.</strong>
                <span>Completed Tumblr submissions will appear here after they are marked submitted or posted.</span>
                <WorkspaceActionRow className="empty-action-row">
                  <WorkspaceActionButton variant="tertiary" compact icon={<PlayCircle size={16} />} onClick={onOpenRunner}>
                    Runner controls
                  </WorkspaceActionButton>
                  <WorkspaceActionButton variant="tertiary" compact icon={<FilePlus2 size={16} />} onClick={onCreateSubmission}>
                    Write advertisement
                  </WorkspaceActionButton>
                </WorkspaceActionRow>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </section>
  );
}

function queueRunnerActionFor(view: WorkspaceView, actions: {
  onCreateSubmission: () => void;
  onManageAccounts: () => void;
  onManageBlogs: () => void;
  onOpenSavedLibrary: () => void;
  onOpenRunner: () => void;
  onReviewQueue: () => void;
}) {
  if (view === "queue") {
    return { label: "Review queue", action: actions.onReviewQueue };
  }
  if (view === "accounts") {
    return { label: "Manage accounts", action: actions.onManageAccounts };
  }
  if (view === "editor" || view === "saved") {
    return view === "saved"
      ? { label: "Open content", action: actions.onOpenSavedLibrary }
      : { label: "Write Advertisement", action: actions.onCreateSubmission };
  }
  if (view === "queue-settings") {
    return { label: "Blog tracker", action: actions.onManageBlogs };
  }
  if (view === "runner") {
    return { label: "Launch Runner", action: actions.onOpenRunner };
  }
  return { label: "Review queue", action: actions.onReviewQueue };
}

function formatDiscordPostedAt(value: string) {
  const parts = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("month")} ${part("day")}, ${part("year")} ${part("hour")}:${part("minute")} ${part("dayPeriod")}`.trim();
}

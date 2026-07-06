import { Activity, Download, ListChecks, Play, PlugZap, Send, Terminal, TestTube2 } from "lucide-react";
import { formatDate } from "../domain/format";
import type { LocalCompanionStatus } from "../domain/api";
import type { ScheduleRunnerReadiness } from "../domain/localRunnerReadiness";
import { attentionQueueItems, runnableQueueItems, runnerExecutionReadiness as buildRunnerExecutionReadiness } from "../domain/queueAutomation";
import { latestRunnerRunId, runnerLogRunGroups } from "../domain/runnerLogs";
import { runnerAccountReadiness } from "../domain/tumblrAccounts";
import { RunnerFlowStrip } from "./runner/RunnerFlowStrip";
import "./runner/runnerWorkspace.css";
import {
  QueueDefinition,
  RunnerActivity,
  RunnerLog,
  RunnerStatus,
  SubmissionQueueItem,
  TumblrAccount,
} from "../domain/types";

const minimumDiscordWebhookRunnerVersion = 3;

type RunnerWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  queueStatus: string;
  discordWebhookConfigured: boolean;
  localCompanion: LocalCompanionStatus | null;
  runnerActivity: RunnerActivity;
  runnerConnectionLabel: string;
  scheduleRunnerReadiness: ScheduleRunnerReadiness;
  runnerHeadless: boolean;
  runnerLogs: RunnerLog[];
  runnerState: RunnerStatus | null;
  runnerSubmitApproved: boolean;
  selectedTumblrAccountId: string;
  showLaunchLocalRunner: boolean;
  tumblrAccounts: TumblrAccount[];
  onCopyLocalRunnerSetup: () => void;
  onDownloadLocalRunner: () => void;
  onLaunchLocalRunner: () => void;
  onNavigateAccounts: () => void;
  onNavigateLogs: () => void;
  onNavigateQueue: () => void;
  onRunnerHeadlessChange: (headless: boolean) => void;
  onRunnerSubmitApprovedChange: (submit: boolean) => void;
  onStartRunner: () => void;
  onStartTestRun: () => void;
};

export function RunnerWorkspace({
  activeQueue,
  activeQueueName,
  queueOptions,
  queueStatus,
  discordWebhookConfigured,
  localCompanion,
  runnerActivity,
  runnerConnectionLabel,
  scheduleRunnerReadiness,
  runnerHeadless,
  runnerLogs,
  runnerState,
  runnerSubmitApproved,
  selectedTumblrAccountId,
  showLaunchLocalRunner,
  tumblrAccounts,
  onCopyLocalRunnerSetup,
  onDownloadLocalRunner,
  onLaunchLocalRunner,
  onNavigateAccounts,
  onNavigateLogs,
  onNavigateQueue,
  onRunnerHeadlessChange,
  onRunnerSubmitApprovedChange,
  onStartRunner,
  onStartTestRun,
}: RunnerWorkspaceProps) {
  const runnableItems = runnableQueueItems(activeQueue);
  const attentionItems = attentionQueueItems(activeQueue);
  const accountReadiness = runnerAccountReadiness(tumblrAccounts, selectedTumblrAccountId);
  const connectedAccounts = accountReadiness.connectedAccounts;
  const selectedConnectedAccount = accountReadiness.readyAccount;
  const latestRunId = latestRunnerRunId(runnerLogs);
  const latestRunGroup = runnerLogRunGroups(runnerLogs)[0] ?? null;
  const localRunner = runnerState?.local_runner;
  const companionVersion = localCompanion?.version || localRunner?.version || "";
  const hasRunnerVersionEvidence = Boolean((localCompanion?.ok || localRunner?.online) && companionVersion);
  const runnerVersionNumber = localRunnerVersionNumber(companionVersion);
  const discordRunnerTooOld = Boolean(discordWebhookConfigured && hasRunnerVersionEvidence && runnerVersionNumber !== null && runnerVersionNumber < minimumDiscordWebhookRunnerVersion);
  const discordRunnerUnverified = Boolean(discordWebhookConfigured && (!hasRunnerVersionEvidence || runnerVersionNumber === null));
  const discordRunnerNeedsAttention = discordRunnerTooOld || discordRunnerUnverified;
  const discordSummary = localCompanion?.lastDiscordSummary || localCompanion?.lastRun?.discordSummary || null;
  const discordSummaryDetail = discordRunnerTooOld
    ? "Discord webhook saved, but this local runner is older. Restart or download the runner before expecting Discord summaries."
    : discordRunnerUnverified
      ? "Discord webhook saved, but this runner version could not be verified. Restart or download the runner before expecting Discord summaries."
    : discordSummary?.message || (discordWebhookConfigured ? "Discord summaries will post after live runs." : "Save a Discord webhook in Settings to post live run summaries.");
  const runnerExecutionReadiness = buildRunnerExecutionReadiness({
    activeQueueName,
    activeQueue,
    connectedAccountCount: connectedAccounts.length,
    scheduledRunnerReady: scheduleRunnerReadiness.ready,
    scheduledRunnerDetail: scheduleRunnerReadiness.detail,
    accountBlocker: accountReadiness.blocker,
    selectedAccountName: selectedConnectedAccount?.displayName || "",
    selectedConnectedAccount: accountReadiness.ready,
  });
  const showInstallGuide = !localRunner?.online && !runnableItems.length;
  const readinessItems = [
    {
      label: "Local companion",
      ready: scheduleRunnerReadiness.ready,
      detail: scheduleRunnerReadiness.ready || scheduleRunnerReadiness.status === "needs-attention" ? runnerConnectionLabel : scheduleRunnerReadiness.detail,
    },
    {
      label: "Tumblr account",
      ready: accountReadiness.ready,
      detail: selectedConnectedAccount ? `${selectedConnectedAccount.displayName} selected for runs.` : accountReadiness.blocker || "Select a connected account before live runs.",
    },
    {
      label: "Queue content",
      ready: runnableItems.length > 0,
      detail: `${runnableItems.length} runnable in ${activeQueueName || "selected queue"}.`,
    },
    {
      label: "Live posting",
      ready: runnerSubmitApproved,
      detail: runnerSubmitApproved ? "Approved for submission." : "Test/prep mode until approved.",
    },
    {
      label: "Discord summary",
      ready: !discordRunnerNeedsAttention,
      detail: discordSummaryDetail,
    },
  ];
  const diagnostics = [
    { label: "Runner version", ready: hasRunnerVersionEvidence, detail: companionVersion || "Unknown" },
    {
      label: "Tumblr auth",
      ready: accountReadiness.ready,
      detail: selectedConnectedAccount
        ? `${selectedConnectedAccount.displayName} selected for runs`
        : accountReadiness.blocker || "No connected account",
    },
    { label: "Queue integrity", ready: runnableItems.length > 0 && attentionItems.length === 0, detail: attentionItems.length ? `${attentionItems.length} need review` : `${runnableItems.length} runnable` },
    { label: "Discord summary", ready: !discordRunnerNeedsAttention, detail: discordWebhookConfigured ? "Configured" : "Optional" },
  ];

  return (
    <section className="submission-queue-panel queue-workspace runner-workspace" aria-label="Runner workspace">
      <section className="runner-hero" aria-label="Runner status">
        <div>
          <span>Runner mission control</span>
          <h2>{runnerExecutionReadiness.title}</h2>
          <p>
            {runnerExecutionReadiness.detail} {runnerActivity.detail}
          </p>
        </div>
        <div className="runner-hero-actions">
          <button className="primary" type="button" onClick={onStartRunner} disabled={!runnerExecutionReadiness.manualCanRun}>
            <Play size={18} />
            Run queue
          </button>
          <button className="secondary" type="button" onClick={onStartTestRun} disabled={!runnerExecutionReadiness.manualCanRun}>
            <TestTube2 size={18} />
            Test run
          </button>
        </div>
      </section>

      <section className="runner-mission-summary" aria-label="Runner health summary">
        <article className={runnerExecutionReadiness.ready ? "ready" : ""}>
          <strong>{runnerActivity.status}</strong>
          <span>Runner state</span>
        </article>
        <article className={connectedAccounts.length ? "ready" : ""}>
          <strong>{connectedAccounts.length}</strong>
          <span>Accounts</span>
        </article>
        <article className={runnableItems.length ? "ready" : ""}>
          <strong>{runnableItems.length}</strong>
          <span>Runnable</span>
        </article>
        <article className={runnerSubmitApproved ? "ready" : ""}>
          <strong>{runnerSubmitApproved ? "Live" : "Test"}</strong>
          <span>Mode</span>
        </article>
      </section>

      <RunnerFlowStrip
        attentionCount={attentionItems.length}
        connectedAccountCount={connectedAccounts.length}
        latestRunGroup={latestRunGroup}
        runnableCount={runnableItems.length}
        runnerReady={runnerExecutionReadiness.ready}
        submitApproved={runnerSubmitApproved}
      />

      {showInstallGuide ? (
        <section className="runner-install-guide" aria-label="Install local runner">
          <div>
            <span className="panel-kicker">Install local runner</span>
            <h2>Set up this computer before live automation</h2>
            <p>Download the runner, connect a Tumblr account, then add a queued ad. Test run fills Tumblr without submitting.</p>
          </div>
          <div className="runner-install-steps">
            <article>
              <strong>1. Download</strong>
              <span>Install the local runner once on this computer.</span>
            </article>
            <article>
              <strong>2. Connect</strong>
              <span>Open Tumblr login through the runner and select the account.</span>
            </article>
            <article>
              <strong>3. Test run</strong>
              <span>Prepare Tumblr first, then approve live posting only when the queue looks right.</span>
            </article>
          </div>
          <div className="runner-install-actions">
            <button className="primary compact-button" type="button" onClick={onDownloadLocalRunner}>
              <Download size={16} />
              Download runner
            </button>
            {showLaunchLocalRunner ? (
              <button className="secondary compact-button" type="button" onClick={onLaunchLocalRunner}>
                <PlugZap size={16} />
                Start runner
              </button>
            ) : null}
            <button className="secondary compact-button" type="button" onClick={onNavigateAccounts}>
              Manage accounts
            </button>
            <button className="secondary compact-button" type="button" onClick={onNavigateQueue}>
              Open queue
            </button>
          </div>
        </section>
      ) : null}

      <div className="runner-workspace-grid">
        <section className="workflow-section runner-readiness-workspace" aria-label="Runner readiness">
          <div className="workflow-section-header">
            <div>
              <strong>Readiness</strong>
              <small>{runnableItems.length ? `${runnableItems.length} runnable item${runnableItems.length === 1 ? "" : "s"}` : "Queue content before running"}</small>
            </div>
            <span className={readinessItems.every((item) => item.ready) ? "section-state ready" : "section-state warning"}>
              {readinessItems.every((item) => item.ready) ? "Ready" : "Check"}
            </span>
          </div>
          <div className="workflow-section-body">
            <div className="runner-readiness-list">
              {readinessItems.map((item) => (
                <article className={item.ready ? "runner-readiness-item ready" : "runner-readiness-item"} key={item.label}>
                  <ListChecks size={17} />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="workflow-section runner-run-controls" aria-label="Runner controls">
          <div className="workflow-section-header">
            <div>
              <strong>Run controls</strong>
              <small>{activeQueueName || "No active queue"} - {queueOptions.length} queue{queueOptions.length === 1 ? "" : "s"} available</small>
            </div>
          </div>
          <div className="workflow-section-body">
            <div className="queue-action-row runner-action-grid">
              <button className="primary" type="button" onClick={onStartRunner} disabled={!runnerExecutionReadiness.manualCanRun}>
                <Play size={18} />
                Run
              </button>
              <button className="secondary" type="button" onClick={onStartTestRun} disabled={!runnerExecutionReadiness.manualCanRun}>
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
              <button className="secondary" type="button" onClick={onCopyLocalRunnerSetup} disabled={!runnableItems.length || !accountReadiness.ready}>
                <Terminal size={18} />
                Setup
              </button>
            </div>
            {queueStatus ? <p className="queue-status">{queueStatus}</p> : null}
          </div>
        </section>

        <section className="workflow-section runner-diagnostics-panel" aria-label="System diagnostics">
          <div className="workflow-section-header">
            <div>
              <strong>System diagnostics</strong>
              <small>Quick checks before automation starts</small>
            </div>
            <span className={diagnostics.every((item) => item.ready) ? "section-state ready" : "section-state warning"}>
              {diagnostics.every((item) => item.ready) ? "Healthy" : "Check"}
            </span>
          </div>
          <div className="workflow-section-body">
            <div className="runner-diagnostics-list">
              {diagnostics.map((item) => (
                <article className={item.ready ? "ready" : ""} key={item.label}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="runner-activity-panel runner-workspace-activity" aria-label="Runner browser session">
          <div>
            <strong>{runnerConnectionLabel}</strong>
            <span>
              {localRunner?.online || localCompanion?.ok
                ? `Version ${companionVersion || "unknown"}${localRunner?.last_seen_at ? ` - last seen ${formatDate(localRunner.last_seen_at)}` : ""}`
                : accountReadiness.selectedAccount
                  ? `Selected account: ${accountReadiness.selectedAccount.displayName}`
                  : "Use a connected Tumblr account for live posting."}
            </span>
            {discordSummary || discordRunnerNeedsAttention ? (
              <span className={discordSummary?.status === "failed" || discordRunnerNeedsAttention ? "runner-discord-status warning" : "runner-discord-status"}>
                {discordSummaryDetail}
              </span>
            ) : null}
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

        <section className="workflow-section runner-log-summary-panel" aria-label="Runner log summary">
          <div className="workflow-section-header">
            <div>
              <strong>Latest logs</strong>
              <small>{latestRunId ? `Run ${latestRunId}` : "No run recorded yet"}</small>
            </div>
            <button className="secondary compact-button" type="button" onClick={onNavigateLogs}>
              Open logs
            </button>
          </div>
          <div className="workflow-section-body">
            {latestRunGroup ? (
              <div className="runner-latest-mini">
                <Activity size={18} />
                <div>
                  <strong>{latestRunGroup.errorCount ? "Latest run failed" : latestRunGroup.warningCount ? "Latest run needs review" : "Latest run recorded"}</strong>
                  <span>
                    {latestRunGroup.logs.length} entr{latestRunGroup.logs.length === 1 ? "y" : "ies"} - {formatDate(latestRunGroup.latestAt)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="queue-empty">Run or test the queue to create runner logs.</p>
            )}
            <div className="runner-link-row">
              <button className="secondary compact-button" type="button" onClick={onNavigateQueue}>
                <Send size={16} />
                Open queue
              </button>
              <button className="secondary compact-button" type="button" onClick={onNavigateAccounts}>
                Manage accounts
              </button>
            </div>
          </div>
        </section>

        <section className="workflow-section runner-timeline-panel" aria-label="Automation timeline">
          <div className="workflow-section-header">
            <div>
              <strong>Automation timeline</strong>
              <small>What the runner checks before posting</small>
            </div>
          </div>
          <div className="workflow-section-body">
            <div className="runner-timeline-list">
              {[
                { label: "Validate queue", ready: runnableItems.length > 0 && attentionItems.length === 0, detail: attentionItems.length ? `${attentionItems.length} item${attentionItems.length === 1 ? "" : "s"} need review` : `${runnableItems.length} runnable item${runnableItems.length === 1 ? "" : "s"}` },
                { label: "Authenticate Tumblr", ready: accountReadiness.ready, detail: selectedConnectedAccount ? selectedConnectedAccount.displayName : accountReadiness.blocker || "Select account" },
                { label: "Prepare browser", ready: scheduleRunnerReadiness.ready, detail: runnerConnectionLabel },
                { label: "Submit and summarize", ready: runnerSubmitApproved && !discordRunnerNeedsAttention, detail: runnerSubmitApproved ? discordSummaryDetail : "Live posting is not approved yet." },
              ].map((item, index) => (
                <article className={item.ready ? "ready" : ""} key={item.label}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function localRunnerVersionNumber(version: string) {
  const match = /^local-runner-(\d+)(?:\D.*)?$/.exec(version.trim());
  return match ? Number(match[1]) : null;
}

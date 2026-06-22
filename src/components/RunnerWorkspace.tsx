import { Activity, Download, ListChecks, Play, PlugZap, Send, Terminal, TestTube2 } from "lucide-react";
import { formatDate } from "../domain/format";
import { runnableQueueItems } from "../domain/queueAutomation";
import { latestRunnerRunId, runnerLogRunGroups } from "../domain/runnerLogs";
import {
  QueueDefinition,
  RunnerActivity,
  RunnerLog,
  RunnerStatus,
  SubmissionQueueItem,
  TumblrAccount,
} from "../domain/types";

type RunnerWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  queueStatus: string;
  runnerActivity: RunnerActivity;
  runnerConnectionLabel: string;
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
  runnerActivity,
  runnerConnectionLabel,
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
  const connectedAccounts = tumblrAccounts.filter((account) => account.status === "connected");
  const selectedAccount = tumblrAccounts.find((account) => account.id === selectedTumblrAccountId);
  const latestRunId = latestRunnerRunId(runnerLogs);
  const latestRunGroup = runnerLogRunGroups(runnerLogs)[0] ?? null;
  const localRunner = runnerState?.local_runner;
  const showInstallGuide = !localRunner?.online && !runnableItems.length;
  const readinessItems = [
    {
      label: "Local companion",
      ready: !["Offline", "Needs attention"].includes(runnerActivity.status),
      detail: runnerConnectionLabel,
    },
    {
      label: "Tumblr account",
      ready: connectedAccounts.length > 0,
      detail: connectedAccounts.length ? `${connectedAccounts.length} connected` : "Connect an account before live runs.",
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
  ];

  return (
    <section className="submission-queue-panel queue-workspace runner-workspace" aria-label="Runner workspace">
      <section className="runner-hero" aria-label="Runner status">
        <div>
          <span>Runner</span>
          <h2>{runnerActivity.status}</h2>
          <p>{runnerActivity.detail}</p>
        </div>
        <div className="runner-hero-actions">
          <button className="primary" type="button" onClick={onStartRunner} disabled={!runnableItems.length}>
            <Play size={18} />
            Run queue
          </button>
          <button className="secondary" type="button" onClick={onStartTestRun} disabled={!runnableItems.length}>
            <TestTube2 size={18} />
            Test run
          </button>
        </div>
      </section>

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
              <button className="primary" type="button" onClick={onStartRunner} disabled={!runnableItems.length}>
                <Play size={18} />
                Run
              </button>
              <button className="secondary" type="button" onClick={onStartTestRun} disabled={!runnableItems.length}>
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
              <button className="secondary" type="button" onClick={onCopyLocalRunnerSetup} disabled={!runnableItems.length}>
                <Terminal size={18} />
                Setup
              </button>
            </div>
            {queueStatus ? <p className="queue-status">{queueStatus}</p> : null}
          </div>
        </section>

        <section className="runner-activity-panel runner-workspace-activity" aria-label="Runner browser session">
          <div>
            <strong>{runnerConnectionLabel}</strong>
            <span>
              {localRunner?.online
                ? `Version ${localRunner.version || "unknown"}${localRunner.last_seen_at ? ` - last seen ${formatDate(localRunner.last_seen_at)}` : ""}`
                : selectedAccount
                  ? `Selected account: ${selectedAccount.displayName}`
                  : "Use a connected Tumblr account for live posting."}
            </span>
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
      </div>
    </section>
  );
}

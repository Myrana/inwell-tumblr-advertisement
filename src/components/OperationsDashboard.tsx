import { Activity, AlertTriangle, Archive, CheckCircle2, ClipboardCheck, Download, ListChecks, Play, ShieldCheck, Upload } from "lucide-react";
import { ChangeEvent } from "react";
import { attentionQueueItems, queueReadiness, queueStatusCounts, runnableQueueItems } from "../domain/queueAutomation";
import { QueueDefinition, RunnerActivity, SubmissionQueueItem, TumblrAccount, WorkspaceView } from "../domain/types";

type OperationsDashboardProps = {
  activeQueueName: string;
  queueItems: SubmissionQueueItem[];
  queueOptions: QueueDefinition[];
  runnerActivity: RunnerActivity;
  runnerConnectionLabel: string;
  runnerSubmitApproved: boolean;
  savedDraftCount: number;
  templateCount: number;
  tumblrAccounts: TumblrAccount[];
  workspaceTransferStatus: string;
  onExportWorkspace: () => void;
  onImportWorkspace: (file: File) => void;
  onNavigate: (view: WorkspaceView) => void;
};

export function OperationsDashboard({
  activeQueueName,
  queueItems,
  queueOptions,
  runnerActivity,
  runnerConnectionLabel,
  runnerSubmitApproved,
  savedDraftCount,
  templateCount,
  tumblrAccounts,
  workspaceTransferStatus,
  onExportWorkspace,
  onImportWorkspace,
  onNavigate,
}: OperationsDashboardProps) {
  const activeQueueItems = queueItems.filter((item) => item.queueName === activeQueueName);
  const counts = queueStatusCounts(activeQueueItems);
  const queuedCount = runnableQueueItems(activeQueueItems).length;
  const runningCount = counts.running;
  const attentionItems = attentionQueueItems(activeQueueItems);
  const needsReviewCount = attentionItems.length;
  const postedCount = counts.posted + counts.submitted;
  const connectedAccounts = tumblrAccounts.filter((account) => account.status === "connected").length;
  const needsLoginAccounts = tumblrAccounts.filter((account) => account.status !== "connected").length;
  const readiness = queueReadiness({
    activeQueueName,
    activeQueue: activeQueueItems,
    connectedAccountCount: connectedAccounts,
    runnerActivity,
    savedDraftCount,
    submitApproved: runnerSubmitApproved,
  });
  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      onImportWorkspace(file);
    }
  }

  return (
    <section className="operations-dashboard" aria-label="Operations dashboard">
      <section className="operations-hero" aria-label="Inkwell overview">
        <div className="operations-hero-brand">
          <div className="operations-hero-mark" aria-hidden="true">
            I
          </div>
          <div>
            <span>Inkwell</span>
            <h1>Create Once. Submit Everywhere.</h1>
            <p>Draft roleplay ads, track Tumblr blogs, and keep every submission moving from one notebook.</p>
          </div>
        </div>
        <div className="operations-hero-actions">
          <button className="primary compact-button" type="button" onClick={() => onNavigate("editor")}>
            Write advertisement
          </button>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("saved")}>
            Open archive
          </button>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("queue-settings")}>
            Track blogs
          </button>
        </div>
      </section>

      <section className={`run-readiness-panel run-readiness-${readiness.status}`} aria-label="Run readiness">
        <div className="run-readiness-icon">
          {readiness.canRun ? <Play size={22} /> : readiness.status === "review" ? <AlertTriangle size={22} /> : <ListChecks size={22} />}
        </div>
        <div className="run-readiness-copy">
          <span>Run readiness</span>
          <strong>{readiness.title}</strong>
          <small>{readiness.detail}</small>
        </div>
        <button className="primary compact-button" type="button" onClick={() => onNavigate(readiness.primaryAction.view)}>
          {readiness.primaryAction.label}
        </button>
        {readiness.blockers.length ? (
          <ul className="run-readiness-blockers" aria-label="Run blockers">
            {readiness.blockers.slice(0, 3).map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : (
          <p className="run-readiness-blockers ready">No blockers detected for {activeQueueName || "the selected queue"}.</p>
        )}
      </section>

      {attentionItems.length ? (
        <section className="attention-queue-panel" aria-label="Attention required">
          <div className="attention-queue-heading">
            <AlertTriangle size={18} />
            <strong>Attention required</strong>
            <button className="secondary compact-button" type="button" onClick={() => onNavigate("queue")}>
              Review queue
            </button>
          </div>
          <div className="attention-queue-list">
            {attentionItems.slice(0, 3).map((item) => (
              <article key={item.id}>
                <strong>{item.targetName}</strong>
                <span>{item.status === "failed" ? "Failed" : "Needs review"} - {item.notes || "Check latest runner log."}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="operations-grid">
        <article className="operation-card operation-card-primary">
          <div className="operation-card-icon">
            <ListChecks size={20} />
          </div>
          <span>Active queue</span>
          <strong>{activeQueueName || "No queue"}</strong>
          <small>{queuedCount} ready - {runningCount} running - {needsReviewCount} need review</small>
          <div className="operation-card-actions">
            <button className="secondary compact-button" type="button" onClick={() => onNavigate("queue")}>
              Open queue
            </button>
            <button className="secondary compact-button" type="button" onClick={() => onNavigate("queue-settings")}>
              Manage queues
            </button>
          </div>
        </article>

        <article className="operation-card">
          <div className="operation-card-icon">
            <Activity size={20} />
          </div>
          <span>Runner</span>
          <strong>{runnerActivity.status}</strong>
          <small>{runnerConnectionLabel}. {runnerSubmitApproved ? "Live posting approved." : "Test/prep mode until live posting is approved."}</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("runner")}>
            Runner controls
          </button>
        </article>

        <article className={needsReviewCount ? "operation-card operation-card-warning" : "operation-card"}>
          <div className="operation-card-icon">
            {needsReviewCount ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
          </div>
          <span>Queue health</span>
          <strong>{needsReviewCount ? `${needsReviewCount} need review` : "No blockers"}</strong>
          <small>{postedCount} completed submissions</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("logs")}>
            Review logs
          </button>
        </article>

        <article className={needsLoginAccounts ? "operation-card operation-card-warning" : "operation-card"}>
          <div className="operation-card-icon">
            <ShieldCheck size={20} />
          </div>
          <span>Tumblr accounts</span>
          <strong>{connectedAccounts} connected</strong>
          <small>{needsLoginAccounts} need login or check</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("accounts")}>
            Manage accounts
          </button>
        </article>

        <article className="operation-card">
          <div className="operation-card-icon">
            <Archive size={20} />
          </div>
          <span>Content readiness</span>
          <strong>{savedDraftCount} saved drafts</strong>
          <small>{queueOptions.length} queues available - {queuedCount} runnable in {activeQueueName || "selected queue"}</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("saved")}>
            Prep content
          </button>
        </article>

        <article className="operation-card operation-card-double">
          <div className="operation-card-icon">
            <ClipboardCheck size={20} />
          </div>
          <span>Templates</span>
          <strong>{templateCount} saved</strong>
          <small>Reusable copy ready for submissions</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("templates")}>
            Open templates
          </button>
        </article>

        <article className="operation-card operation-card-wide">
          <div className="operation-card-icon">
            <Download size={20} />
          </div>
          <span>Workspace backup</span>
          <strong>Import and export</strong>
          <small>{workspaceTransferStatus || "Back up or restore drafts, queues, templates, targets, and account settings."}</small>
          <div className="operation-card-actions">
            <button className="secondary compact-button" type="button" onClick={onExportWorkspace}>
              <Download size={16} />
              Export workspace
            </button>
            <label className="secondary compact-button file-action-button">
              <Upload size={16} />
              Import workspace
              <input aria-label="Import workspace file" type="file" accept="application/json,.json" onChange={handleImport} />
            </label>
          </div>
        </article>
      </div>
    </section>
  );
}

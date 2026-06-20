import { Activity, AlertTriangle, Archive, BookOpenText, CheckCircle2, ClipboardCheck, Download, ListChecks, Settings2, ShieldCheck, Upload } from "lucide-react";
import { ChangeEvent } from "react";
import { QueueDefinition, RunnerActivity, SubmissionQueueItem, TumblrAccount, WorkspaceView } from "../domain/types";

type OperationsDashboardProps = {
  activeQueueName: string;
  queueItems: SubmissionQueueItem[];
  queueOptions: QueueDefinition[];
  runnerActivity: RunnerActivity;
  runnerConnectionLabel: string;
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
  savedDraftCount,
  templateCount,
  tumblrAccounts,
  workspaceTransferStatus,
  onExportWorkspace,
  onImportWorkspace,
  onNavigate,
}: OperationsDashboardProps) {
  const queuedCount = queueItems.filter((item) => item.status === "queued" || item.status === "scheduled").length;
  const runningCount = queueItems.filter((item) => item.status === "running").length;
  const needsReviewCount = queueItems.filter((item) => item.status === "needs-review" || item.status === "failed").length;
  const postedCount = queueItems.filter((item) => item.status === "posted" || item.status === "submitted").length;
  const connectedAccounts = tumblrAccounts.filter((account) => account.status === "connected").length;
  const needsLoginAccounts = tumblrAccounts.filter((account) => account.status !== "connected").length;
  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      onImportWorkspace(file);
    }
  }

  return (
    <section className="operations-dashboard" aria-label="Operations dashboard">
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
          <small>{runnerConnectionLabel}</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("queue")}>
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
          <span>Content library</span>
          <strong>{savedDraftCount} saved drafts</strong>
          <small>{queueOptions.length} queues available</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("saved")}>
            Prep content
          </button>
        </article>

        <article className="operation-card">
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

        <article className="operation-card">
          <div className="operation-card-icon">
            <BookOpenText size={20} />
          </div>
          <span>Reference</span>
          <strong>Testing guide</strong>
          <small>Recent workflow notes and a safe testing path.</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("docs")}>
            Open docs
          </button>
        </article>

        <article className="operation-card">
          <div className="operation-card-icon">
            <Settings2 size={20} />
          </div>
          <span>Workspace map</span>
          <strong>All tools launch here</strong>
          <small>Use Operations to move into setup, logs, content, templates, and queue workspaces.</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("dashboard")}>
            Stay on dashboard
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

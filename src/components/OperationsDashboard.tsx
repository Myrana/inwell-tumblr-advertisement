import { Activity, AlertTriangle, Archive, CheckCircle2, ClipboardCheck, ListChecks, ShieldCheck } from "lucide-react";
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
  onNavigate,
}: OperationsDashboardProps) {
  const queuedCount = queueItems.filter((item) => item.status === "queued" || item.status === "scheduled").length;
  const runningCount = queueItems.filter((item) => item.status === "running").length;
  const needsReviewCount = queueItems.filter((item) => item.status === "needs-review" || item.status === "failed").length;
  const postedCount = queueItems.filter((item) => item.status === "posted" || item.status === "submitted").length;
  const connectedAccounts = tumblrAccounts.filter((account) => account.status === "connected").length;
  const needsLoginAccounts = tumblrAccounts.filter((account) => account.status !== "connected").length;

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
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("queue")}>
            Open queue
          </button>
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
      </div>
    </section>
  );
}

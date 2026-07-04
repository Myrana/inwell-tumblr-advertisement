import { Activity, AlertTriangle, Archive, CheckCircle2, ClipboardCheck, FilePlus2, ListChecks, Play, ShieldCheck } from "lucide-react";
import { attentionQueueItems, queueReadiness, queueStatusCounts, runnableQueueItems } from "../domain/queueAutomation";
import { QueueDefinition, RunnerActivity, SubmissionQueueItem, TumblrAccount, WorkspaceView } from "../domain/types";
import "./operations/operationsDashboard.css";

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
  onCreateSampleAd: () => void;
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
  onCreateSampleAd,
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
  const showFirstRunPanel = connectedAccounts === 0 && savedDraftCount === 0 && queueItems.length === 0;
  const readiness = queueReadiness({
    activeQueueName,
    activeQueue: activeQueueItems,
    connectedAccountCount: connectedAccounts,
    runnerActivity,
    savedDraftCount,
    submitApproved: runnerSubmitApproved,
  });
  const contentReadinessItems = [
    {
      label: "Saved drafts",
      value: savedDraftCount.toString(),
      detail: savedDraftCount ? "Ready to review, edit, or queue." : "Create an ad before building a queue.",
      ready: savedDraftCount > 0,
      action: savedDraftCount ? "Open library" : "Write ad",
      view: savedDraftCount ? "saved" : "editor",
    },
    {
      label: "Reusable templates",
      value: templateCount.toString(),
      detail: templateCount ? "Reusable copy is available." : "Save common copy for repeat campaigns.",
      ready: templateCount > 0,
      action: "Templates",
      view: "templates",
    },
    {
      label: "Queue coverage",
      value: activeQueueItems.length ? `${queuedCount}/${activeQueueItems.length}` : "0/0",
      detail: activeQueueName ? `${queueOptions.length} queues available for ${activeQueueName}.` : "Create a queue lane for the next run.",
      ready: queuedCount > 0,
      action: "Open queue",
      view: "queue",
    },
    {
      label: "Account path",
      value: connectedAccounts.toString(),
      detail: needsLoginAccounts ? `${needsLoginAccounts} account${needsLoginAccounts === 1 ? "" : "s"} need login.` : "Tumblr account path is connected.",
      ready: connectedAccounts > 0 && needsLoginAccounts === 0,
      action: "Accounts",
      view: "accounts",
    },
  ] satisfies Array<{
    label: string;
    value: string;
    detail: string;
    ready: boolean;
    action: string;
    view: WorkspaceView;
  }>;

  return (
    <section className="operations-dashboard" aria-label="Operations dashboard">
      <OperationsHero
        activeQueueName={activeQueueName}
        attentionCount={needsReviewCount}
        queuedCount={queuedCount}
        runnerStatus={runnerActivity.status}
        onNavigate={onNavigate}
      />

      <WorkflowPathPanel
        connectedAccounts={connectedAccounts}
        hasDrafts={savedDraftCount > 0}
        hasQueuedItems={queueItems.length > 0}
        hasRunnerAttention={needsReviewCount > 0 || runnerActivity.status !== "Offline"}
        onNavigate={onNavigate}
      />

      {showFirstRunPanel ? (
        <section className="first-run-panel" aria-label="First-run checklist">
          <div className="first-run-heading">
            <div>
              <span className="panel-kicker">Start here</span>
              <h2>Set up your first Tumblr ad</h2>
              <p>Connect an account, write or load an example advertisement, then queue it to a blog.</p>
            </div>
            <button className="secondary compact-button" type="button" onClick={onCreateSampleAd}>
              <FilePlus2 size={16} />
              Start with example ad
            </button>
          </div>
          <div className="first-run-steps">
            <article>
              <span>1</span>
              <div>
                <strong>Connect Tumblr account</strong>
                <p>Add a Tumblr login so the local runner can prepare or submit queue items.</p>
              </div>
              <button className="primary compact-button" type="button" onClick={() => onNavigate("accounts")}>
                Connect account
              </button>
            </article>
            <article>
              <span>2</span>
              <div>
                <strong>Write first advertisement</strong>
                <p>Create your ad, add forum details, and save the tags readers should see.</p>
              </div>
              <button className="secondary compact-button" type="button" onClick={() => onNavigate("editor")}>
                Write ad
              </button>
            </article>
            <article>
              <span>3</span>
              <div>
                <strong>Queue to a blog</strong>
                <p>Use Blog tracker to organize blog lanes, then send the finished ad to a queue.</p>
              </div>
              <button className="secondary compact-button" type="button" onClick={() => onNavigate("queue-settings")}>
                Open Blog tracker
              </button>
            </article>
          </div>
        </section>
      ) : null}

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

      <section className="content-readiness-panel" aria-label="Content readiness">
        <div className="content-readiness-heading">
          <div className="operation-card-icon">
            <Archive size={20} />
          </div>
          <div>
            <span>Content readiness</span>
            <h2>{savedDraftCount ? `${savedDraftCount} draft${savedDraftCount === 1 ? "" : "s"} available` : "Build the next submission"}</h2>
            <p>
              {queuedCount
                ? `${queuedCount} runnable item${queuedCount === 1 ? "" : "s"} in ${activeQueueName || "the selected queue"}.`
                : "Prepare content first, then queue it into the runner path."}
            </p>
          </div>
          <button className="primary compact-button" type="button" onClick={() => onNavigate(savedDraftCount ? "saved" : "editor")}>
            {savedDraftCount ? "Prep content" : "Write advertisement"}
          </button>
        </div>
        <div className="content-readiness-list">
          {contentReadinessItems.map((item) => (
            <article className={item.ready ? "content-readiness-item ready" : "content-readiness-item"} key={item.label}>
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
              <button className="secondary compact-button" type="button" onClick={() => onNavigate(item.view)}>
                {item.action}
              </button>
            </article>
          ))}
        </div>
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
              Blog tracker
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

      </div>
    </section>
  );
}

type OperationsHeroProps = {
  activeQueueName: string;
  attentionCount: number;
  queuedCount: number;
  runnerStatus: string;
  onNavigate: (view: WorkspaceView) => void;
};

function OperationsHero({
  activeQueueName,
  attentionCount,
  queuedCount,
  runnerStatus,
  onNavigate,
}: OperationsHeroProps) {
  return (
    <section className="operations-hero" aria-label="Operations command center">
      <div className="operations-hero-brand">
        <div className="operations-hero-mark" aria-hidden="true">
          I
        </div>
        <div>
          <span>Operations</span>
          <h1>{attentionCount ? `${attentionCount} queue item${attentionCount === 1 ? "" : "s"} need attention` : "Submission flow is ready to manage"}</h1>
          <p>
            {activeQueueName || "No queue selected"}: {queuedCount} ready. Runner: {runnerStatus}.
          </p>
        </div>
      </div>
      <div className="operations-hero-actions">
        <button className="primary compact-button" type="button" onClick={() => onNavigate(attentionCount ? "queue" : "editor")}>
          {attentionCount ? "Review queue" : "Write advertisement"}
        </button>
        <button className="secondary compact-button" type="button" onClick={() => onNavigate("runner")}>
          Runner controls
        </button>
        <button className="secondary compact-button" type="button" onClick={() => onNavigate("accounts")}>
          Account health
        </button>
      </div>
    </section>
  );
}

type WorkflowPathPanelProps = {
  connectedAccounts: number;
  hasDrafts: boolean;
  hasQueuedItems: boolean;
  hasRunnerAttention: boolean;
  onNavigate: (view: WorkspaceView) => void;
};

function WorkflowPathPanel({
  connectedAccounts,
  hasDrafts,
  hasQueuedItems,
  hasRunnerAttention,
  onNavigate,
}: WorkflowPathPanelProps) {
  const steps: Array<{ label: string; detail: string; view: WorkspaceView; ready: boolean }> = [
    {
      label: "Accounts",
      detail: connectedAccounts ? `${connectedAccounts} connected` : "Connect Tumblr",
      view: "accounts",
      ready: connectedAccounts > 0,
    },
    {
      label: "Editor",
      detail: hasDrafts ? "Drafts available" : "Create first ad",
      view: "editor",
      ready: hasDrafts,
    },
    {
      label: "Preview",
      detail: "Validate before queue",
      view: "editor",
      ready: hasDrafts,
    },
    {
      label: "Queue",
      detail: hasQueuedItems ? "Items queued" : "Queue targets",
      view: "queue",
      ready: hasQueuedItems,
    },
    {
      label: "Runner",
      detail: hasRunnerAttention ? "Review status" : "Start runner",
      view: "runner",
      ready: hasQueuedItems,
    },
    {
      label: "History",
      detail: "Logs and outcomes",
      view: "logs",
      ready: hasRunnerAttention,
    },
  ];

  return (
    <section className="workflow-path-panel" aria-label="Core submission flow">
      {steps.map((step, index) => (
        <button
          className={step.ready ? "workflow-path-step ready" : "workflow-path-step"}
          key={step.label}
          type="button"
          onClick={() => onNavigate(step.view)}
        >
          <span>{index + 1}</span>
          <strong>{step.label}</strong>
          <small>{step.detail}</small>
        </button>
      ))}
    </section>
  );
}

import { Activity, AlertTriangle, Archive, CheckCircle2, ClipboardCheck, FilePlus2, Layers3, ListChecks, PenLine, Play, Radio, ShieldCheck, Users } from "lucide-react";
import { isQueueableAdvertisement } from "../domain/adEligibility";
import type { ScheduleRunnerReadiness } from "../domain/localRunnerReadiness";
import { attentionQueueItems, queueReadiness, queueStatusCounts, runnableQueueItems } from "../domain/queueAutomation";
import { runnerAccountReadiness } from "../domain/tumblrAccounts";
import { Advertisement, QueueDefinition, RunnerActivity, SubmissionQueueItem, TumblrAccount, WorkspaceView } from "../domain/types";
import "./operations/operationsDashboard.css";

type OperationsDashboardProps = {
  activeQueueName: string;
  queueItems: SubmissionQueueItem[];
  queueOptions: QueueDefinition[];
  runnerActivity: RunnerActivity;
  runnerConnectionLabel: string;
  scheduleRunnerReadiness: ScheduleRunnerReadiness;
  runnerSubmitApproved: boolean;
  savedDraftCount: number;
  savedDrafts: Advertisement[];
  selectedTumblrAccountId: string;
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
  scheduleRunnerReadiness,
  runnerSubmitApproved,
  savedDraftCount,
  savedDrafts,
  selectedTumblrAccountId,
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
  const accountReadiness = runnerAccountReadiness(tumblrAccounts, selectedTumblrAccountId);
  const connectedAccounts = accountReadiness.connectedAccounts.length;
  const needsLoginAccounts = tumblrAccounts.filter((account) => account.status !== "connected").length;
  const showFirstRunPanel = connectedAccounts === 0 && savedDraftCount === 0 && queueItems.length === 0;
  const campaignSnapshots = buildCampaignSnapshots(savedDrafts, queueItems);
  const readiness = queueReadiness({
    activeQueueName,
    activeQueue: activeQueueItems,
    connectedAccountCount: connectedAccounts,
    runnerActivity,
    scheduledRunnerReady: scheduleRunnerReadiness.ready,
    scheduledRunnerDetail: scheduleRunnerReadiness.detail,
    accountBlocker: accountReadiness.blocker,
    selectedConnectedAccount: accountReadiness.ready,
    savedDraftCount,
    submitApproved: runnerSubmitApproved,
  });
  const runnerStatusTone = operationsReadinessTone(readiness.status);
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
        connectedAccounts={connectedAccounts}
        livePostingApproved={runnerSubmitApproved}
        queuedCount={queuedCount}
        reviewCount={needsReviewCount}
        runnerTone={runnerStatusTone}
        runnerActionLabel={readiness.canRun ? "Runner Controls" : readiness.primaryAction.label}
        runnerActionView={readiness.primaryAction.view}
        savedDraftCount={savedDraftCount}
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

      <section className="operations-focus-grid" aria-label="Operations focus">
        <article className="focus-card focus-card-large" aria-label="Draft focus">
          <div className="focus-card-title">
            <PenLine size={20} />
            <span>Drafts</span>
          </div>
          <strong>{savedDraftCount ? `${savedDraftCount} ready to shape` : "Start with a draft"}</strong>
          <p>{savedDraftCount ? "Review saved copy, finish campaign details, and move the strongest ads into the queue." : "Write the first advertisement before setting up a runner flow."}</p>
          <button className="primary compact-button" type="button" onClick={() => onNavigate(savedDraftCount ? "saved" : "editor")}>
            {savedDraftCount ? "Prep content" : "Write Advertisement"}
          </button>
        </article>

        <article className="focus-card" aria-label="Queue focus">
          <div className="focus-card-title">
            <ListChecks size={20} />
            <span>Queue</span>
          </div>
          <strong>{queuedCount ? `${queuedCount} runnable` : "Nothing queued yet"}</strong>
          <p>{activeQueueName ? `${activeQueueItems.length} total items in ${activeQueueName}.` : "Choose or create a queue lane."}</p>
          <button className="text-link" type="button" onClick={() => onNavigate("queue")}>
            Open queue
          </button>
        </article>

        <article className={`focus-card focus-card-runner ${runnerStatusTone}`} aria-label="Runner focus">
          <div className="focus-card-title">
            <Radio size={20} />
            <span>Runner Status</span>
          </div>
          <strong>{readiness.canRun ? "Runner is ready" : friendlyReadinessTitle(readiness.title)}</strong>
          <p>{readiness.canRun ? readiness.detail : readiness.detail || runnerConnectionLabel || scheduleRunnerReadiness.detail}</p>
          <button className={readiness.canRun ? "primary compact-button" : "text-link"} type="button" onClick={() => onNavigate(readiness.primaryAction.view)}>
            {readiness.primaryAction.label}
          </button>
        </article>
      </section>

      <section className={`run-readiness-panel run-readiness-${readiness.status}`} aria-label="Run readiness">
        <div className="run-readiness-icon">
          {readiness.canRun ? <Play size={22} /> : readiness.status === "review" ? <AlertTriangle size={22} /> : <ListChecks size={22} />}
        </div>
        <div className="run-readiness-copy">
          <span>Runner checklist</span>
          <strong>{readiness.canRun ? "Ready when you are" : friendlyReadinessTitle(readiness.title)}</strong>
          <small>{readiness.detail}</small>
        </div>
        {readiness.blockers.length ? (
          <ul className="run-readiness-blockers" aria-label="Run blockers">
            {readiness.blockers.slice(0, 3).map((blocker) => (
              <li key={blocker}>
                <span>{blocker}</span>
                <button className="text-link" type="button" onClick={() => onNavigate(readinessActionFor(blocker).view)}>
                  {readinessActionFor(blocker).label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="run-readiness-blockers ready">No blockers detected for {activeQueueName || "the selected queue"}.</p>
        )}
      </section>

      <section className="campaign-snapshot-panel" aria-label="Campaign dashboard">
        <div className="campaign-snapshot-heading">
          <div>
            <span>Campaign dashboard</span>
            <h2>{campaignSnapshots.length ? "Campaign readiness at a glance" : "No campaigns assigned yet"}</h2>
          </div>
          <button className="text-link" type="button" onClick={() => onNavigate("saved")}>
            Open library
          </button>
        </div>
        <div className="campaign-snapshot-list">
          {campaignSnapshots.length ? (
            campaignSnapshots.slice(0, 4).map((campaign) => (
              <article key={campaign.name}>
                <strong>{campaign.name}</strong>
                <span>{campaign.total} saved - {campaign.ready} ready - {campaign.needsWork} need edits</span>
                <small>{campaign.archived} archived - {campaign.queued} queued</small>
              </article>
            ))
          ) : (
            <article>
              <strong>Unassigned</strong>
              <span>{savedDraftCount} saved drafts available</span>
              <small>Assign campaigns from the editor to track batches here.</small>
            </article>
          )}
        </div>
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
              <button className="text-link" type="button" onClick={() => onNavigate(item.view)}>
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
            <button className="text-link" type="button" onClick={() => onNavigate("queue")}>
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

      <div className="operations-grid" aria-label="Supporting dashboard details">
        <article className="operation-card operation-card-primary">
          <div className="operation-card-icon">
            <ListChecks size={20} />
          </div>
          <span>Active queue</span>
          <strong>{activeQueueName || "No queue"}</strong>
          <small>{queuedCount} ready - {runningCount} running - {needsReviewCount} need review</small>
          <div className="operation-card-actions">
            <button className="text-link" type="button" onClick={() => onNavigate("queue")}>
              Open queue
            </button>
            <button className="text-link" type="button" onClick={() => onNavigate("queue-settings")}>
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
          <small>{runnerSubmitApproved ? "Live posting approved." : "Test/prep mode until live posting is approved."}</small>
          <button className="text-link" type="button" onClick={() => onNavigate("runner")}>
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
          <button className="text-link" type="button" onClick={() => onNavigate("logs")}>
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
          <button className="text-link" type="button" onClick={() => onNavigate("accounts")}>
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
          <button className="text-link" type="button" onClick={() => onNavigate("templates")}>
            Open templates
          </button>
        </article>

      </div>
    </section>
  );
}

function operationsReadinessTone(status: "ready" | "blocked" | "empty" | "review") {
  if (status === "ready") {
    return "ready";
  }
  if (status === "empty" || status === "review") {
    return "warning";
  }
  return "blocked";
}

function readinessActionFor(blocker: string): { label: string; view: WorkspaceView } {
  if (blocker.includes("Tumblr")) {
    return { label: "Fix account", view: "accounts" };
  }
  if (blocker.includes("runner")) {
    return { label: "Open runner", view: "runner" };
  }
  if (blocker.includes("queued") || blocker.includes("queue")) {
    return { label: "Fix queue", view: "queue" };
  }
  return { label: "Prep content", view: "saved" };
}

function friendlyReadinessTitle(title: string) {
  if (title.toLowerCase().includes("blocked")) {
    return "Runner is waiting";
  }
  if (title.toLowerCase().includes("queue")) {
    return "Queue needs content";
  }
  return title;
}

function buildCampaignSnapshots(savedDrafts: Advertisement[], queueItems: SubmissionQueueItem[]) {
  const campaigns = new Map<string, { name: string; total: number; ready: number; needsWork: number; archived: number; queued: number }>();
  const queuedAdIds = new Set(queueItems.filter((item) => item.status === "queued" || item.status === "scheduled" || item.status === "running").map((item) => item.adId));
  for (const ad of savedDrafts) {
    const name = ad.campaignName?.trim() || "Unassigned";
    const current = campaigns.get(name) ?? { name, total: 0, ready: 0, needsWork: 0, archived: 0, queued: 0 };
    const ready = isQueueableAdvertisement(ad);
    current.total += 1;
    current.ready += ready ? 1 : 0;
    current.needsWork += !ad.archived && !ready ? 1 : 0;
    current.archived += ad.archived ? 1 : 0;
    current.queued += queuedAdIds.has(ad.id) ? 1 : 0;
    campaigns.set(name, current);
  }

  return Array.from(campaigns.values()).sort((first, second) => second.ready - first.ready || second.total - first.total || first.name.localeCompare(second.name));
}

type OperationsHeroProps = {
  activeQueueName: string;
  attentionCount: number;
  connectedAccounts: number;
  livePostingApproved: boolean;
  queuedCount: number;
  reviewCount: number;
  runnerTone: string;
  runnerActionLabel: string;
  runnerActionView: WorkspaceView;
  savedDraftCount: number;
  runnerStatus: string;
  onNavigate: (view: WorkspaceView) => void;
};

function OperationsHero({
  activeQueueName,
  attentionCount,
  connectedAccounts,
  livePostingApproved,
  queuedCount,
  reviewCount,
  runnerTone,
  runnerActionLabel,
  runnerActionView,
  savedDraftCount,
  runnerStatus,
  onNavigate,
}: OperationsHeroProps) {
  const summaryText = attentionCount
    ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need review before the next run.`
    : savedDraftCount || queuedCount
      ? `${savedDraftCount} draft${savedDraftCount === 1 ? "" : "s"} available and ${queuedCount} queued for ${activeQueueName || "the selected queue"}.`
      : "Start by writing an advertisement, then queue it to a connected Tumblr account.";
  const commandSummary = `${workspaceGreeting()}. You have ${savedDraftCount} draft${savedDraftCount === 1 ? "" : "s"} ready to review, ${queuedCount || "nothing"} queued, ${connectedAccounts} connected account${connectedAccounts === 1 ? "" : "s"}, and the runner is ${runnerStatus.toLowerCase()}.`;

  return (
    <section className="operations-hero" aria-label="Operations command center">
      <div className="operations-hero-copy operations-hero-brand">
        <span>Command center</span>
        <h2>{commandSummary}</h2>
        <p>{summaryText}</p>
        <div className="operations-hero-actions">
          <button className="primary compact-button command-action" type="button" onClick={() => onNavigate("editor")}>
            Write Advertisement
          </button>
          <button className="secondary compact-button command-action" type="button" onClick={() => onNavigate("saved")}>
            Review Drafts
          </button>
          <button className="secondary compact-button command-action" type="button" onClick={() => onNavigate("queue")}>
            Open Queue
          </button>
          <button className={runnerTone === "ready" ? "secondary compact-button command-action" : "primary compact-button command-action"} type="button" onClick={() => onNavigate(runnerActionView)}>
            {runnerActionLabel}
          </button>
        </div>
        <div className="operations-hero-secondary" aria-label="Secondary operations links">
          <button className="text-link" type="button" onClick={() => onNavigate("accounts")}>
            Account health
          </button>
          <button className="text-link" type="button" onClick={() => onNavigate("settings")}>
            Settings
          </button>
        </div>
      </div>
      <section className="operations-status-strip" aria-label="Operations status summary">
        <article className={savedDraftCount ? "ops-status-card ready" : "ops-status-card"} aria-label="Draft ready status">
          <Layers3 size={18} />
          <span>Drafts ready</span>
          <strong>{savedDraftCount}</strong>
        </article>
        <article className={queuedCount ? "ops-status-card ready" : "ops-status-card warning"} aria-label="Queue ready status">
          <ListChecks size={18} />
          <span>Queue ready</span>
          <strong>{queuedCount}</strong>
        </article>
        <article className={`ops-status-card ${runnerTone}`} aria-label="Runner status summary">
          <Radio size={18} />
          <span>Runner</span>
          <strong>{runnerStatus}</strong>
        </article>
        <article className={connectedAccounts ? "ops-status-card ready" : "ops-status-card warning"} aria-label="Account status summary">
          <Users size={18} />
          <span>Accounts</span>
          <strong>{connectedAccounts}</strong>
        </article>
        <article className={reviewCount ? "ops-status-card warning" : "ops-status-card ready"} aria-label="Review queue status">
          <AlertTriangle size={18} />
          <span>Review queue</span>
          <strong>{reviewCount}</strong>
        </article>
        <article className={livePostingApproved ? "ops-status-card ready" : "ops-status-card warning"} aria-label="Live posting status">
          <CheckCircle2 size={18} />
          <span>Live posting</span>
          <strong>{livePostingApproved ? "Approved" : "Prep mode"}</strong>
        </article>
      </section>
    </section>
  );
}

function workspaceGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

import { AlertTriangle, Archive, CheckCircle2, FilePlus2, Layers3, ListChecks, PenLine, Play, Radio, Settings, Users } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { isQueueableAdvertisement } from "../domain/adEligibility";
import type { ScheduleRunnerReadiness } from "../domain/localRunnerReadiness";
import { attentionQueueItems, queueReadiness, runnableQueueItems } from "../domain/queueAutomation";
import { runnerAccountReadiness } from "../domain/tumblrAccounts";
import { Advertisement, RunnerActivity, SubmissionQueueItem, TumblrAccount, WorkspaceView } from "../domain/types";
import "./operations/operationsDashboard.css";

type OperationsDashboardProps = {
  activeQueueName: string;
  displayName: string;
  queueItems: SubmissionQueueItem[];
  runnerActivity: RunnerActivity;
  runnerConnectionLabel: string;
  scheduleRunnerReadiness: ScheduleRunnerReadiness;
  runnerSubmitApproved: boolean;
  savedDraftCount: number;
  savedDrafts: Advertisement[];
  selectedTumblrAccountId: string;
  tumblrAccounts: TumblrAccount[];
  onCreateSampleAd: () => void;
  onNavigate: (view: WorkspaceView) => void;
};

export function OperationsDashboard({
  activeQueueName,
  displayName,
  queueItems,
  runnerActivity,
  runnerConnectionLabel,
  scheduleRunnerReadiness,
  runnerSubmitApproved,
  savedDraftCount,
  savedDrafts,
  selectedTumblrAccountId,
  tumblrAccounts,
  onCreateSampleAd,
  onNavigate,
}: OperationsDashboardProps) {
  const activeQueueItems = queueItems.filter((item) => item.queueName === activeQueueName);
  const queuedCount = runnableQueueItems(activeQueueItems).length;
  const attentionItems = attentionQueueItems(activeQueueItems);
  const needsReviewCount = attentionItems.length;
  const accountReadiness = runnerAccountReadiness(tumblrAccounts, selectedTumblrAccountId);
  const connectedAccounts = accountReadiness.connectedAccounts.length;
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

  return (
    <section className="operations-dashboard" aria-label="Operations dashboard">
      <OperationsHero
        activeQueueName={activeQueueName}
        attentionCount={needsReviewCount}
        connectedAccounts={connectedAccounts}
        displayName={displayName}
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
        hasQueuedItems={activeQueueItems.length > 0}
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
        <article className="focus-card focus-card-drafts" aria-label="Draft focus">
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
          <strong>{readiness.scheduledCanRun ? "Runner is watching" : readiness.canRun ? "Runner needs recovery" : friendlyReadinessTitle(readiness.title)}</strong>
          <p>{readiness.canRun ? readiness.detail : readiness.detail || runnerConnectionLabel || scheduleRunnerReadiness.detail}</p>
          <button className={readiness.canRun ? "primary compact-button" : "text-link"} type="button" onClick={() => onNavigate(readiness.primaryAction.view)}>
            {readiness.primaryAction.label}
          </button>
        </article>
      </section>

      <section className={`run-readiness-panel run-readiness-${readiness.status}`} aria-label="Run readiness">
        <div className="run-readiness-icon">
          {readiness.scheduledCanRun ? <Play size={22} /> : <AlertTriangle size={22} />}
        </div>
        <div className="run-readiness-copy">
          <span>{readiness.scheduledCanRun ? "Runner status" : "Attention required"}</span>
          <strong>{readiness.scheduledCanRun ? "Runner is watching" : readiness.canRun ? "Runner needs recovery" : friendlyReadinessTitle(readiness.title)}</strong>
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
        ) : readiness.scheduledCanRun ? (
          <ul className="run-readiness-blockers ready" aria-label="Run blockers">
            <li><span>All systems go.</span></li>
            <li><span>{activeQueueName || "Selected queue"} is ready for automation.</span></li>
          </ul>
        ) : (
          <ul className="run-readiness-blockers" aria-label="Run blockers">
            <li>
              <span>{readiness.detail}</span>
              <button className="text-link" type="button" onClick={() => onNavigate("runner")}>
                Open runner
              </button>
            </li>
          </ul>
        )}
        <button className="secondary compact-button" type="button" onClick={() => onNavigate(readiness.canRun ? "runner" : readiness.primaryAction.view)}>
          {readiness.canRun ? "Runner controls" : readiness.primaryAction.label}
        </button>
      </section>

      <div className="operations-bottom-grid" aria-label="Supporting dashboard details">
        <CampaignReadinessCard
          campaignSnapshots={campaignSnapshots}
          savedDraftCount={savedDraftCount}
          onNavigate={onNavigate}
        />
        <RecentActivityCard
          activeQueueName={activeQueueName}
          attentionItems={attentionItems}
          connectedAccounts={connectedAccounts}
          queuedCount={queuedCount}
          runnerActivity={runnerActivity}
          savedDraftCount={savedDraftCount}
          onNavigate={onNavigate}
        />
        <QuickLinksCard onNavigate={onNavigate} />
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
  const normalized = blocker.toLowerCase();
  if (normalized.includes("review") || normalized.includes("failed") || normalized.includes("needs-review")) {
    return { label: "Review queue", view: "queue" };
  }
  if (normalized.includes("tumblr")) {
    return { label: "Fix account", view: "accounts" };
  }
  if (normalized.includes("runner")) {
    return { label: "Open runner", view: "runner" };
  }
  if (normalized.includes("queued") || normalized.includes("queue")) {
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
  const campaigns = new Map<string, { name: string; total: number; ready: number; needsWork: number; archived: number; queued: number; percent: number }>();
  const queuedAdIds = new Set(queueItems.filter((item) => item.status === "queued" || item.status === "scheduled" || item.status === "running").map((item) => item.adId));
  for (const ad of savedDrafts) {
    const name = ad.campaignName?.trim() || "Unassigned";
    const current = campaigns.get(name) ?? { name, total: 0, ready: 0, needsWork: 0, archived: 0, queued: 0, percent: 0 };
    const ready = isQueueableAdvertisement(ad);
    current.total += 1;
    current.ready += ready ? 1 : 0;
    current.needsWork += !ad.archived && !ready ? 1 : 0;
    current.archived += ad.archived ? 1 : 0;
    current.queued += queuedAdIds.has(ad.id) ? 1 : 0;
    campaigns.set(name, current);
  }

  return Array.from(campaigns.values())
    .map((campaign) => ({ ...campaign, percent: campaign.total ? Math.round((campaign.ready / campaign.total) * 100) : 0 }))
    .sort((first, second) => second.ready - first.ready || second.total - first.total || first.name.localeCompare(second.name));
}

function buildActivityItems({
  activeQueueName,
  attentionItems,
  connectedAccounts,
  queuedCount,
  runnerActivity,
  savedDraftCount,
}: {
  activeQueueName: string;
  attentionItems: SubmissionQueueItem[];
  connectedAccounts: number;
  queuedCount: number;
  runnerActivity: RunnerActivity;
  savedDraftCount: number;
}) {
  const items = [
    {
      title: savedDraftCount ? `${savedDraftCount} draft${savedDraftCount === 1 ? "" : "s"} available` : "No drafts saved yet",
      detail: savedDraftCount ? "Review or queue saved advertisements from the content library." : "Write an advertisement to start the workflow.",
      tone: savedDraftCount ? "ready" : "warning",
    },
    {
      title: queuedCount ? `${queuedCount} queued for ${activeQueueName || "the selected queue"}` : "Queue is empty",
      detail: queuedCount ? "The runner has runnable submissions waiting." : "Open Queue or Library to move ready ads into a lane.",
      tone: queuedCount ? "ready" : "warning",
    },
    {
      title: attentionItems.length ? `${attentionItems.length} queue item${attentionItems.length === 1 ? "" : "s"} need review` : "Queue health clear",
      detail: attentionItems[0]?.notes || (attentionItems.length ? "Review the failed or needs-review submissions." : "No failed or needs-review submissions are visible."),
      tone: attentionItems.length ? "blocked" : "ready",
    },
    {
      title: `Runner is ${runnerActivity.status.toLowerCase()}`,
      detail: runnerActivity.detail || "Open Runner controls for live automation state.",
      tone: runnerActivity.status === "Offline" || runnerActivity.status === "Needs attention" ? "warning" : "ready",
    },
    {
      title: connectedAccounts ? `${connectedAccounts} account${connectedAccounts === 1 ? "" : "s"} connected` : "No Tumblr account connected",
      detail: connectedAccounts ? "Account path is available for automation." : "Connect an account before live runner work.",
      tone: connectedAccounts ? "ready" : "blocked",
    },
  ];

  return items;
}

type OperationsHeroProps = {
  activeQueueName: string;
  attentionCount: number;
  connectedAccounts: number;
  displayName: string;
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
  displayName,
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
  const firstName = displayName.split(/[ @]/).filter(Boolean)[0] || "there";
  const summaryText = attentionCount
    ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need review before the next run.`
    : savedDraftCount || queuedCount
      ? `${savedDraftCount} draft${savedDraftCount === 1 ? "" : "s"} available and ${queuedCount} queued for ${activeQueueName || "the selected queue"}.`
      : "Start by writing an advertisement, then queue it to a connected Tumblr account.";
  const queuedCopy = queuedCount ? `${queuedCount} queued` : "nothing queued";

  return (
    <section className="operations-hero" aria-label="Operations command center">
      <div className="operations-hero-copy operations-hero-brand">
        <span>Command center</span>
        <h2>{workspaceGreeting()}, {firstName}</h2>
        <p>You have {savedDraftCount} draft{savedDraftCount === 1 ? "" : "s"} ready to review, {queuedCopy}, {connectedAccounts} connected account{connectedAccounts === 1 ? "" : "s"}, and the runner is {runnerStatus.toLowerCase()}.</p>
        <p className="operations-hero-note">{summaryText}</p>
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
          <small>{savedDraftCount ? `${savedDraftCount} need review` : "No drafts yet"}</small>
        </article>
        <article className={queuedCount ? "ops-status-card ready" : "ops-status-card warning"} aria-label="Queue ready status">
          <ListChecks size={18} />
          <span>Queue ready</span>
          <strong>{queuedCount}</strong>
          <small>{queuedCount ? `${queuedCount} ready to run` : "No items queued"}</small>
        </article>
        <article className={`ops-status-card ${runnerTone}`} aria-label="Runner status summary">
          <Radio size={18} />
          <span>Runner</span>
          <strong>{runnerStatus}</strong>
          <small>{livePostingApproved ? "Live posting approved" : "Prep mode only"}</small>
        </article>
        <article className={connectedAccounts ? "ops-status-card ready" : "ops-status-card warning"} aria-label="Account status summary">
          <Users size={18} />
          <span>Accounts</span>
          <strong>{connectedAccounts}</strong>
          <small>{connectedAccounts ? `${connectedAccounts} connected` : "Connect Tumblr"}</small>
        </article>
        <article className={reviewCount ? "ops-status-card warning" : "ops-status-card ready"} aria-label="Review queue status">
          <AlertTriangle size={18} />
          <span>Review queue</span>
          <strong>{reviewCount}</strong>
          <small>{reviewCount ? "Need review" : "Clear"}</small>
        </article>
        <article className={livePostingApproved ? "ops-status-card ready" : "ops-status-card warning"} aria-label="Live posting status">
          <CheckCircle2 size={18} />
          <span>Live posting</span>
          <strong>{livePostingApproved ? "Approved" : "Prep mode"}</strong>
          <small>{livePostingApproved ? "All systems go" : "Approval required"}</small>
        </article>
      </section>
    </section>
  );
}

type CampaignReadinessCardProps = {
  campaignSnapshots: ReturnType<typeof buildCampaignSnapshots>;
  savedDraftCount: number;
  onNavigate: (view: WorkspaceView) => void;
};

function CampaignReadinessCard({ campaignSnapshots, savedDraftCount, onNavigate }: CampaignReadinessCardProps) {
  const primaryCampaign = campaignSnapshots[0];
  const percent = primaryCampaign?.percent ?? 0;

  return (
    <section className="campaign-readiness-card" aria-label="Campaign readiness">
      <div className="panel-card-heading">
        <span>Campaign readiness</span>
        <h2>Campaign readiness at a glance</h2>
      </div>
      <div className="campaign-readiness-body">
        <div className="readiness-ring" style={{ "--ready": `${percent}%` } as CSSProperties} aria-label={`Campaign readiness ${percent}%`}>
          <strong>{percent}%</strong>
          <span>Ready</span>
        </div>
        <div className="campaign-readiness-details">
          <strong>{primaryCampaign?.name || "Unassigned"}</strong>
          {primaryCampaign ? (
            <>
              <span>{primaryCampaign.total} saved - {primaryCampaign.ready} ready - {primaryCampaign.needsWork} need edits</span>
              <span>{primaryCampaign.archived} archived - {primaryCampaign.queued} queued</span>
            </>
          ) : (
            <span>{savedDraftCount} saved drafts available</span>
          )}
          <button className="text-link" type="button" onClick={() => onNavigate("saved")}>
            Open library
          </button>
        </div>
      </div>
    </section>
  );
}

type RecentActivityCardProps = {
  activeQueueName: string;
  attentionItems: SubmissionQueueItem[];
  connectedAccounts: number;
  queuedCount: number;
  runnerActivity: RunnerActivity;
  savedDraftCount: number;
  onNavigate: (view: WorkspaceView) => void;
};

function RecentActivityCard({
  activeQueueName,
  attentionItems,
  connectedAccounts,
  queuedCount,
  runnerActivity,
  savedDraftCount,
  onNavigate,
}: RecentActivityCardProps) {
  return (
    <section className="operations-activity-panel" aria-label="Recent activity">
      <div className="panel-card-heading">
        <span>Recent activity</span>
        <h2>Workspace movement</h2>
      </div>
      <div className="operations-activity-list">
        {buildActivityItems({
          activeQueueName,
          attentionItems,
          connectedAccounts,
          queuedCount,
          runnerActivity,
          savedDraftCount,
        }).slice(0, 4).map((item) => (
          <article className={`operations-activity-item ${item.tone}`} key={item.title}>
            <span aria-hidden="true" />
            <div>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
          </article>
        ))}
      </div>
      <button className="text-link" type="button" onClick={() => onNavigate("logs")}>
        View all activity
      </button>
    </section>
  );
}

function QuickLinksCard({ onNavigate }: { onNavigate: (view: WorkspaceView) => void }) {
  const links: Array<{ label: string; detail: string; icon: ReactNode; view: WorkspaceView }> = [
    { label: "Content library", detail: "Browse saved ads", icon: <Archive size={20} />, view: "saved" },
    { label: "Runner", detail: "Start or test", icon: <Radio size={20} />, view: "runner" },
    { label: "Queue", detail: "Manage submissions", icon: <ListChecks size={20} />, view: "queue" },
    { label: "Account settings", detail: "Manage Tumblr accounts", icon: <Settings size={20} />, view: "accounts" },
  ];

  return (
    <section className="quick-links-card" aria-label="Quick links">
      <div className="panel-card-heading">
        <span>Quick links</span>
        <h2>Common actions</h2>
      </div>
      <div className="quick-links-grid">
        {links.map((link) => (
          <button key={link.label} type="button" onClick={() => onNavigate(link.view)}>
            {link.icon}
            <strong>{link.label}</strong>
            <small>{link.detail}</small>
          </button>
        ))}
      </div>
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
          <span>{step.ready ? <CheckCircle2 size={15} /> : index + 1}</span>
          <strong>{step.label}</strong>
          <small>{step.detail}</small>
        </button>
      ))}
    </section>
  );
}

import { FilePlus2, PlayCircle } from "lucide-react";
import { formatSubmissionStatus } from "../../domain/format";
import type { QueueFlowSummary } from "../../domain/queueAutomation";
import type { SubmissionQueueItem, SubmissionStatus } from "../../domain/types";

type QueueFlowSummaryPanelProps = {
  activeQueueName: string;
  attentionCount: number;
  completedCount: number;
  flowSummary: QueueFlowSummary;
  nextRunLabel: string;
  runnableCount: number;
  onCreateSubmission: () => void;
  onOpenRunner: () => void;
};

export function QueueFlowSummaryPanel({
  activeQueueName,
  attentionCount,
  completedCount,
  flowSummary,
  nextRunLabel,
  runnableCount,
  onCreateSubmission,
  onOpenRunner,
}: QueueFlowSummaryPanelProps) {
  return (
    <>
      <QueueCommandCenter
        activeQueueName={activeQueueName}
        attentionCount={attentionCount}
        completedCount={completedCount}
        flowSummary={flowSummary}
        nextRunLabel={nextRunLabel}
        runnableCount={runnableCount}
        onCreateSubmission={onCreateSubmission}
        onOpenRunner={onOpenRunner}
      />
      <QueuePipelineSummary flowSummary={flowSummary} />
      <QueueAutomationBanner flowSummary={flowSummary} />
    </>
  );
}

function QueueCommandCenter({
  activeQueueName,
  attentionCount,
  completedCount,
  flowSummary,
  nextRunLabel,
  runnableCount,
  onCreateSubmission,
  onOpenRunner,
}: QueueFlowSummaryPanelProps) {
  return (
    <section className="queue-command-center" aria-label="Queue operations summary">
      <div>
        <span>Queue operations</span>
        <h3>{activeQueueName || "No queue selected"}</h3>
        <p>
          {runnableCount} runnable, {attentionCount} need review, {completedCount} completed.
          {nextRunLabel}
        </p>
      </div>
      <div className="queue-command-stats" aria-label="Queue health summary">
        {flowSummary.healthStats.map((stat) => (
          <article className={`queue-health-stat ${stat.tone}`} key={stat.label} title={stat.detail}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </article>
        ))}
      </div>
      <div className="queue-command-actions">
        <button className="primary compact-button" type="button" onClick={onCreateSubmission}>
          <FilePlus2 size={16} />
          Write Advertisement
        </button>
        <button className="tertiary-action compact-button" type="button" onClick={onOpenRunner}>
          <PlayCircle size={16} />
          Runner Controls
        </button>
      </div>
    </section>
  );
}

function QueuePipelineSummary({ flowSummary }: { flowSummary: QueueFlowSummary }) {
  return (
    <section className="queue-pipeline-panel" aria-label="Live queue pipeline">
      {flowSummary.timeline.map((step) => (
        <article className={`queue-pipeline-step ${step.tone}`} key={step.label} title={step.detail}>
          <strong>{step.value}</strong>
          <span>{step.label}</span>
        </article>
      ))}
    </section>
  );
}

function QueueAutomationBanner({ flowSummary }: { flowSummary: QueueFlowSummary }) {
  return (
    <section className={`queue-flow-automation ${flowSummary.automation.tone}`} aria-label="Queue automation state">
      <div>
        <strong>{flowSummary.automation.label}</strong>
        <span>{flowSummary.automation.detail}</span>
      </div>
      <small>{flowSummary.refillActivity}</small>
    </section>
  );
}

export function QueueFlowOverview({
  activeQueue,
  activeQueueName,
  flowSummary,
  statusCounts,
}: {
  activeQueue: SubmissionQueueItem[];
  activeQueueName: string;
  flowSummary: QueueFlowSummary;
  statusCounts: Record<SubmissionStatus, number>;
}) {
  const queueLanes = [
    { key: "runnable", label: "Runnable", detail: "Queued and scheduled items the runner can pick up.", items: flowSummary.lanes.runnable },
    { key: "running", label: "Running", detail: "Items currently with the runner.", items: flowSummary.lanes.running },
    { key: "attention", label: "Attention", detail: "Failed or needs-review items parked from automation.", items: flowSummary.lanes.attention },
  ];

  return (
    <div className="queue-flow-overview" aria-label="Queue flow overview">
      <div className="queue-monitor-grid" aria-label="Queue monitoring summary">
        {Object.entries(statusCounts).map(([status, count]) => (
          <div className="queue-monitor-stat" key={status}>
            <span>{flowSummary.statusLabels[status as SubmissionStatus] || formatSubmissionStatus(status as SubmissionStatus)}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <div className="queue-lane-grid" aria-label="Queue work lanes">
        {queueLanes.map((lane) => (
          <article className={`queue-lane-card ${lane.key}`} key={lane.key}>
            <span>{lane.label}</span>
            <strong>{lane.items.length}</strong>
            <small>{lane.items.length ? lane.items.slice(0, 2).map((item) => item.targetName).join(", ") : lane.detail}</small>
          </article>
        ))}
      </div>
      <div className="queue-flow-timeline" aria-label="Queue flow timeline">
        {flowSummary.timeline.map((step) => (
          <article className={`queue-flow-timeline-step ${step.tone}`} key={step.label}>
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </article>
        ))}
      </div>
      {!activeQueue.length && activeQueueName ? <span className="sr-only">Selected queue has no active flow items.</span> : null}
    </div>
  );
}

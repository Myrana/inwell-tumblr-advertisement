import { formatEasternRun } from "../../domain/schedule";

type QueueScheduleReadinessGridProps = {
  attentionItemCount: number;
  enabled: boolean;
  nextRunAt: string;
  runnableItemCount: number;
  runnerReady: boolean;
  willRun: boolean;
};

export function QueueScheduleReadinessGrid({
  attentionItemCount,
  enabled,
  nextRunAt,
  runnableItemCount,
  runnerReady,
  willRun,
}: QueueScheduleReadinessGridProps) {
  const automationState = enabled
    ? {
        className: willRun ? "queue-schedule-card ready" : "queue-schedule-card blocked",
        label: willRun ? "Will run" : attentionItemCount ? "Needs review" : "Will not run yet",
        detail: willRun
          ? "Daily automation has the required pieces."
          : attentionItemCount
            ? "Clear failed or review-needed submissions first."
            : "Fix the blocked readiness item first.",
      }
    : {
        className: "queue-schedule-card off",
        label: "Off",
        detail: "Daily automation is disabled for this queue.",
      };
  const runnerState = !enabled
    ? {
        className: "queue-schedule-card off",
        label: "Off",
        detail: "Enable daily automation to check runner readiness.",
      }
    : runnerReady
      ? {
          className: "queue-schedule-card ready",
          label: "Ready",
          detail: "Runner can watch this queue.",
        }
      : {
          className: "queue-schedule-card blocked",
          label: "Blocked",
          detail: "Use the recovery panel below.",
        };

  return (
    <div className="queue-schedule-readiness-grid" aria-label="Daily automation readiness">
      <article className={enabled ? "queue-schedule-card ready" : "queue-schedule-card warning"}>
        <span>Next run</span>
        <strong>{nextRunAt ? formatEasternRun(nextRunAt) : "Not scheduled"}</strong>
        <small>{enabled ? "America/New_York" : "Enable daily automation to schedule this queue."}</small>
      </article>
      <article className={runnerState.className}>
        <span>Runner readiness</span>
        <strong>{runnerState.label}</strong>
        <small>{runnerState.detail}</small>
      </article>
      <article className={runnableItemCount ? "queue-schedule-card ready" : "queue-schedule-card warning"}>
        <span>Queue readiness</span>
        <strong>{runnableItemCount} runnable</strong>
        <small>{runnableItemCount ? "Queued or scheduled content is available." : "Queue content before the next run."}</small>
      </article>
      <article className={automationState.className}>
        <span>Automation state</span>
        <strong>{automationState.label}</strong>
        <small>{automationState.detail}</small>
      </article>
    </div>
  );
}

import { formatDate } from "../../domain/format";
import type { runnerLogRunGroups } from "../../domain/runnerLogs";

type RunnerRunGroup = ReturnType<typeof runnerLogRunGroups>[number];

type RunnerFlowStripProps = {
  attentionCount: number;
  connectedAccountCount: number;
  latestRunGroup: RunnerRunGroup | null;
  runnableCount: number;
  runnerReady: boolean;
  submitApproved: boolean;
};

type RunnerFlowStep = {
  detail: string;
  label: string;
  state: "ready" | "warning" | "blocked";
};

export function RunnerFlowStrip({
  attentionCount,
  connectedAccountCount,
  latestRunGroup,
  runnableCount,
  runnerReady,
  submitApproved,
}: RunnerFlowStripProps) {
  const steps = buildRunnerFlowSteps({
    connectedAccountCount,
    attentionCount,
    latestRunGroup,
    runnableCount,
    runnerReady,
    submitApproved,
  });

  return (
    <section className="runner-flow-strip" aria-label="Runner flow">
      {steps.map((step, index) => (
        <article className={`runner-flow-step ${step.state}`} key={step.label}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </div>
        </article>
      ))}
    </section>
  );
}

export function buildRunnerFlowSteps({
  attentionCount,
  connectedAccountCount,
  latestRunGroup,
  runnableCount,
  runnerReady,
  submitApproved,
}: RunnerFlowStripProps): RunnerFlowStep[] {
  const allReadinessReady = runnerReady && connectedAccountCount > 0 && runnableCount > 0 && attentionCount === 0;
  const latestResult = latestRunResult(latestRunGroup);

  return [
    {
      label: "Readiness",
      state: allReadinessReady ? "ready" : "warning",
      detail: allReadinessReady
        ? "Runner, account, and queue are ready."
        : attentionCount
          ? "Review failed or needs-review queue items first."
          : "Check runner, account, or queue content.",
    },
    {
      label: "Run controls",
      state: submitApproved ? "ready" : "warning",
      detail: submitApproved ? "Live posting approved." : "Prep mode until live posting is approved.",
    },
    {
      label: "Latest result",
      state: latestResult.state,
      detail: latestRunGroup ? `${latestResult.label} - ${formatDate(latestRunGroup.latestAt)}` : "No run - run the queue to record logs.",
    },
  ];
}

function latestRunResult(latestRunGroup: RunnerRunGroup | null) {
  if (latestRunGroup?.errorCount) {
    return { label: "Failed", state: "blocked" as const };
  }
  if (latestRunGroup?.warningCount) {
    return { label: "Needs review", state: "warning" as const };
  }
  return { label: latestRunGroup ? "Recorded" : "No run", state: latestRunGroup ? "ready" as const : "warning" as const };
}

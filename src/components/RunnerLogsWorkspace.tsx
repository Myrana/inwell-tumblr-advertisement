import { Activity, Camera, ChevronDown, ChevronRight, History, ListChecks, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "../domain/format";
import {
  latestRunnerRunId,
  runnerLogRunGroups,
  runnerLogsOutsideQueue,
  visibleRunnerLogs,
} from "../domain/runnerLogs";
import { RunnerLog, RunnerStatus, SubmissionQueueItem } from "../domain/types";

type RunnerLogsWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  runnerLogs: RunnerLog[];
  runnerState: RunnerStatus | null;
  onClearRunnerLogs: () => void;
};

export function RunnerLogsWorkspace({
  activeQueue,
  runnerLogs,
  runnerState,
  onClearRunnerLogs,
}: RunnerLogsWorkspaceProps) {
  const [showLogHistory, setShowLogHistory] = useState(false);
  const [openRunIds, setOpenRunIds] = useState<Set<string>>(new Set());
  const latestRunId = latestRunnerRunId(runnerLogs);
  const scopedLogs = useMemo(() => visibleRunnerLogs(runnerLogs, showLogHistory), [runnerLogs, showLogHistory]);
  const runGroups = useMemo(() => runnerLogRunGroups(scopedLogs), [scopedLogs]);
  const latestRunGroup = runGroups[0] ?? null;
  const outsideQueueLogs = runnerLogsOutsideQueue(activeQueue, scopedLogs);
  const isRunning = Boolean(runnerState?.running);
  const runningTargetCount = activeQueue.filter((item) => item.status === "running").length;
  const pendingTargetCount = activeQueue.filter((item) => item.status === "queued" || item.status === "scheduled").length;
  const logScopeLabel = showLogHistory ? "All history" : latestRunId ? `Latest run ${latestRunId}` : "Latest logs";

  useEffect(() => {
    if (!runGroups.length) {
      setOpenRunIds((current) => (current.size ? new Set() : current));
      return;
    }

    setOpenRunIds((current) => {
      if (current.size > 0 && runGroups.some((group) => current.has(group.id))) {
        return current;
      }

      return new Set([runGroups[0].id]);
    });
  }, [runGroups]);

  function toggleRunGroup(groupId: string) {
    setOpenRunIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return (
    <section className="submission-queue-panel queue-workspace" aria-label="Runner logs">
      <div className="panel-heading">
        <div>
          <h2>Runner logs</h2>
          <span className="queue-log-scope">{logScopeLabel}</span>
        </div>
        <Activity size={18} />
      </div>

      <div className="runner-control-panel" aria-label="Runner log controls">
        <div className="queue-actions queue-log-actions">
          <button className="secondary" type="button" onClick={() => setShowLogHistory((current) => !current)}>
            <History size={18} />
            {showLogHistory ? "Show latest run" : "Show all history"}
          </button>
          <button className="secondary" type="button" onClick={onClearRunnerLogs} disabled={!runnerLogs.length}>
            <Trash2 size={18} />
            Clear logs
          </button>
          {runnerState ? (
            <span className="runner-state">
              {runnerState.running ? `Running: ${runnerState.pid}` : "Not running"}
            </span>
          ) : null}
        </div>
      </div>

      {scopedLogs.length || isRunning ? (
        <div className="runner-log-run-list">
          {isRunning || latestRunGroup ? (
            <section
              className={`runner-latest-summary ${latestRunGroup?.errorCount ? "runner-latest-summary-failed" : ""} ${isRunning ? "runner-latest-summary-running" : ""}`}
              aria-label={isRunning ? "Current queue timeline" : "Latest runner summary"}
            >
              <div className="runner-latest-heading">
                <div>
                  <strong>{latestHeading(isRunning, latestRunGroup)}</strong>
                  <span>{latestMeta(isRunning, latestRunGroup, runnerState)}</span>
                </div>
                <span className="runner-latest-count">
                  {latestRunGroup
                    ? latestRunGroup.targetSummaries.length || latestRunGroup.targetNames.length || latestRunGroup.logs.length
                    : activeQueue.length}
                  {" "}
                  target{(latestRunGroup
                    ? latestRunGroup.targetSummaries.length || latestRunGroup.targetNames.length || latestRunGroup.logs.length
                    : activeQueue.length) === 1 ? "" : "s"}
                </span>
              </div>
              {isRunning ? (
                <div className="runner-live-status" role="status">
                  <span>
                    <ListChecks size={16} />
                    {runningTargetCount ? `${runningTargetCount} running` : "Runner active"}
                  </span>
                  <span>{pendingTargetCount} waiting</span>
                </div>
              ) : null}
              {latestRunGroup?.targetSummaries.length ? (
                <div className="runner-target-summary-list compact" aria-label="Latest run target summaries">
                  {latestRunGroup.targetSummaries.map((summary) => (
                    <div className={`runner-target-summary runner-target-summary-${summary.status}`} key={summary.id}>
                      <strong>{summary.name}</strong>
                      <span>{targetSummaryLabel(summary.status)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {!latestRunGroup?.targetSummaries.length && isRunning && activeQueue.length ? (
                <div className="runner-target-summary-list compact" aria-label="Pending queue targets">
                  {activeQueue.map((item) => (
                    <div className={`runner-target-summary runner-target-summary-${item.status === "running" ? "running" : "pending"}`} key={item.id}>
                      <strong>{item.targetName}</strong>
                      <span>{item.status === "running" ? "Running" : "Waiting"}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {latestRunGroup?.failureExplanations.length ? (
                <div className="runner-failure-summary" role="status">
                  <strong>{latestRunGroup.errorCount ? "Why it failed" : "Why it needs review"}</strong>
                  {latestRunGroup.failureExplanations.map((explanation) => (
                    <span key={explanation}>{explanation}</span>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          {runGroups.map((group, index) => {
            const isOpen = openRunIds.has(group.id);
            const groupTitle = group.runId ? `Run ${group.runId}` : "Untracked runner logs";
            const statusSummary = [
              `${group.logs.length} entr${group.logs.length === 1 ? "y" : "ies"}`,
              group.errorCount ? `${group.errorCount} failed` : "",
              group.warningCount ? `${group.warningCount} warning${group.warningCount === 1 ? "" : "s"}` : "",
            ]
              .filter(Boolean)
              .join(" - ");

            return (
              <article className={`runner-log-run ${group.errorCount ? "runner-log-run-failed" : ""}`} key={group.id}>
                <button
                  aria-expanded={isOpen}
                  className="runner-log-run-summary"
                  type="button"
                  onClick={() => toggleRunGroup(group.id)}
                >
                  {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <span className="runner-log-run-title">
                    <strong>{index === 0 && latestRunId === group.runId ? `Latest run ${group.runId}` : groupTitle}</strong>
                    <span>{group.targetNames.length ? group.targetNames.join(", ") : "No target recorded"}</span>
                  </span>
                  <span className="runner-log-run-meta">
                    {group.errorCount ? <strong className="runner-run-status failed">Failed</strong> : null}
                    {!group.errorCount && group.warningCount ? <strong className="runner-run-status warning">Needs review</strong> : null}
                    <span>{statusSummary}</span>
                    <span>{formatDate(group.latestAt)}</span>
                  </span>
                </button>
                {isOpen ? (
                  <div className="queue-log-list" aria-label={`${groupTitle} entries`}>
                    <div className="runner-run-overview" aria-label={`${groupTitle} timeline overview`}>
                      <span className={`runner-run-status ${runnerRunStatusTone(group)}`}>{runnerRunStatusLabel(group)}</span>
                      <span>{group.timeline.length} timeline step{group.timeline.length === 1 ? "" : "s"}</span>
                      <span>{group.targetNames.length || group.targetSummaries.length || 0} target{(group.targetNames.length || group.targetSummaries.length || 0) === 1 ? "" : "s"}</span>
                      <span>Latest event {formatDate(group.latestAt)}</span>
                      {isRunning && latestRunId === group.runId ? <span>{runningTargetCount ? `${runningTargetCount} running` : "Runner active"} - {pendingTargetCount} waiting</span> : null}
                    </div>
                    {group.targetSummaries.length ? (
                      <div className="runner-target-summary-list" aria-label={`${groupTitle} target summaries`}>
                        {group.targetSummaries.map((summary) => (
                          <div className={`runner-target-summary runner-target-summary-${summary.status}`} key={summary.id}>
                            <strong>{summary.name}</strong>
                            <span>{targetSummaryLabel(summary.status)}</span>
                            {summary.explanation ? <span>{summary.explanation}</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {group.failureExplanations.length ? (
                      <div className="runner-failure-summary" role="status">
                        <strong>{group.errorCount ? "Why this run failed" : "Why this run needs review"}</strong>
                        {group.failureExplanations.map((explanation) => (
                          <span key={explanation}>{explanation}</span>
                        ))}
                      </div>
                    ) : null}
                    {group.timeline.length ? (
                      <div className="runner-step-timeline" aria-label={`${groupTitle} step timeline`}>
                        {group.timeline.map((step) => (
                          <article className={`runner-step runner-step-${step.level}`} key={step.id}>
                            <div className="runner-step-marker" aria-hidden="true" />
                            <div>
                              <strong>{step.label}</strong>
                              <span>{step.targetName} - {formatDate(step.createdAt)}</span>
                              <p>{step.message}</p>
                              {step.screenshotUrl ? (
                                <a href={step.screenshotUrl} target="_blank" rel="noreferrer">
                                  <Camera size={14} />
                                  Screenshot
                                </a>
                              ) : null}
                              {step.postedUrl ? (
                                <a href={step.postedUrl} target="_blank" rel="noreferrer">
                                  Posted Tumblr link
                                </a>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {outsideQueueLogs.length ? (
            <p className="queue-empty">
              {outsideQueueLogs.length} log entry{outsideQueueLogs.length === 1 ? "" : "ies"} belong to another content library item.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="queue-empty">No runner logs yet.</p>
      )}
    </section>
  );
}

function latestHeading(isRunning: boolean, latestRunGroup: ReturnType<typeof runnerLogRunGroups>[number] | null) {
  if (isRunning) {
    return "Current queue timeline";
  }
  if (latestRunGroup?.errorCount) {
    return "Latest run failed";
  }
  if (latestRunGroup?.warningCount) {
    return "Latest run needs review";
  }
  return "Latest run timeline";
}

function runnerRunStatusLabel(group: ReturnType<typeof runnerLogRunGroups>[number]) {
  if (group.errorCount) {
    return "Failed";
  }
  if (group.warningCount) {
    return "Needs review";
  }
  return "Timeline ready";
}

function runnerRunStatusTone(group: ReturnType<typeof runnerLogRunGroups>[number]) {
  if (group.errorCount) {
    return "failed";
  }
  if (group.warningCount) {
    return "warning";
  }
  return "ready";
}

function latestMeta(
  isRunning: boolean,
  latestRunGroup: ReturnType<typeof runnerLogRunGroups>[number] | null,
  runnerState: RunnerStatus | null,
) {
  if (isRunning) {
    const runId = runnerState?.run_id || latestRunGroup?.runId;
    return runId ? `Run ${runId} is running` : "Runner is running";
  }
  if (!latestRunGroup) {
    return "No runner events yet";
  }
  return `${latestRunGroup.runId ? `Run ${latestRunGroup.runId}` : "Untracked run"} - ${formatDate(latestRunGroup.latestAt)}`;
}

function targetSummaryLabel(status: string) {
  if (status === "failed") {
    return "Failed";
  }
  if (status === "needs-review") {
    return "Needs review";
  }
  if (status === "submitted") {
    return "Submitted";
  }
  if (status === "ready") {
    return "Ready for manual review";
  }
  return "Running";
}

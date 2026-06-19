import { Activity, ChevronDown, ChevronRight, History, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "../domain/format";
import {
  displayLogTarget,
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
  onRefreshRunnerStatus: () => void;
};

export function RunnerLogsWorkspace({
  activeQueue,
  runnerLogs,
  runnerState,
  onClearRunnerLogs,
  onRefreshRunnerStatus,
}: RunnerLogsWorkspaceProps) {
  const [showLogHistory, setShowLogHistory] = useState(false);
  const [openRunIds, setOpenRunIds] = useState<Set<string>>(new Set());
  const latestRunId = latestRunnerRunId(runnerLogs);
  const scopedLogs = useMemo(() => visibleRunnerLogs(runnerLogs, showLogHistory), [runnerLogs, showLogHistory]);
  const runGroups = useMemo(() => runnerLogRunGroups(scopedLogs), [scopedLogs]);
  const outsideQueueLogs = runnerLogsOutsideQueue(activeQueue, scopedLogs);
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
          <button className="secondary" type="button" onClick={onRefreshRunnerStatus}>
            <RefreshCw size={18} />
            Refresh logs
          </button>
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

      {scopedLogs.length ? (
        <div className="runner-log-run-list">
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
                    {group.logs.map((log) => (
                      <article className={`queue-log queue-log-${log.level}`} key={log.id}>
                        <strong>{log.message}</strong>
                        <span>
                          {displayLogTarget(log, activeQueue)} - {formatDate(log.createdAt)}
                        </span>
                      </article>
                    ))}
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

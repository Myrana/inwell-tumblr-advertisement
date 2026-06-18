import { Activity, History, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDate } from "../domain/format";
import { displayLogTarget, latestRunnerRunId, runnerLogsOutsideQueue, visibleRunnerLogs } from "../domain/runnerLogs";
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
  const latestRunId = latestRunnerRunId(runnerLogs);
  const scopedLogs = visibleRunnerLogs(runnerLogs, showLogHistory);
  const outsideQueueLogs = runnerLogsOutsideQueue(activeQueue, scopedLogs);
  const logScopeLabel = showLogHistory ? "All history" : latestRunId ? `Latest run ${latestRunId}` : "Latest logs";

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
        <div className="queue-log-list">
          {scopedLogs.map((log) => (
            <article className={`queue-log queue-log-${log.level}`} key={log.id}>
              <strong>{log.message}</strong>
              <span>
                {displayLogTarget(log, activeQueue)} - {formatDate(log.createdAt)}
              </span>
            </article>
          ))}
          {outsideQueueLogs.length ? (
            <p className="queue-empty">
              {outsideQueueLogs.length} log entry{outsideQueueLogs.length === 1 ? "" : "ies"} belong to another saved submission.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="queue-empty">No runner logs yet.</p>
      )}
    </section>
  );
}

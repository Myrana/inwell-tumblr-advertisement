import { Copy, List, Play, Plus, Send } from "lucide-react";
import { formatDate } from "../domain/format";
import {
  RunnerSettings,
  RunnerStatus,
  SubmissionQueueItem,
  SubmissionStatus,
  TumblrSubmitTarget,
} from "../domain/types";

type QueueWorkspaceProps = {
  activeQueue: SubmissionQueueItem[];
  activeSubmitTarget: TumblrSubmitTarget;
  queueStatus: string;
  runnerSettings: RunnerSettings;
  runnerState: RunnerStatus | null;
  targetOptions: TumblrSubmitTarget[];
  onClearCompleted: () => void;
  onCopyRunnerPlan: () => void;
  onQueueTargets: (targets: TumblrSubmitTarget[]) => void;
  onRefreshRunnerStatus: () => void;
  onRunnerSettingsChange: (patch: Partial<RunnerSettings>) => void;
  onStartRunner: () => void;
  onUpdateQueueItem: (id: string, status: SubmissionStatus, notes: string) => void;
};

export function QueueWorkspace({
  activeQueue,
  activeSubmitTarget,
  queueStatus,
  runnerSettings,
  runnerState,
  targetOptions,
  onClearCompleted,
  onCopyRunnerPlan,
  onQueueTargets,
  onRefreshRunnerStatus,
  onRunnerSettingsChange,
  onStartRunner,
  onUpdateQueueItem,
}: QueueWorkspaceProps) {
  return (
    <section className="submission-queue-panel queue-workspace" aria-label="Tumblr submission queue">
      <div className="panel-heading">
        <h2>Submission queue</h2>
        <Send size={18} />
      </div>
      <div className="runner-control-panel" aria-label="Local Tumblr runner controls">
        <div className="field-grid three">
          <label>
            Media folder
            <input
              value={runnerSettings.mediaDir}
              onChange={(event) => onRunnerSettingsChange({ mediaDir: event.target.value })}
              placeholder="C:\Users\mandy\OneDrive\Desktop\rp\Grass is Greener"
            />
          </label>
          <label>
            Slow motion
            <input
              min={0}
              max={5000}
              step={100}
              type="number"
              value={runnerSettings.slowMo}
              onChange={(event) => onRunnerSettingsChange({ slowMo: Number(event.target.value) || 0 })}
            />
          </label>
          <label className="runner-submit-toggle">
            <input
              checked={runnerSettings.submit}
              type="checkbox"
              onChange={(event) => onRunnerSettingsChange({ submit: event.target.checked })}
            />
            Click Submit after filling
          </label>
        </div>
        <div className="queue-actions">
          <button className="primary" type="button" onClick={onStartRunner} disabled={!activeQueue.length}>
            <Play size={18} />
            Run queue
          </button>
          <button className="secondary" type="button" onClick={onRefreshRunnerStatus}>
            Refresh runner status
          </button>
          {runnerState ? (
            <span className="runner-state">
              {runnerState.running ? `Running: ${runnerState.pid}` : "Not running"}
            </span>
          ) : null}
        </div>
      </div>
      <div className="queue-actions">
        <button className="secondary" type="button" onClick={() => onQueueTargets([activeSubmitTarget])}>
          <Plus size={18} />
          Queue current
        </button>
        <button className="secondary" type="button" onClick={() => onQueueTargets(targetOptions)}>
          <List size={18} />
          Queue all targets
        </button>
        <button className="secondary" type="button" onClick={onCopyRunnerPlan} disabled={!activeQueue.length}>
          <Copy size={18} />
          Export automation plan
        </button>
        <button className="secondary" type="button" onClick={onClearCompleted}>
          Clear completed
        </button>
      </div>
      {queueStatus ? <p className="queue-status">{queueStatus}</p> : null}
      <div className="queue-list">
        {activeQueue.length ? (
          activeQueue.map((item) => (
            <article className="queue-item" key={item.id}>
              <div>
                <strong>{item.targetName}</strong>
                <span>{item.postType} - {item.status} - {formatDate(item.updatedAt)}</span>
                <a href={item.submitUrl} target="_blank" rel="noreferrer">
                  {item.submitUrl}
                </a>
              </div>
              <div className="queue-item-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => onUpdateQueueItem(item.id, "submitting", "Runner started this target.")}
                >
                  Runner started
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    onUpdateQueueItem(item.id, "manual-action", "Tumblr requires login, captcha, media upload, or form review.")
                  }
                >
                  Needs action
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => onUpdateQueueItem(item.id, "submitted", "Marked submitted after Tumblr accepted the form.")}
                >
                  Submitted
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => onUpdateQueueItem(item.id, "failed", "Marked failed for runner retry or review.")}
                >
                  Failed
                </button>
              </div>
              <p>{item.notes}</p>
            </article>
          ))
        ) : (
          <p className="queue-empty">Queue one or more Tumblr blogs, then run the automation step.</p>
        )}
      </div>
    </section>
  );
}

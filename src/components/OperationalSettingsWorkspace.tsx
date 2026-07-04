import { Clock3, PlayCircle, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { QueueDefinition, QueueScheduleSettings, RunnerSettings, TumblrAccount, WorkspaceView } from "../domain/types";

type OperationalSettingsWorkspaceProps = {
  activeQueueName: string;
  queueOptions: QueueDefinition[];
  queueScheduleSettings: QueueScheduleSettings;
  runnerSettings: RunnerSettings;
  tumblrAccounts: TumblrAccount[];
  onNavigate: (view: WorkspaceView) => void;
  onQueueScheduleSettingsChange: (patch: Partial<QueueScheduleSettings>) => void;
  onRunnerSettingsChange: (patch: Partial<RunnerSettings>) => void;
};

export function OperationalSettingsWorkspace({
  activeQueueName,
  queueOptions,
  queueScheduleSettings,
  runnerSettings,
  tumblrAccounts,
  onNavigate,
  onQueueScheduleSettingsChange,
  onRunnerSettingsChange,
}: OperationalSettingsWorkspaceProps) {
  const connectedAccounts = tumblrAccounts.filter((account) => account.status === "connected");
  const selectedAccount = connectedAccounts.find((account) => account.id === runnerSettings.tumblrAccountId);

  return (
    <section className="settings-workspace" aria-label="Operational settings">
      <div className="settings-grid">
        <section className="settings-panel" aria-label="Runner defaults">
          <div className="settings-panel-heading">
            <PlayCircle size={18} />
            <div>
              <span>Runner defaults</span>
              <h2>Automation mode</h2>
            </div>
          </div>
          <label className="runner-submit-toggle">
            <input checked={runnerSettings.headless} type="checkbox" onChange={(event) => onRunnerSettingsChange({ headless: event.target.checked })} />
            Headless browser
          </label>
          <label className="runner-submit-toggle">
            <input checked={runnerSettings.submit} type="checkbox" onChange={(event) => onRunnerSettingsChange({ submit: event.target.checked })} />
            Approve live posting
          </label>
          <label>
            Runner pacing
            <input
              min="0"
              step="100"
              type="number"
              value={runnerSettings.slowMo}
              onChange={(event) => onRunnerSettingsChange({ slowMo: Number(event.target.value) || 0 })}
            />
          </label>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("runner")}>
            Runner controls
          </button>
        </section>

        <section className="settings-panel" aria-label="Schedule defaults">
          <div className="settings-panel-heading">
            <Clock3 size={18} />
            <div>
              <span>Schedule defaults</span>
              <h2>Daily queue timing</h2>
            </div>
          </div>
          <label className="runner-submit-toggle">
            <input checked={queueScheduleSettings.enabled} type="checkbox" onChange={(event) => onQueueScheduleSettingsChange({ enabled: event.target.checked })} />
            Enable daily automation by default
          </label>
          <label>
            Default daily run time
            <input
              type="time"
              value={queueScheduleSettings.dailyTime}
              onChange={(event) => onQueueScheduleSettingsChange({ dailyTime: event.target.value })}
            />
          </label>
          <small>{queueOptions.length} queue lane{queueOptions.length === 1 ? "" : "s"} configured. Active queue: {activeQueueName || "none"}.</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("queue-settings")}>
            Manage queue lanes
          </button>
        </section>

        <section className="settings-panel" aria-label="Account defaults">
          <div className="settings-panel-heading">
            <ShieldCheck size={18} />
            <div>
              <span>Account defaults</span>
              <h2>Posting identity</h2>
            </div>
          </div>
          <label>
            Runner account
            <select
              value={selectedAccount?.id ?? ""}
              onChange={(event) => onRunnerSettingsChange({ tumblrAccountId: event.target.value })}
              disabled={!connectedAccounts.length}
            >
              <option value="">{connectedAccounts.length ? "Choose connected account" : "No connected accounts"}</option>
              {connectedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName}
                </option>
              ))}
            </select>
          </label>
          <small>{connectedAccounts.length ? `${connectedAccounts.length} connected account${connectedAccounts.length === 1 ? "" : "s"} available.` : "Connect an account before live runs."}</small>
          <button className="secondary compact-button" type="button" onClick={() => onNavigate("accounts")}>
            Account health
          </button>
        </section>

        <section className="settings-panel settings-panel-wide" aria-label="Workspace maintenance">
          <div className="settings-panel-heading">
            <SlidersHorizontal size={18} />
            <div>
              <span>Workspace maintenance</span>
              <h2>Backup and recovery</h2>
            </div>
          </div>
          <p>
            Operational backup and restore controls stay outside the dashboard so daily queue work stays focused on readiness, recovery, and runner flow.
          </p>
          <div className="settings-action-row">
            <button className="secondary compact-button" type="button" onClick={() => onNavigate("docs")}>
              Review workflow guide
            </button>
            <button className="secondary compact-button" type="button" onClick={() => onNavigate("logs")}>
              Runner evidence
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

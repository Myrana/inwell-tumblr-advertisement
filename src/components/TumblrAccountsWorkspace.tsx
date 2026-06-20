import { FormEvent } from "react";
import { FileText, LogIn, RefreshCw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { formatDate } from "../domain/format";
import { RunnerSettings, TumblrAccount } from "../domain/types";

type TumblrAccountsWorkspaceProps = {
  accounts: TumblrAccount[];
  draft: { displayName: string; blogName: string };
  runnerSettings: RunnerSettings;
  status: string;
  selectedAccountId: string;
  onCreateSubmission: () => void;
  onCreateAccount: (event: FormEvent) => void;
  onDeleteAccount: (id: string) => void;
  onDraftChange: (patch: Partial<{ displayName: string; blogName: string }>) => void;
  onCheckAllLogins: () => void;
  onCheckLogin: (id: string) => void;
  onLaunchLogin: (id: string) => void;
  onMarkConnected: (id: string) => void;
  onRunnerSettingsChange: (patch: Partial<RunnerSettings>) => void;
  onSelectAccount: (id: string) => void;
};

function accountStatusLabel(account: TumblrAccount) {
  if (account.status === "connected") return "Connected";
  if (account.status === "checking") return "Connection pending";
  if (account.status === "expired") return "Expired";
  return "Needs login";
}

function isAccountHealthStale(account: TumblrAccount, now = new Date()) {
  if (!account.lastCheckedAt) {
    return true;
  }
  const lastCheckedAt = new Date(account.lastCheckedAt);
  if (Number.isNaN(lastCheckedAt.getTime())) {
    return true;
  }
  return now.getTime() - lastCheckedAt.getTime() > 7 * 24 * 60 * 60 * 1000;
}

export function TumblrAccountsWorkspace({
  accounts,
  draft,
  runnerSettings,
  status,
  selectedAccountId,
  onCreateSubmission,
  onCreateAccount,
  onDeleteAccount,
  onDraftChange,
  onCheckAllLogins,
  onCheckLogin,
  onLaunchLogin,
  onMarkConnected,
  onRunnerSettingsChange,
  onSelectAccount,
}: TumblrAccountsWorkspaceProps) {
  const connectedAccounts = accounts.filter((account) => account.status === "connected");
  const staleAccounts = accounts.filter((account) => isAccountHealthStale(account));
  const attentionAccounts = accounts.filter((account) => account.status !== "connected" || isAccountHealthStale(account));
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const connectedAccount = selectedAccount?.status === "connected"
    ? selectedAccount
    : accounts.find((account) => account.status === "connected");
  const visibleStatus = connectedAccount && status === `${connectedAccount.displayName} is ready for queue runs.` ? "" : status;

  return (
    <section className="submission-queue-panel accounts-workspace" aria-label="Tumblr account sessions">
      <div className="panel-heading">
        <h2>Tumblr accounts</h2>
        <ShieldCheck size={18} />
      </div>

      <div className="account-settings-grid">
        <form className="queue-management-form account-create-form" onSubmit={onCreateAccount}>
          <label>
            Account name
            <input
              value={draft.displayName}
              onChange={(event) => onDraftChange({ displayName: event.target.value })}
              placeholder="Myrana Tumblr"
            />
          </label>
          <label>
            Tumblr blog name
            <input
              value={draft.blogName}
              onChange={(event) => onDraftChange({ blogName: event.target.value })}
              placeholder="snowleopardx"
            />
          </label>
          <button className="secondary" type="submit">
            <UserPlus size={18} />
            Add account
          </button>
        </form>

        <section className="runner-browser-settings" aria-label="Runner browser settings">
          <div className="queue-command-heading">
            <strong>Runner browser</strong>
            <span>
              {connectedAccounts.length
                ? `${connectedAccounts.length} connected account${connectedAccounts.length === 1 ? "" : "s"} available`
                : "Connect an account before queue runs"}
            </span>
          </div>
          <div className="queue-management-form runner-browser-form">
            <label>
              Runner account
              <select
                value={selectedAccount?.status === "connected" ? selectedAccount.id : ""}
                onChange={(event) => onSelectAccount(event.target.value)}
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
            <label>
              Browser provider
              <select
                value={runnerSettings.remoteBrowserProvider}
                onChange={(event) =>
                  onRunnerSettingsChange({
                    remoteBrowserProvider: event.target.value as RunnerSettings["remoteBrowserProvider"],
                  })
                }
              >
                <option value="none">Local desktop</option>
                <option value="browserless">Browserless</option>
                <option value="custom">Custom live browser URL</option>
              </select>
            </label>
            {runnerSettings.remoteBrowserProvider === "custom" || runnerSettings.remoteBrowserProvider === "browserless" ? (
              <label>
                Live browser URL
                <input
                  value={runnerSettings.remoteBrowserLaunchUrl}
                  onChange={(event) => onRunnerSettingsChange({ remoteBrowserLaunchUrl: event.target.value })}
                  placeholder="https://provider.example/live/session"
                />
              </label>
            ) : null}
          </div>
          {!connectedAccounts.length ? (
            <p className="queue-empty">Connect a Tumblr account below before selecting one for the runner.</p>
          ) : null}
        </section>
      </div>

      {visibleStatus ? <p className="queue-status">{visibleStatus}</p> : null}

      <section className="account-health-panel" aria-label="Tumblr account health">
        <div className="queue-command-heading">
          <strong>Account health</strong>
          <span>
            {accounts.length
              ? `${attentionAccounts.length} need attention out of ${accounts.length}`
              : "No accounts to check yet"}
          </span>
        </div>
        <div className="queue-monitor-grid account-health-grid">
          <div className="queue-monitor-stat">
            <span>Connected</span>
            <strong>{connectedAccounts.length}</strong>
          </div>
          <div className="queue-monitor-stat">
            <span>Need login</span>
            <strong>{accounts.filter((account) => account.status !== "connected").length}</strong>
          </div>
          <div className="queue-monitor-stat">
            <span>Stale check</span>
            <strong>{staleAccounts.length}</strong>
          </div>
        </div>
        <button className="secondary" type="button" onClick={onCheckAllLogins} disabled={!accounts.length}>
          <ShieldCheck size={16} />
          Check all saved logins
        </button>
      </section>

      {connectedAccount ? (
        <div className="account-ready-panel" role="status">
          <div>
            <strong>{connectedAccount.displayName} is ready</strong>
            <span>Tumblr is connected. Create content when you are ready to add something to the queue.</span>
          </div>
          <button className="primary" type="button" onClick={onCreateSubmission}>
            <FileText size={18} />
            Create submission
          </button>
        </div>
      ) : null}

      <div className="queue-management-list">
        {accounts.length ? (
          accounts.map((account) => (
            <article
              className={account.id === selectedAccountId ? "account-session-row selected" : "account-session-row"}
              key={account.id}
            >
              <div className="account-session-summary">
                <span className={`account-status-pill account-status-${account.status}`}>{accountStatusLabel(account)}</span>
                <strong>{account.displayName}</strong>
                <span>{account.blogName || account.id}</span>
              </div>
              <div className="queue-item-actions">
                {account.status === "connected" ? null : (
                  <button className="secondary" type="button" onClick={() => onLaunchLogin(account.id)}>
                    <LogIn size={16} />
                    Connect
                  </button>
                )}
                <button className="secondary" type="button" onClick={() => onCheckLogin(account.id)}>
                  <ShieldCheck size={16} />
                  Check saved login
                </button>
                {account.status === "connected" ? null : (
                  <button className="secondary" type="button" onClick={() => onMarkConnected(account.id)}>
                    <RefreshCw size={16} />
                    Mark connected
                  </button>
                )}
                <button className="secondary" type="button" onClick={() => onDeleteAccount(account.id)}>
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
              <div className="account-session-note">
                <strong>{account.notes || accountStatusLabel(account)}</strong>
                <span>
                  {isAccountHealthStale(account)
                    ? "Health check is stale. Check saved login before running."
                    : `Last checked ${formatDate(account.lastCheckedAt)}`}
                </span>
              </div>
            </article>
          ))
        ) : (
          <p className="queue-empty">Add a Tumblr account, connect a browser session, then select it before running a queue.</p>
        )}
      </div>
    </section>
  );
}

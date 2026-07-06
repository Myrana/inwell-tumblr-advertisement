import { FormEvent } from "react";
import { FileText, LogIn, RefreshCw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { formatDate } from "../domain/format";
import { isTumblrAccountHealthStale, runnerAccountReadiness } from "../domain/tumblrAccounts";
import { TumblrAccount } from "../domain/types";
import "./tumblrAccountsWorkspace.css";

type TumblrAccountsWorkspaceProps = {
  accounts: TumblrAccount[];
  draft: { displayName: string; blogName: string };
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
  onSelectAccount: (id: string) => void;
};

function accountStatusLabel(account: TumblrAccount) {
  if (account.status === "connected") return "Connected";
  if (account.status === "checking") return "Connection pending";
  if (account.status === "expired") return "Expired";
  return "Needs login";
}

export function TumblrAccountsWorkspace({
  accounts,
  draft,
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
  onSelectAccount,
}: TumblrAccountsWorkspaceProps) {
  const accountReadiness = runnerAccountReadiness(accounts, selectedAccountId);
  const connectedAccounts = accounts.filter((account) => account.status === "connected");
  const staleAccounts = accounts.filter((account) => isTumblrAccountHealthStale(account));
  const attentionAccounts = accounts.filter((account) => account.status !== "connected" || isTumblrAccountHealthStale(account));
  const connectedAccount = accountReadiness.selectedConnectedAccount ?? connectedAccounts[0];
  const visibleStatus = connectedAccount && status === `${connectedAccount.displayName} is ready for queue runs.` ? "" : status;

  return (
    <section className="submission-queue-panel accounts-workspace" aria-label="Tumblr account sessions">
      <div className="panel-heading">
        <h2>Tumblr accounts</h2>
        <ShieldCheck size={18} />
      </div>

      <section className="account-overview-panel" aria-label="Account overview">
        <div>
          <span>Account overview</span>
          <h3>
            {connectedAccounts.length ? `${connectedAccounts.length} connected account${connectedAccounts.length === 1 ? "" : "s"}` : "No connected Tumblr accounts yet"}
          </h3>
          <p>
            {accountReadiness.readyAccount
              ? `${accountReadiness.readyAccount.displayName} is selected for runner work. ${attentionAccounts.length} account${attentionAccounts.length === 1 ? "" : "s"} need a login or health check.`
              : accountReadiness.selectedConnectedAccount
                ? `${accountReadiness.selectedConnectedAccount.displayName} is selected but needs a fresh login health check before runner work.`
              : connectedAccount
                ? `${connectedAccount.displayName} is connected and available. Choose it as the runner account before automation.`
              : "Add a Tumblr account, connect it through the local runner, then choose it for queue automation."}
          </p>
        </div>
        <div className="account-overview-stats" aria-label="Account health summary">
          <article className={connectedAccounts.length ? "ready" : ""}>
            <strong>{connectedAccounts.length}</strong>
            <span>Connected</span>
          </article>
          <article className={attentionAccounts.length ? "warning" : "ready"}>
            <strong>{attentionAccounts.length}</strong>
            <span>Need attention</span>
          </article>
          <article className={staleAccounts.length ? "warning" : "ready"}>
            <strong>{staleAccounts.length}</strong>
            <span>Stale checks</span>
          </article>
        </div>
        <div className="account-overview-actions">
          <button className="primary compact-button" type="button" onClick={onCheckAllLogins} disabled={!accounts.length}>
            <ShieldCheck size={16} />
            Check Logins
          </button>
          <button className="secondary compact-button" type="button" onClick={onCreateSubmission} disabled={!connectedAccounts.length}>
            <FileText size={16} />
            Write Advertisement
          </button>
        </div>
      </section>

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
            <strong>Local runner session</strong>
            <span>
              {connectedAccounts.length
                ? `${connectedAccounts.length} connected account${connectedAccounts.length === 1 ? "" : "s"} available`
                : "Verify an account before queue runs"}
            </span>
          </div>
          <div className="queue-management-form runner-browser-form">
            <label>
              Runner account
              <select
                value={accountReadiness.selectedConnectedAccount ? accountReadiness.selectedConnectedAccount.id : ""}
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
          </div>
          {!connectedAccounts.length ? (
            <p className="queue-empty">Click Connect on an account to open Tumblr login through the local runner.</p>
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

      {connectedAccounts.length ? (
        <div className={accountReadiness.readyAccount ? "account-ready-panel" : "account-ready-panel warning"} role="status" aria-label="Automation account readiness">
          <div>
            <strong>
              {accountReadiness.readyAccount
                ? `${accountReadiness.readyAccount.displayName} is ready for runner work`
                : accountReadiness.selectedConnectedAccount
                  ? `${accountReadiness.selectedConnectedAccount.displayName} needs a fresh login check`
                  : "Choose a runner account before automation"}
            </strong>
            <span>
              {accountReadiness.readyAccount
                ? "Tumblr is connected, selected, and ready for queue runs."
                : accountReadiness.selectedConnectedAccount
                  ? "The selected account is connected, but its health check is stale. Check saved login before running."
                  : "A connected account is available, but the runner will not use it until you choose it from Runner account."}
            </span>
          </div>
          {accountReadiness.readyAccount ? (
            <button className="primary" type="button" onClick={onCreateSubmission}>
              <FileText size={18} />
              Create submission
            </button>
          ) : (
            <button className="secondary" type="button" onClick={onCheckAllLogins}>
              <ShieldCheck size={18} />
              Check logins
            </button>
          )}
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
                {account.id === selectedAccountId ? <span className="account-selected-pill">Runner account</span> : null}
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
                  {isTumblrAccountHealthStale(account)
                    ? "Health check is stale. Check saved login before running."
                    : account.lastCheckedAt
                      ? `Last checked ${formatDate(account.lastCheckedAt)}`
                      : "Health check not run yet."}
                </span>
              </div>
            </article>
          ))
        ) : (
          <p className="queue-empty">Add a Tumblr account, verify it with the local runner, then select it before running a queue.</p>
        )}
      </div>
    </section>
  );
}

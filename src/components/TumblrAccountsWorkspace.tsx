import { FormEvent } from "react";
import { LogIn, RefreshCw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { formatDate } from "../domain/format";
import { TumblrAccount } from "../domain/types";

type TumblrAccountsWorkspaceProps = {
  accounts: TumblrAccount[];
  draft: { displayName: string; blogName: string };
  status: string;
  selectedAccountId: string;
  onCreateAccount: (event: FormEvent) => void;
  onDeleteAccount: (id: string) => void;
  onDraftChange: (patch: Partial<{ displayName: string; blogName: string }>) => void;
  onLaunchLogin: (id: string) => void;
  onMarkConnected: (id: string) => void;
  onSelectAccount: (id: string) => void;
};

function accountStatusLabel(account: TumblrAccount) {
  if (account.status === "connected") return "Connected";
  if (account.status === "checking") return "Login helper open";
  if (account.status === "expired") return "Expired";
  return "Needs login";
}

export function TumblrAccountsWorkspace({
  accounts,
  draft,
  status,
  selectedAccountId,
  onCreateAccount,
  onDeleteAccount,
  onDraftChange,
  onLaunchLogin,
  onMarkConnected,
  onSelectAccount,
}: TumblrAccountsWorkspaceProps) {
  return (
    <section className="submission-queue-panel accounts-workspace" aria-label="Tumblr account sessions">
      <div className="panel-heading">
        <h2>Tumblr accounts</h2>
        <ShieldCheck size={18} />
      </div>

      <form className="queue-management-form" onSubmit={onCreateAccount}>
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

      {status ? <p className="queue-status">{status}</p> : null}

      <div className="queue-management-list">
        {accounts.length ? (
          accounts.map((account) => (
            <article className={account.id === selectedAccountId ? "queue-management-row selected" : "queue-management-row"} key={account.id}>
              <button type="button" onClick={() => onSelectAccount(account.id)}>
                <strong>{account.displayName}</strong>
                <span>
                  {account.blogName || account.id} - {accountStatusLabel(account)}
                </span>
                <span>{account.userDataDir}</span>
              </button>
              <div className="queue-item-actions">
                <button className="secondary" type="button" onClick={() => onLaunchLogin(account.id)}>
                  <LogIn size={16} />
                  Connect
                </button>
                <button className="secondary" type="button" onClick={() => onMarkConnected(account.id)}>
                  <RefreshCw size={16} />
                  Mark connected
                </button>
                <button className="secondary" type="button" onClick={() => onDeleteAccount(account.id)}>
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
              <div className="queue-item-explanation">
                <strong>{account.notes || accountStatusLabel(account)}</strong>
                <span>
                  {account.lastCheckedAt ? `Last checked ${formatDate(account.lastCheckedAt)}` : "No session check recorded yet."}
                </span>
              </div>
            </article>
          ))
        ) : (
          <p className="queue-empty">Add a Tumblr account, launch the login helper, then select it before running a queue.</p>
        )}
      </div>
    </section>
  );
}

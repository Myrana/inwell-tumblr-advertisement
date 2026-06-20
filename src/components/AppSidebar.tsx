import { Activity, Archive, ClipboardCheck, FileText, Gauge, ListChecks, ShieldCheck } from "lucide-react";
import { AuthUser, WorkspaceView } from "../domain/types";

type AppSidebarProps = {
  activeView: WorkspaceView;
  user: AuthUser;
  onViewChange: (view: WorkspaceView) => void;
  onLogout: () => void;
};

export function AppSidebar({
  activeView,
  user,
  onViewChange,
  onLogout,
}: AppSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">I</div>
        <div>
          <strong>Inkwell</strong>
          <span>Tumblr Advertisement Assistant</span>
        </div>
      </div>

      <div className="account-strip">
        <span>{user.displayName || user.email}</span>
        <button type="button" onClick={onLogout} aria-label="Log out">
          Log out
        </button>
      </div>

      <nav className="nav-list" aria-label="Workspace views">
        <button className={activeView === "dashboard" ? "active" : ""} type="button" onClick={() => onViewChange("dashboard")}>
          <Gauge size={18} />
          Operations
        </button>
        <button className={activeView === "editor" ? "active" : ""} type="button" onClick={() => onViewChange("editor")}>
          <FileText size={18} />
          New Submission
        </button>
        <button className={activeView === "saved" ? "active" : ""} type="button" onClick={() => onViewChange("saved")}>
          <Archive size={18} />
          Content Library
        </button>
        <button className={activeView === "templates" ? "active" : ""} type="button" onClick={() => onViewChange("templates")}>
          <ClipboardCheck size={18} />
          Templates
        </button>
        <button
          className={activeView === "queue" || activeView === "queue-settings" ? "active" : ""}
          type="button"
          onClick={() => onViewChange("queue-settings")}
        >
          <ListChecks size={18} />
          Queues
        </button>
        <button className={activeView === "accounts" ? "active" : ""} type="button" onClick={() => onViewChange("accounts")}>
          <ShieldCheck size={18} />
          Tumblr Accounts
        </button>
        <button className={activeView === "logs" ? "active" : ""} type="button" onClick={() => onViewChange("logs")}>
          <Activity size={18} />
          Runner Logs
        </button>
      </nav>

    </aside>
  );
}

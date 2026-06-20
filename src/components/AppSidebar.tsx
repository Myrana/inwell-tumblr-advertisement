import { BookOpenText, FileText, Gauge } from "lucide-react";
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
        <button className={activeView === "docs" ? "active" : ""} type="button" onClick={() => onViewChange("docs")}>
          <BookOpenText size={18} />
          Docs
        </button>
      </nav>

    </aside>
  );
}

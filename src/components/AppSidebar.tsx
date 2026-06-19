import { Activity, Archive, ClipboardCheck, FileText, ListChecks, Send } from "lucide-react";
import { WorkspaceView } from "../domain/types";

type AppSidebarProps = {
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
};

export function AppSidebar({
  activeView,
  onViewChange,
}: AppSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">I</div>
        <div>
          <strong>Inwell</strong>
          <span>Tumblr Advertisement Assistant</span>
        </div>
      </div>

      <div className="account-strip">
        <span>Myrana Staff</span>
      </div>

      <nav className="nav-list" aria-label="Workspace views">
        <button className={activeView === "editor" ? "active" : ""} type="button" onClick={() => onViewChange("editor")}>
          <FileText size={18} />
          Editor
        </button>
        <button className={activeView === "saved" ? "active" : ""} type="button" onClick={() => onViewChange("saved")}>
          <Archive size={18} />
          Saved Submissions
        </button>
        <button className={activeView === "templates" ? "active" : ""} type="button" onClick={() => onViewChange("templates")}>
          <ClipboardCheck size={18} />
          Templates
        </button>
        <button className={activeView === "queue" ? "active" : ""} type="button" onClick={() => onViewChange("queue")}>
          <Send size={18} />
          Queue
        </button>
        <button className={activeView === "queue-settings" ? "active" : ""} type="button" onClick={() => onViewChange("queue-settings")}>
          <ListChecks size={18} />
          Queues
        </button>
        <button className={activeView === "logs" ? "active" : ""} type="button" onClick={() => onViewChange("logs")}>
          <Activity size={18} />
          Runner Logs
        </button>
      </nav>

    </aside>
  );
}

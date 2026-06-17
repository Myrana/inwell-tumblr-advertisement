import { Archive, ClipboardCheck, FileText, LogOut, Send } from "lucide-react";
import { WorkspaceView } from "../domain/types";

type AppSidebarProps = {
  activeView: WorkspaceView;
  apiAvailable: boolean;
  savedCount: number;
  selectedTagCount: number;
  templateCount: number;
  onViewChange: (view: WorkspaceView) => void;
};

export function AppSidebar({
  activeView,
  apiAvailable,
  savedCount,
  selectedTagCount,
  templateCount,
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
        <button className="icon-button" type="button" aria-label="Log out" title="Log out">
          <LogOut size={18} />
        </button>
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
      </nav>

      <section className="metric-panel" aria-label="Advertisement counts">
        <div>
          <span>{savedCount}</span>
          <p>Saved</p>
        </div>
        <div>
          <span>{templateCount}</span>
          <p>Templates</p>
        </div>
        <div>
          <span>{selectedTagCount}</span>
          <p>Selected tags</p>
        </div>
        <div>
          <span>{apiAvailable ? "API" : "Local"}</span>
          <p>Storage</p>
        </div>
      </section>
    </aside>
  );
}

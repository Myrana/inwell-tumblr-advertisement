import {
  Archive,
  BookOpenText,
  FileText,
  Gauge,
  ListChecks,
  PlayCircle,
  Settings,
  ShieldCheck,
  Tags,
  TerminalSquare,
} from "lucide-react";
import { AuthUser, WorkspaceView } from "../domain/types";
import "./AppSidebar.css";

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
  const navGroups: Array<{ label: string; items: Array<{ view: WorkspaceView; label: string; icon: JSX.Element }> }> = [
    {
      label: "Create",
      items: [
        { view: "editor", label: "New Submission", icon: <FileText size={18} /> },
        { view: "saved", label: "Content Library", icon: <Archive size={18} /> },
        { view: "templates", label: "Templates", icon: <Tags size={18} /> },
      ],
    },
    {
      label: "Operate",
      items: [
        { view: "dashboard", label: "Operations", icon: <Gauge size={18} /> },
        { view: "queue", label: "Queue", icon: <ListChecks size={18} /> },
        { view: "runner", label: "Runner", icon: <PlayCircle size={18} /> },
      ],
    },
    {
      label: "Setup",
      items: [
        { view: "accounts", label: "Accounts", icon: <ShieldCheck size={18} /> },
        { view: "queue-settings", label: "Queues", icon: <Settings size={18} /> },
        { view: "settings", label: "Settings", icon: <Settings size={18} /> },
      ],
    },
    {
      label: "Inspect",
      items: [
        { view: "logs", label: "Runner Logs", icon: <TerminalSquare size={18} /> },
        { view: "docs", label: "Docs", icon: <BookOpenText size={18} /> },
      ],
    },
  ];

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
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map((item) => (
              <button
                className={activeView === item.view ? "active" : ""}
                key={item.view}
                type="button"
                onClick={() => onViewChange(item.view)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

    </aside>
  );
}

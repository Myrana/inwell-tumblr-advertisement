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
import { Fragment, useState } from "react";
import { AuthUser, WorkspaceView } from "../domain/types";
import { loadCollapsedSidebarGroups, saveCollapsedSidebarGroups } from "../domain/storage";
import "./AppSidebar.css";

type AppSidebarProps = {
  activeView: WorkspaceView;
  user: AuthUser;
  onViewChange: (view: WorkspaceView) => void;
  onLogout: () => void;
  counts?: Partial<Record<WorkspaceView, number>>;
};

export function AppSidebar({
  activeView,
  user,
  onViewChange,
  onLogout,
  counts = {},
}: AppSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(loadCollapsedSidebarGroups);
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
      label: "Operations",
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
        { view: "queue-settings", label: "Queues", icon: <ListChecks size={18} /> },
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
  const activeGroupLabel = navGroups.find((group) => group.items.some((item) => item.view === activeView))?.label;

  function setGroupCollapsed(label: string, collapsed: boolean) {
    const next = collapsed ? [...new Set([...collapsedGroups, label])] : collapsedGroups.filter((group) => group !== label);
    setCollapsedGroups(next);
    saveCollapsedSidebarGroups(next);
  }

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
          <details
            className="nav-group"
            key={group.label}
            open={group.label === activeGroupLabel || !collapsedGroups.includes(group.label)}
          >
            <summary
              className="nav-group-label"
              onClick={(event) => {
                event.preventDefault();
                setGroupCollapsed(group.label, !collapsedGroups.includes(group.label));
              }}
            >
              {group.label}
            </summary>
            <div className="nav-group-items">
              {group.items.map((item) => (
                <Fragment key={item.view}>
                  <button
                    className={activeView === item.view ? "active" : ""}
                    type="button"
                    onClick={() => onViewChange(item.view)}
                    aria-describedby={typeof counts[item.view] === "number" ? `nav-${item.view}-count` : undefined}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {typeof counts[item.view] === "number" ? <b className="nav-count" aria-hidden="true">{counts[item.view]}</b> : null}
                  </button>
                  {typeof counts[item.view] === "number" ? (
                    <span className="nav-count-description" id={`nav-${item.view}-count`}>
                      {counts[item.view]} {counts[item.view] === 1 ? "item" : "items"}
                    </span>
                  ) : null}
                </Fragment>
              ))}
            </div>
          </details>
        ))}
      </nav>

    </aside>
  );
}

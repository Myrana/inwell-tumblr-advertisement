import { Plus, Save } from "lucide-react";

type WorkspaceTopbarProps = {
  actionsVisible?: boolean;
  eyebrow: string;
  saveStatus?: string;
  title: string;
  onCreateDraft: () => void;
  onSaveDraft: () => void;
};

export function WorkspaceTopbar({
  actionsVisible = true,
  eyebrow,
  saveStatus = "",
  title,
  onCreateDraft,
  onSaveDraft,
}: WorkspaceTopbarProps) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title || "Untitled saved submission"}</h1>
      </div>
      {actionsVisible ? (
        <div className="topbar-action-stack">
          <div className="topbar-actions">
            <button className="secondary" type="button" onClick={onCreateDraft}>
              <Plus size={18} />
              New
            </button>
            <button className="secondary" type="button" onClick={onSaveDraft}>
              <Save size={18} />
              Save
            </button>
          </div>
          {saveStatus ? (
            <div className="save-next-step compact" role="status">
              <span>{saveStatus}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

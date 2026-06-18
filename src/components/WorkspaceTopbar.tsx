import { Plus, Save, Sparkles } from "lucide-react";

type WorkspaceTopbarProps = {
  actionsVisible?: boolean;
  eyebrow: string;
  saveStatus?: string;
  title: string;
  onCreateDraft: () => void;
  onGeneratePost: () => void;
  onKeepEditing?: () => void;
  onSaveDraft: () => void;
};

export function WorkspaceTopbar({
  actionsVisible = true,
  eyebrow,
  saveStatus = "",
  title,
  onCreateDraft,
  onGeneratePost,
  onKeepEditing,
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
            <button className="primary" type="button" onClick={onGeneratePost}>
              <Sparkles size={18} />
              Prepare
            </button>
          </div>
          {saveStatus ? (
            <div className="save-next-step" role="status">
              <span>{saveStatus}</span>
              <button className="secondary" type="button" onClick={onCreateDraft}>
                Start new
              </button>
              <button className="secondary" type="button" onClick={onKeepEditing}>
                Keep editing
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

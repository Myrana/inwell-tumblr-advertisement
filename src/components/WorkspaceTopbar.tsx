import { Plus, Save, Sparkles } from "lucide-react";

type WorkspaceTopbarProps = {
  title: string;
  onCreateDraft: () => void;
  onGeneratePost: () => void;
  onSaveDraft: () => void;
};

export function WorkspaceTopbar({ title, onCreateDraft, onGeneratePost, onSaveDraft }: WorkspaceTopbarProps) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Advertisement workspace</p>
        <h1>{title || "Untitled saved submission"}</h1>
      </div>
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
    </header>
  );
}

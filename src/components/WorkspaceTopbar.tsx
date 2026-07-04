import { ArrowLeft, Moon, Palette, Plus, Save, Sun } from "lucide-react";
import { colorSkins } from "../domain/constants";
import { ColorSkin, ColorTheme } from "../domain/types";

type WorkspaceTopbarProps = {
  actionsVisible?: boolean;
  eyebrow: string;
  saveStatus?: string;
  skin: ColorSkin;
  theme: ColorTheme;
  title: string;
  onBackToOperations?: () => void;
  onCreateDraft: () => void;
  onSaveDraft: () => void;
  onSkinChange: (skin: ColorSkin) => void;
  onToggleTheme: () => void;
};

export function WorkspaceTopbar({
  actionsVisible = true,
  eyebrow,
  saveStatus = "",
  skin,
  theme,
  title,
  onBackToOperations,
  onCreateDraft,
  onSaveDraft,
  onSkinChange,
  onToggleTheme,
}: WorkspaceTopbarProps) {
  const darkMode = theme === "dark";

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title || "Untitled submission"}</h1>
      </div>
      <div className="topbar-action-stack">
        <div className="topbar-actions">
          {onBackToOperations ? (
            <button className="secondary" type="button" onClick={onBackToOperations}>
              <ArrowLeft size={18} />
              Back to Operations
            </button>
          ) : null}
          {actionsVisible ? (
            <>
              <button className="secondary" type="button" onClick={onCreateDraft}>
                <Plus size={18} />
                New
              </button>
              <button className="secondary" type="button" onClick={onSaveDraft}>
                <Save size={18} />
                Save
              </button>
            </>
          ) : null}
          <button
            className="secondary theme-toggle"
            type="button"
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            onClick={onToggleTheme}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
          <label className="skin-picker">
            <Palette size={18} />
            <span>Skin</span>
            <select
              aria-label="Workspace skin"
              value={skin}
              onChange={(event) => onSkinChange(event.target.value as ColorSkin)}
            >
              {colorSkins.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {saveStatus ? (
          <div className="save-next-step compact" role="status">
            <span>{saveStatus}</span>
          </div>
        ) : null}
      </div>
    </header>
  );
}

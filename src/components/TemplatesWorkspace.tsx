import { ClipboardCheck, FilePlus2, Save, Trash2 } from "lucide-react";
import { FormEvent } from "react";
import { formatDate } from "../domain/format";
import { SavedTemplate } from "../domain/types";

type TemplateDraft = {
  name: string;
  content: string;
};

type TemplatesWorkspaceProps = {
  draft: TemplateDraft;
  status: string;
  templates: SavedTemplate[];
  onApplyTemplate: (template: SavedTemplate) => void;
  onCreateTemplate: (event: FormEvent) => void;
  onDeleteTemplate: (id: string) => void;
  onDraftChange: (patch: Partial<TemplateDraft>) => void;
  onSaveCurrentAsTemplate: () => void;
};

export function TemplatesWorkspace({
  draft,
  status,
  templates,
  onApplyTemplate,
  onCreateTemplate,
  onDeleteTemplate,
  onDraftChange,
  onSaveCurrentAsTemplate,
}: TemplatesWorkspaceProps) {
  return (
    <section className="templates-workspace" aria-label="Saved templates">
      <div className="panel-heading">
        <h2>Saved templates</h2>
        <ClipboardCheck size={18} />
      </div>

      <div className="template-actions">
        <button className="primary" type="button" onClick={onSaveCurrentAsTemplate}>
          <Save size={18} />
          Save current submission as template
        </button>
        {status ? <p className="template-status">{status}</p> : null}
      </div>

      <form className="template-form" onSubmit={onCreateTemplate}>
        <label>
          Template name
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            placeholder="Premium supernatural ad"
          />
        </label>
        <label>
          Body text under the image
          <textarea
            value={draft.content}
            onChange={(event) => onDraftChange({ content: event.target.value })}
            placeholder="Paste the reusable advertisement text here."
          />
        </label>
        <button className="secondary" type="submit">
          <FilePlus2 size={18} />
          Save template
        </button>
      </form>

      <div className="template-list">
        {templates.length ? (
          templates.map((template) => (
            <article className="template-row" key={template.id}>
              <div>
                <strong>{template.name}</strong>
                <span>
                  Body text - {formatDate(template.updatedAt)}
                </span>
                <p>{template.content || "No reusable content saved yet."}</p>
              </div>
              <div className="template-row-actions">
                <button className="secondary" type="button" onClick={() => onApplyTemplate(template)}>
                  Apply
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Delete template"
                  title="Delete template"
                  onClick={() => onDeleteTemplate(template.id)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="queue-empty">Save a template, then apply it to any new submission.</p>
        )}
      </div>
    </section>
  );
}

import { Trash2 } from "lucide-react";
import { formatDate } from "../domain/format";
import { SavedTemplate } from "../domain/types";

type TemplateLibraryProps = {
  actionLabel?: string;
  emptyText: string;
  templates: SavedTemplate[];
  onApplyTemplate: (template: SavedTemplate) => void;
  onDeleteTemplate?: (id: string) => void;
};

export function TemplateLibrary({ actionLabel = "Click to apply", emptyText, templates, onApplyTemplate, onDeleteTemplate }: TemplateLibraryProps) {
  return (
    <div className="template-library" aria-label="Template library">
      {templates.length ? (
        templates.map((template) => (
          <article className="template-card" key={template.id}>
            <button className="template-card-main" type="button" onClick={() => onApplyTemplate(template)}>
              <strong>{template.name}</strong>
              <span>{actionLabel} - {formatDate(template.updatedAt)}</span>
              <div
                className="template-preview"
                dangerouslySetInnerHTML={{ __html: template.content || "<p>No reusable content saved yet.</p>" }}
              />
            </button>
            {onDeleteTemplate ? (
              <div className="template-card-actions">
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
            ) : null}
          </article>
        ))
      ) : (
        <p className="queue-empty">{emptyText}</p>
      )}
    </div>
  );
}

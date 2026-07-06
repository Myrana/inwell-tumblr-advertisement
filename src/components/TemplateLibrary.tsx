import { FileText, Pencil, Tags, Trash2 } from "lucide-react";
import { formatDate } from "../domain/format";
import { sanitizeHtml } from "../domain/htmlSanitizer";
import { SavedTemplate } from "../domain/types";
import { AD_PREVIEW_IMAGE_SRC } from "./sharedPreviewAssets";

type TemplateLibraryProps = {
  actionLabel?: string;
  emptyText: string;
  templates: SavedTemplate[];
  onApplyTemplate: (template: SavedTemplate) => void;
  onDeleteTemplate?: (id: string) => void;
  variant?: "compact" | "detailed";
};

export function TemplateLibrary({
  actionLabel = "Click to apply",
  emptyText,
  templates,
  onApplyTemplate,
  onDeleteTemplate,
  variant = "compact",
}: TemplateLibraryProps) {
  return (
    <div className={`template-library template-library-${variant}`} aria-label="Template library">
      {templates.length ? (
        templates.map((template) => (
          <article className="template-card" key={template.id}>
            {variant === "detailed" ? (
              <button className="template-card-main" type="button" onClick={() => onApplyTemplate(template)}>
                <span className="template-media-thumb" aria-hidden="true">
                  <img src={AD_PREVIEW_IMAGE_SRC} alt="" />
                </span>
                <span className="template-card-copy">
                  <span className="template-card-title-row">
                    <strong>{template.name}</strong>
                    <em>Ready to use</em>
                  </span>
                  <span className="template-card-meta">
                    <span>{formatDate(template.updatedAt)}</span>
                    {template.queueName ? <span>{template.queueName}</span> : null}
                  </span>
                  {template.tags?.length ? (
                    <span className="template-tag-row">
                      {template.tags.slice(0, 3).map((tag) => (
                        <b key={tag}>{tag}</b>
                      ))}
                      {template.tags.length > 3 ? <b>{template.tags.length - 3}+</b> : null}
                    </span>
                  ) : null}
                  <div
                    className="template-preview"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(template.content) || "<p>No reusable content saved yet.</p>" }}
                  />
                  <span className="template-stat-row">
                    <span><FileText size={15} />Reusable copy</span>
                    <span><Tags size={15} />{template.tags?.length ?? 0} tags</span>
                  </span>
                </span>
              </button>
            ) : (
              <button className="template-card-main" type="button" onClick={() => onApplyTemplate(template)}>
                <strong>{template.name}</strong>
                <span>{actionLabel} - {formatDate(template.updatedAt)}</span>
                {template.queueName ? <span>Default queue: {template.queueName}</span> : null}
                <div
                  className="template-preview"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(template.content) || "<p>No reusable content saved yet.</p>" }}
                />
              </button>
            )}
            {onDeleteTemplate ? (
              <div className="template-card-actions">
                <button className="secondary compact-button" type="button" onClick={() => onApplyTemplate(template)}>
                  <Pencil size={16} />
                  {actionLabel}
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
            ) : null}
          </article>
        ))
      ) : (
        <p className="queue-empty">{emptyText}</p>
      )}
    </div>
  );
}

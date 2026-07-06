import { EditorContent, useEditor } from "@tiptap/react";
import LinkExtension from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  BookOpenCheck,
  ClipboardCheck,
  FilePlus2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Save,
  Search,
  Sparkles,
  Strikethrough,
  Unlink,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SavedTemplate } from "../domain/types";
import { TemplateLibrary } from "./TemplateLibrary";
import "./templatesWorkspace.css";

type TemplateDraft = {
  name: string;
  content: string;
};

type TemplatesWorkspaceProps = {
  draft: TemplateDraft;
  editingTemplateId: string | null;
  status: string;
  templates: SavedTemplate[];
  onClearTemplateDraft: () => void;
  onDeleteTemplate: (id: string) => void;
  onEditTemplate: (template: SavedTemplate) => void;
  onDraftChange: (patch: Partial<TemplateDraft>) => void;
  onSaveTemplate: (event: FormEvent, contentHtml: string) => void;
  onSaveCurrentAsTemplate: () => void;
  canSaveCurrentAsTemplate: boolean;
};

export function TemplatesWorkspace({
  draft,
  editingTemplateId,
  status,
  templates,
  onClearTemplateDraft,
  onDeleteTemplate,
  onEditTemplate,
  onDraftChange,
  onSaveTemplate,
  onSaveCurrentAsTemplate,
  canSaveCurrentAsTemplate,
}: TemplatesWorkspaceProps) {
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateSort, setTemplateSort] = useState<"newest" | "oldest" | "name">("newest");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      }),
    ],
    content: draft.content,
    editorProps: {
      attributes: {
        class: "tumblr-rich-editor template-rich-editor",
        "aria-label": "Template body text under the image",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onDraftChange({ content: currentEditor.getHTML() });
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.getHTML() === draft.content) {
      return;
    }

    editor.commands.setContent(draft.content || "", { emitUpdate: false });
  }, [draft.content, editor]);

  const visibleTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    const filtered = query
      ? templates.filter((template) =>
          [template.name, template.content, template.queueName, template.forumUrl, ...(template.tags ?? [])]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(query)),
        )
      : templates;

    return [...filtered].sort((left, right) => {
      if (templateSort === "name") {
        return left.name.localeCompare(right.name);
      }
      const leftTime = new Date(left.updatedAt).getTime();
      const rightTime = new Date(right.updatedAt).getTime();
      return templateSort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [templateSearch, templateSort, templates]);

  return (
    <section className="templates-workspace" aria-label="Saved templates">
      <section className="template-save-callout" aria-label="Template quick save">
        <div className="template-save-action">
          <button className="primary" type="button" onClick={onSaveCurrentAsTemplate} disabled={!canSaveCurrentAsTemplate}>
            <Save size={20} />
            Save current submission as template
          </button>
          {!canSaveCurrentAsTemplate ? (
            <p className="template-status">Templates work best after the current ad has a title, copy, blog, or tags.</p>
          ) : null}
          {status ? <p className="template-status" role="status">{status}</p> : null}
        </div>
        <div className="template-save-copy">
          <BookOpenCheck size={24} />
          <div>
            <strong>Templates help you reuse your best content.</strong>
            <span>Save your current copy, tags, and media layout as a template to use again anytime.</span>
          </div>
        </div>
        <div className="template-callout-art" aria-hidden="true">
          <div />
          <Sparkles size={24} />
        </div>
      </section>

      <div className="template-workspace-grid">
        <form className="template-form" onSubmit={(event) => onSaveTemplate(event, editor?.getHTML() ?? draft.content)}>
          <div className="template-form-heading">
            <strong>{editingTemplateId ? "Edit template" : "Create new template"}</strong>
            {editingTemplateId ? (
              <button className="secondary compact-button" type="button" onClick={onClearTemplateDraft}>
                New template
              </button>
            ) : null}
          </div>
          <label>
            Template name
            <input
              value={draft.name}
              onChange={(event) => onDraftChange({ name: event.target.value })}
              placeholder="Premium supernatural ad"
            />
          </label>
          <div className="template-editor-field">
            <span>Body text under the image</span>
            <div className="template-composer">
              <div className="tumblr-editor-tools" aria-label="Template editor tools" onMouseDown={(event) => event.preventDefault()}>
                <button
                  className={editor?.isActive("bold") ? "active" : ""}
                  type="button"
                  title="Bold"
                  aria-label="Bold"
                  onClick={() => editor?.chain().focus().toggleBold().run()}
                  disabled={!editor}
                >
                  <Bold size={16} />
                </button>
                <button
                  className={editor?.isActive("italic") ? "active" : ""}
                  type="button"
                  title="Italic"
                  aria-label="Italic"
                  onClick={() => editor?.chain().focus().toggleItalic().run()}
                  disabled={!editor}
                >
                  <Italic size={16} />
                </button>
                <button
                  className={editor?.isActive("strike") ? "active" : ""}
                  type="button"
                  title="Strikethrough"
                  aria-label="Strikethrough"
                  onClick={() => editor?.chain().focus().toggleStrike().run()}
                  disabled={!editor}
                >
                  <Strikethrough size={16} />
                </button>
                <button
                  className={editor?.isActive("link") ? "active" : ""}
                  type="button"
                  title="Link"
                  aria-label="Link"
                  onClick={() => {
                    const href = window.prompt("Link URL", editor?.getAttributes("link").href ?? "https://");
                    if (!href) {
                      return;
                    }

                    editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
                  }}
                  disabled={!editor}
                >
                  <Link2 size={16} />
                </button>
                <button
                  type="button"
                  title="Unlink"
                  aria-label="Unlink"
                  onClick={() => editor?.chain().focus().unsetLink().run()}
                  disabled={!editor}
                >
                  <Unlink size={16} />
                </button>
                <button
                  className={editor?.isActive("orderedList") ? "active" : ""}
                  type="button"
                  title="Ordered list"
                  aria-label="Ordered list"
                  onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                  disabled={!editor}
                >
                  <ListOrdered size={16} />
                </button>
                <button
                  className={editor?.isActive("bulletList") ? "active" : ""}
                  type="button"
                  title="Bulleted list"
                  aria-label="Bulleted list"
                  onClick={() => editor?.chain().focus().toggleBulletList().run()}
                  disabled={!editor}
                >
                  <List size={16} />
                </button>
              </div>
              <div className="template-body-field">
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
          <button className="secondary" type="submit">
            <FilePlus2 size={18} />
            {editingTemplateId ? "Update template" : "Save template"}
          </button>
        </form>

        <div className="template-library-panel">
          <div className="template-library-header">
            <div>
              <strong>Your saved templates</strong>
              <span>{templates.length} template{templates.length === 1 ? "" : "s"}</span>
            </div>
            <label className="template-search-field">
              <Search size={18} />
              <input
                aria-label="Search templates"
                value={templateSearch}
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder="Search templates..."
              />
            </label>
            <label className="template-sort-field">
              Sort by
              <select
                aria-label="Sort templates"
                value={templateSort}
                onChange={(event) => setTemplateSort(event.target.value as "newest" | "oldest" | "name")}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          <TemplateLibrary
            actionLabel="Click to edit"
            emptyText="Save a template, then edit it here or apply it from a new submission."
            templates={visibleTemplates}
            onApplyTemplate={onEditTemplate}
            onDeleteTemplate={onDeleteTemplate}
            variant="detailed"
          />
        </div>
      </div>

      <p className="template-info-footer">
        <ClipboardCheck size={18} />
        Templates save your body text, tags, and media layout to help you create consistent, high-quality advertisements.
      </p>
    </section>
  );
}

import { EditorContent, useEditor } from "@tiptap/react";
import LinkExtension from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  ClipboardCheck,
  FilePlus2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Save,
  Strikethrough,
  Unlink,
} from "lucide-react";
import { FormEvent, useEffect } from "react";
import { SavedTemplate } from "../domain/types";
import { TemplateLibrary } from "./TemplateLibrary";

type TemplateDraft = {
  name: string;
  content: string;
};

type TemplatesWorkspaceProps = {
  draft: TemplateDraft;
  status: string;
  templates: SavedTemplate[];
  onApplyTemplate: (template: SavedTemplate) => void;
  onCreateTemplate: (event: FormEvent, contentHtml: string) => void;
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

      <div className="template-workspace-grid">
        <form className="template-form" onSubmit={(event) => onCreateTemplate(event, editor?.getHTML() ?? draft.content)}>
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
            Save template
          </button>
        </form>

        <div className="template-library-panel">
          <TemplateLibrary
            emptyText="Save a template, then apply it to any new submission."
            templates={templates}
            onApplyTemplate={onApplyTemplate}
            onDeleteTemplate={onDeleteTemplate}
          />
        </div>
      </div>
    </section>
  );
}

import { Editor, EditorContent } from "@tiptap/react";
import { ImagePlus, Plus, Send, Tags, Video } from "lucide-react";
import { ChangeEvent, FormEvent, ReactNode } from "react";
import { postTypes } from "../domain/constants";
import { Advertisement, PostType, TumblrSubmitTarget } from "../domain/types";

type ToolbarButton = {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
};

type EditorWorkspaceProps = {
  activeAd: Advertisement;
  activeSubmitTarget: TumblrSubmitTarget;
  checklistTags: string[];
  customTag: string;
  editor: Editor | null;
  newSubmitUrl: string;
  submissionComplete: boolean;
  submitTargetStatus: string;
  targetOptions: TumblrSubmitTarget[];
  toolbarButtons: ToolbarButton[];
  validation: string[];
  onAddCustomTag: (event: FormEvent) => void;
  onAddSubmitTarget: (event: FormEvent) => void;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onQueueTargets: (targets: TumblrSubmitTarget[]) => void;
  onSelectSubmitTarget: (targetId: string) => void;
  onToggleTag: (tag: string) => void;
  onUpdateActiveAd: (patch: Partial<Advertisement>) => void;
  onUpdateCustomTag: (value: string) => void;
  onUpdateForumUrl: (value: string) => void;
  onUpdateNewSubmitUrl: (value: string) => void;
  onVideoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function EditorWorkspace({
  activeAd,
  activeSubmitTarget,
  checklistTags,
  customTag,
  editor,
  newSubmitUrl,
  submissionComplete,
  submitTargetStatus,
  targetOptions,
  toolbarButtons,
  validation,
  onAddCustomTag,
  onAddSubmitTarget,
  onImageUpload,
  onQueueTargets,
  onSelectSubmitTarget,
  onToggleTag,
  onUpdateActiveAd,
  onUpdateCustomTag,
  onUpdateForumUrl,
  onUpdateNewSubmitUrl,
  onVideoUpload,
}: EditorWorkspaceProps) {
  return (
    <div className="workspace-grid editor-only">
      <section className="editor-surface" id="editor" aria-label="Advertisement editor">
        <div className="setup-panel">
          <div className="setup-panel-heading">
            <div>
              <h2>Submission details</h2>
              <p>Name the draft, choose a Tumblr blog, and keep that blog's forum link ready for queueing.</p>
            </div>
          </div>

          <div className="field-grid three editor-detail-grid">
            <label>
              Saved submission name
              <input
                value={activeAd.title}
                onChange={(event) => onUpdateActiveAd({ title: event.target.value })}
                placeholder="Open canons photo ad"
              />
              <span className="field-hint">Only used to find this saved submission again.</span>
            </label>

            <label>
              Target Tumblr blog
              <select value={activeAd.destinationBlog} onChange={(event) => onSelectSubmitTarget(event.target.value)}>
                <option value="">No blog selected</option>
                {targetOptions.length ? (
                  targetOptions.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))
                ) : null}
              </select>
              <span className="field-hint">{activeSubmitTarget.submitUrl || "Add or choose a Tumblr submit URL before queueing."}</span>
            </label>

            <label>
              Forum link
              <input
                value={activeAd.forumUrl}
                onChange={(event) => onUpdateForumUrl(event.target.value)}
                placeholder="https://your-forum.jcink.net"
              />
              <span className="field-hint">Saved with the selected Tumblr blog and included in the queue package.</span>
            </label>
          </div>

          <form className="submit-target-manager" onSubmit={onAddSubmitTarget}>
            <label>
              Add Tumblr submit URL
              <input
                value={newSubmitUrl}
                onChange={(event) => onUpdateNewSubmitUrl(event.target.value)}
                placeholder="https://allthingsroleplay.tumblr.com/submit"
              />
            </label>
            <button className="secondary" type="submit">
              <Plus size={18} />
              Add blog
            </button>
            {submitTargetStatus ? <p>{submitTargetStatus}</p> : null}
          </form>
        </div>

        {submissionComplete ? (
          <div className="tumblr-submit-shell">
            <div className="tumblr-thank-you" role="status">
              <h2>Thank you!</h2>
              <p>Your submission has been received and is awaiting moderator approval.</p>
            </div>
          </div>
        ) : (
          <div className="tumblr-submit-shell">
            <div className="tumblr-composer">
              <div className="tumblr-composer-header">
                <label>
                  <select
                    value={activeAd.postType}
                    onChange={(event) => onUpdateActiveAd({ postType: event.target.value as PostType })}
                  >
                    {postTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="tumblr-blog-id">
                  <span>{activeSubmitTarget.id ? activeSubmitTarget.name : "No blog selected"}</span>
                  <div className="tumblr-blog-avatar">I</div>
                </div>
              </div>

              {activeAd.postType === "text" ? (
                <input className="tumblr-title-input" placeholder="Title" aria-label="Optional Tumblr title" />
              ) : null}

              {activeAd.postType === "photo" ? (
                <div className="tumblr-photo-stage">
                  <ImagePlus size={42} />
                  <strong>{activeAd.imageName || "Choose a photo"}</strong>
                  <label className="tumblr-file-button">
                    Upload image
                    <input type="file" accept="image/*" onChange={onImageUpload} />
                  </label>
                </div>
              ) : null}

              {activeAd.postType === "video" ? (
                <div className="tumblr-photo-stage">
                  <Video size={42} />
                  <strong>{activeAd.videoName || "Choose a video"}</strong>
                  <input
                    value={activeAd.videoUrl}
                    onChange={(event) => onUpdateActiveAd({ videoUrl: event.target.value })}
                    placeholder="Video URL"
                  />
                  <label className="tumblr-file-button">
                    Upload video
                    <input type="file" accept="video/*" onChange={onVideoUpload} />
                  </label>
                </div>
              ) : null}

              <div className="tumblr-editor-tools" aria-label="Editor tools">
                {toolbarButtons.map((button) => (
                  <button
                    key={button.label}
                    className={button.active ? "active" : ""}
                    type="button"
                    title={button.label}
                    aria-label={button.label}
                    onClick={button.onClick}
                    disabled={!editor}
                  >
                    {button.icon}
                  </button>
                ))}
                <button type="button" title="Image" aria-label="Image" onClick={() => editor?.chain().focus().run()}>
                  <ImagePlus size={16} />
                </button>
                <button
                  type="button"
                  title="Queue current"
                  aria-label="Queue current"
                  onClick={() => onQueueTargets([activeSubmitTarget])}
                  disabled={!activeSubmitTarget.submitUrl}
                >
                  <Send size={16} />
                </button>
              </div>

              <section className="tumblr-body-field" aria-label="Tumblr post content">
                <EditorContent editor={editor} />
              </section>
            </div>

            <div className="tumblr-tag-panel">
              <div className="tag-toolbar">
                <div>
                  <Tags size={18} />
                  <strong>{activeSubmitTarget.id ? `Tags for ${activeSubmitTarget.name}:` : "Tags:"}</strong>
                </div>
                <form onSubmit={onAddCustomTag} className="custom-tag-form">
                  <input value={customTag} onChange={(event) => onUpdateCustomTag(event.target.value)} placeholder="custom tag" />
                  <button className="icon-button" type="submit" aria-label="Add custom tag" title="Add custom tag">
                    <Plus size={18} />
                  </button>
                </form>
              </div>

              {checklistTags.length ? (
                <div className="tumblr-tag-grid">
                  {checklistTags.map((tag) => (
                    <label className="tumblr-tag-check" key={tag}>
                      <input type="checkbox" checked={activeAd.tags.includes(tag)} onChange={() => onToggleTag(tag)} />
                      {tag}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="manual-tag-empty">Add tags manually with the custom tag box.</p>
              )}
            </div>

            <div className="tumblr-submit-footer">
              <button
                className="secondary"
                type="button"
                onClick={() => onQueueTargets([activeSubmitTarget])}
                disabled={!activeSubmitTarget.submitUrl}
              >
                <Send size={18} />
                Queue
              </button>
            </div>
          </div>
        )}

        {validation.length ? (
          <div className="validation" role="alert">
            {validation.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

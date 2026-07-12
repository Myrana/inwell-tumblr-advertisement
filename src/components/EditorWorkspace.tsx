import { Editor, EditorContent } from "@tiptap/react";
import { CheckCircle2, ChevronDown, Eye, ImagePlus, Plus, Send, Tags, Video } from "lucide-react";
import { ChangeEvent, FormEvent, ReactNode, useState } from "react";
import { postTypes } from "../domain/constants";
import { MediaLibraryAsset } from "../domain/mediaLibrary";
import { scoreDraftReadiness, validateAdvertisement } from "../domain/post";
import { Advertisement, PostType, QueueDefinition, SavedTemplate, TumblrSubmitTarget } from "../domain/types";
import { useQueuePreview } from "../hooks/useQueuePreview";
import { QueuePreviewPanel } from "./editor/QueuePreviewPanel";
import { LinkSummary, safeExternalUrl } from "./editor/LinkSummary";
import { TemplateLibrary } from "./TemplateLibrary";
import "./editor/editorWorkspace.css";

type ToolbarButton = {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
};

type WorkflowSectionKey = "details" | "templates" | "composer";

type QueueConfirmation = {
  count: number;
  queueName: string;
};

type EditorWorkspaceProps = {
  activeAd: Advertisement;
  activeSubmitTarget: TumblrSubmitTarget;
  checklistTags: string[];
  customTag: string;
  editor: Editor | null;
  mediaLibraryAssets: MediaLibraryAsset[];
  newSubmitUrl: string;
  queueOptions: QueueDefinition[];
  queueConfirmation: QueueConfirmation | null;
  selectedQueueName: string;
  submissionComplete: boolean;
  submitTargetStatus: string;
  targetOptions: TumblrSubmitTarget[];
  templates: SavedTemplate[];
  toolbarButtons: ToolbarButton[];
  validation: string[];
  saveStatus: string;
  onAddCustomTag: (event: FormEvent) => void;
  onAddSubmitTarget: (event: FormEvent) => void;
  onApplyMediaAsset: (asset: MediaLibraryAsset) => void;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onApplyTemplate: (template: SavedTemplate) => void;
  onQueueTargets: (targets: TumblrSubmitTarget[]) => void;
  onDismissQueueConfirmation: () => void;
  onSelectQueue: (queueName: string) => void;
  onSelectSubmitTarget: (targetId: string) => void;
  onToggleTag: (tag: string) => void;
  onUpdateActiveAd: (patch: Partial<Advertisement>) => void;
  onUpdateCustomTag: (value: string) => void;
  onUpdateForumUrl: (value: string) => void;
  onUpdateNewSubmitUrl: (value: string) => void;
  onViewQueue: () => void;
  onVideoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function EditorWorkspace({
  activeAd,
  activeSubmitTarget,
  checklistTags,
  customTag,
  editor,
  mediaLibraryAssets,
  newSubmitUrl,
  queueConfirmation,
  queueOptions,
  selectedQueueName,
  submissionComplete,
  submitTargetStatus,
  targetOptions,
  templates,
  toolbarButtons,
  validation,
  saveStatus,
  onAddCustomTag,
  onAddSubmitTarget,
  onApplyMediaAsset,
  onApplyTemplate,
  onImageUpload,
  onQueueTargets,
  onDismissQueueConfirmation,
  onSelectQueue,
  onSelectSubmitTarget,
  onToggleTag,
  onUpdateActiveAd,
  onUpdateCustomTag,
  onUpdateForumUrl,
  onUpdateNewSubmitUrl,
  onViewQueue,
  onVideoUpload,
}: EditorWorkspaceProps) {
  const [openSections, setOpenSections] = useState<Record<WorkflowSectionKey, boolean>>({
    details: false,
    templates: false,
    composer: true,
  });
  const [tagSearch, setTagSearch] = useState("");
  const queueBlockers = validateAdvertisement(activeAd);
  const readiness = scoreDraftReadiness(activeAd);
  const detailsReady = Boolean(activeAd.title.trim() && activeAd.destinationBlog.trim() && activeAd.forumUrl.trim());
  const mediaReady =
    activeAd.postType === "text"
      ? true
      : activeAd.postType === "photo"
        ? Boolean(activeAd.imageDataUrl.trim() || activeAd.imageName.trim())
        : Boolean(activeAd.videoUrl.trim() || activeAd.videoName.trim());
  const contentReady = !queueBlockers.some((item) => item === "Add post content.");
  const tagsReady = activeAd.tags.length > 0;
  const queueReady = queueBlockers.length === 0;
  const qualityChecks = readiness.items;
  const selectedTargetSummary = activeSubmitTarget.id
    ? `${activeSubmitTarget.name} - ${activeSubmitTarget.submitUrl}`
    : "No blog selected";
  const readinessPercent = Math.round(readiness.percent);
  const { clearPreview, openPreview, previewTargets } = useQueuePreview();
  const previewableTargets = targetOptions.filter((target) => target.id && target.submitUrl);
  const safeImageDestination = activeAd.postType === "photo" ? safeExternalUrl(activeAd.imageClickThroughUrl) : "";
  const visibleChecklistTags = checklistTags
    .filter((tag) => tag.toLowerCase().includes(tagSearch.trim().toLowerCase()))
    .sort((first, second) => Number(activeAd.tags.includes(second)) - Number(activeAd.tags.includes(first)) || first.localeCompare(second));

  function setSectionOpen(section: WorkflowSectionKey, open: boolean) {
    setOpenSections((current) => ({ ...current, [section]: open }));
  }

  function statusLabel(ready: boolean, optional = false) {
    if (ready) return "Ready";
    return optional ? "Optional" : "Needs info";
  }

  function confirmQueuePreview() {
    if (!previewTargets.length) {
      return;
    }
    onQueueTargets(previewTargets);
    clearPreview();
  }

  function sectionForQualityCheck(label: string): WorkflowSectionKey {
    if (label === "Submission name" || label === "Target blog" || label === "Forum link") {
      return "details";
    }
    return "composer";
  }

  return (
    <div className="workspace-grid editor-only">
      <section className="editor-surface" id="editor" aria-label="Advertisement editor">
        <div className="editor-sticky-toolbar" aria-label="Editor command toolbar">
          <div className="editor-sticky-title">
            <span>{saveStatus || "Autosaves as you write"}</span>
            <strong>{activeAd.title || "Untitled advertisement"}</strong>
          </div>
          <div className="editor-sticky-progress" aria-label="Editor completion">
            <span>{readinessPercent}% complete</span>
            <div className="editor-progress-track" aria-hidden="true">
              <i style={{ width: `${readinessPercent}%` }} />
            </div>
          </div>
          <div className="editor-sticky-actions">
            <button className="secondary compact-button" type="button" onClick={() => openPreview([activeSubmitTarget])} disabled={!queueReady}>
              <Eye size={16} />
              Preview
            </button>
            <button className="primary compact-button" type="button" onClick={() => openPreview([activeSubmitTarget])} disabled={!queueReady}>
              <Send size={16} />
              Queue
            </button>
          </div>
        </div>

        <div className="editor-notebook-intro">
          <div>
            <span>Advertisement notebook</span>
            <strong className="editor-notebook-title">{activeAd.title || "Untitled advertisement"}</strong>
            <p>Write once, save the blog rules, attach the visual, and send the finished ad into the queue.</p>
          </div>
          <div className="editor-save-pill" aria-label="Autosave status">
            {saveStatus || "Autosaves as you write"}
          </div>
        </div>

        <div className={queueReady ? "queue-readiness ready" : "queue-readiness"} aria-label="Queue readiness">
          <div>
            <strong>{queueReady ? "Ready to add to queue" : "Queue setup needs attention"}</strong>
            <span>
              {selectedTargetSummary}
              {activeAd.postType ? ` - ${activeAd.postType} post` : ""}
            </span>
          </div>
          <div className="queue-readiness-actions">
            {queueOptions.length ? (
              <label className="queue-destination-select">
                Queue destination
                <select value={selectedQueueName} onChange={(event) => onSelectQueue(event.target.value)}>
                  {queueOptions.map((queue) => (
                    <option key={queue.id} value={queue.name}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              className="primary"
              type="button"
              onClick={() => openPreview([activeSubmitTarget])}
              disabled={!queueReady}
            >
              <Send size={18} />
              Preview queue
            </button>
            {previewableTargets.length > 1 ? (
              <button
                className="secondary"
                type="button"
                onClick={() => openPreview(previewableTargets)}
                disabled={!queueReady}
              >
                Preview all blogs
              </button>
            ) : null}
          </div>
        </div>

        <QueuePreviewPanel
          advertisement={activeAd}
          queueName={selectedQueueName}
          targets={previewTargets}
          onCancel={clearPreview}
          onConfirm={confirmQueuePreview}
        />

        {queueConfirmation ? (
          <div className="queue-confirmation" role="status" aria-label="Queue confirmation">
            <div>
              <strong>Added to {queueConfirmation.queueName}</strong>
              <span>
                {queueConfirmation.count} submission{queueConfirmation.count === 1 ? "" : "s"} ready in the queue.
              </span>
            </div>
            <div className="queue-confirmation-actions">
              <button className="primary" type="button" onClick={onViewQueue}>
                <Eye size={18} />
                View queue
              </button>
              <button className="secondary" type="button" onClick={onDismissQueueConfirmation}>
                Keep editing
              </button>
            </div>
          </div>
        ) : null}

        <section className="workflow-section">
          <div className="workflow-section-header">
            <button type="button" aria-label="Toggle submission details section" onClick={() => setSectionOpen("details", !openSections.details)}>
              <ChevronDown size={18} className={openSections.details ? "open" : ""} />
              <span>
                <strong>Submission details</strong>
                <small>{selectedTargetSummary}</small>
              </span>
            </button>
            <div className="workflow-section-actions">
              <span className={detailsReady ? "section-state ready" : "section-state"}>{statusLabel(detailsReady)}</span>
              <button className="secondary" type="button" disabled={!detailsReady} onClick={() => setSectionOpen("details", false)}>
                <CheckCircle2 size={16} />
                Mark done
              </button>
            </div>
          </div>

          {openSections.details ? (
            <div className="workflow-section-body">
              <div className="field-grid three editor-detail-grid">
                <label>
                  Submission name
                  <input
                    value={activeAd.title}
                    onChange={(event) => onUpdateActiveAd({ title: event.target.value })}
                    placeholder="Open canons photo ad"
                  />
                  <span className="field-hint">Example: Open canon photo ad.</span>
                </label>

                <label>
                  Campaign
                  <input
                    value={activeAd.campaignName}
                    onChange={(event) => onUpdateActiveAd({ campaignName: event.target.value })}
                    placeholder="Summer wanted ads"
                  />
                  <span className="field-hint">Example: Summer wanted ads.</span>
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
                  <span className="field-hint">{activeSubmitTarget.submitUrl || "Example: a Tumblr submit page that accepts roleplay ads."}</span>
                </label>

                <label>
                  Forum link
                  <input
                    value={activeAd.forumUrl}
                    onChange={(event) => onUpdateForumUrl(event.target.value)}
                    placeholder="https://your-forum.jcink.net"
                  />
                  <span className="field-hint">Example: the forum or wanted page readers should open.</span>
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
                  <span className="field-hint">Paste a blog submit URL once, then reuse it from Blog tracker.</span>
                </label>
                <button className="secondary" type="submit">
                  <Plus size={18} />
                  Add blog
                </button>
                {submitTargetStatus ? <p>{submitTargetStatus}</p> : null}
              </form>
            </div>
          ) : null}
        </section>

        <section className="quality-checklist" aria-label="Content quality checklist">
          <div>
            <strong>Quality checklist</strong>
            <span>
              {readiness.readyCount} of {readiness.totalCount} ready - {readiness.label}
            </span>
          </div>
          <div className="quality-checklist-grid">
            {qualityChecks.map((check) => (
              <button
                key={check.label}
                className={check.ready ? "quality-check ready" : "quality-check"}
                type="button"
                onClick={() => setSectionOpen(sectionForQualityCheck(check.label), true)}
              >
                {check.label}
              </button>
            ))}
          </div>
        </section>

        <section className="workflow-section" aria-label="Editor saved templates">
          <div className="workflow-section-header">
            <button type="button" aria-label="Toggle reusable copy section" onClick={() => setSectionOpen("templates", !openSections.templates)}>
              <ChevronDown size={18} className={openSections.templates ? "open" : ""} />
              <span>
                <strong>Saved templates</strong>
                <small>{templates.length ? `${templates.length} available` : "No saved templates yet"}</small>
              </span>
            </button>
            <span className="section-state optional">{statusLabel(false, true)}</span>
          </div>
          {openSections.templates ? (
            <div className="workflow-section-body">
              <TemplateLibrary
                emptyText="Save a template, then it will appear here for quick reuse."
                templates={templates}
                onApplyTemplate={onApplyTemplate}
              />
            </div>
          ) : null}
        </section>

        <section className="workflow-section composer-workflow-section">
          <div className="workflow-section-header">
            <button type="button" aria-label="Toggle post content section" onClick={() => setSectionOpen("composer", !openSections.composer)}>
              <ChevronDown size={18} className={openSections.composer ? "open" : ""} />
              <span>
                <strong>Post content</strong>
                <small>
                  {mediaReady ? `${activeAd.postType} media ready` : `${activeAd.postType} media needs info`} - {tagsReady ? `${activeAd.tags.length} tags` : "tags optional"}
                </small>
              </span>
            </button>
            <div className="workflow-section-actions">
              <span className={contentReady && mediaReady ? "section-state ready" : "section-state"}>{statusLabel(contentReady && mediaReady)}</span>
              <button className="secondary" type="button" disabled={!(contentReady && mediaReady)} onClick={() => setSectionOpen("composer", false)}>
                <CheckCircle2 size={16} />
                Mark done
              </button>
            </div>
          </div>

          {openSections.composer ? (
            <div className="workflow-section-body composer-section-body">
              {submissionComplete ? (
                <div className="tumblr-submit-shell preview-desktop">
                  <div className="tumblr-thank-you" role="status">
                    <h2>Thank you!</h2>
                    <p>Your submission has been received and is awaiting moderator approval.</p>
                  </div>
                </div>
              ) : (
                <div className="tumblr-submit-shell preview-desktop">
                  <div className="tumblr-composer">
                    <div className="preview-mode-switcher" role="group" aria-label="Preview mode">
                      <span className="active">Desktop</span>
                    </div>
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
                        {activeAd.imageDataUrl ? (
                          safeImageDestination ? (
                            <a href={safeImageDestination} target="_blank" rel="noreferrer" aria-label="Open image click-through destination">
                              <img className="tumblr-media-preview-image" src={activeAd.imageDataUrl} alt="" />
                            </a>
                          ) : (
                            <img className="tumblr-media-preview-image" src={activeAd.imageDataUrl} alt="" />
                          )
                        ) : (
                          <ImagePlus size={42} />
                        )}
                        <strong>{activeAd.imageName || "Choose a photo"}</strong>
                        <span>Drop in the graphic readers will see on Tumblr.</span>
                        <label className="tumblr-file-button">
                          Upload image
                          <input type="file" accept="image/*" onChange={onImageUpload} />
                        </label>
                        <div className="image-click-through-field">
                          <label htmlFor="image-click-through-url">Image click-through URL</label>
                          <input
                            id="image-click-through-url"
                            type="url"
                            value={activeAd.imageClickThroughUrl}
                            onChange={(event) => onUpdateActiveAd({ imageClickThroughUrl: event.target.value })}
                            placeholder="https://your-forum.com/thread/123"
                          />
                          <span className="field-hint">Optional. Readers open this page when they click the Tumblr image.</span>
                          <button
                            className="secondary compact-button"
                            type="button"
                            onClick={() => onUpdateActiveAd({ imageClickThroughUrl: activeAd.forumUrl })}
                            disabled={!activeAd.forumUrl.trim()}
                          >
                            Use forum link
                          </button>
                        </div>
                        </div>
                      ) : null}

                    <LinkSummary
                      submitUrl={activeSubmitTarget.submitUrl}
                      forumUrl={activeAd.forumUrl}
                      imageClickThroughUrl={activeAd.postType === "photo" ? activeAd.imageClickThroughUrl : ""}
                    />

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

                    {mediaLibraryAssets.length ? (
                      <section className="media-library-panel" aria-label="Reusable media library">
                        <div className="media-library-heading">
                          <strong>Reusable media</strong>
                          <span>{mediaLibraryAssets.length} saved asset{mediaLibraryAssets.length === 1 ? "" : "s"}</span>
                        </div>
                        <div className="media-library-grid">
                          {mediaLibraryAssets.map((asset) => (
                            <button
                              key={asset.id}
                              className="media-library-asset"
                              type="button"
                              aria-label={`Use ${asset.name}`}
                              onClick={() => onApplyMediaAsset(asset)}
                            >
                              {asset.kind === "photo" && asset.imageDataUrl ? (
                                <img src={asset.imageDataUrl} alt="" />
                              ) : (
                                <span className="media-library-icon">{asset.kind === "photo" ? <ImagePlus size={20} /> : <Video size={20} />}</span>
                              )}
                              <span>
                                <strong>{asset.name}</strong>
                                <small>{asset.sourceTitle}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      </section>
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
                      <>
                        <label className="tag-search-field">
                          Search tags
                          <input value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="Filter available tags" />
                        </label>
                        <div className="tumblr-tag-grid">
                        {visibleChecklistTags.map((tag) => (
                          <label className={activeAd.tags.includes(tag) ? "tumblr-tag-check selected" : "tumblr-tag-check"} key={tag}>
                            <input type="checkbox" checked={activeAd.tags.includes(tag)} onChange={() => onToggleTag(tag)} />
                            {tag}
                          </label>
                        ))}
                        </div>
                        {!visibleChecklistTags.length ? <p className="manual-tag-empty">No saved tags match that search.</p> : null}
                      </>
                    ) : (
                      <p className="manual-tag-empty">Add tags manually with the custom tag box.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>

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

import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Strikethrough,
  Unlink,
} from "lucide-react";
import { useEditor } from "@tiptap/react";
import LinkExtension from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { QueueWorkspace } from "./components/QueueWorkspace";
import { SavedSubmissionsView } from "./components/SavedSubmissionsView";
import { TemplatesWorkspace } from "./components/TemplatesWorkspace";
import { WorkspaceTopbar } from "./components/WorkspaceTopbar";

import { apiRequest, loadBackendTemplates, removeAdvertisement, removeTemplate, saveAdvertisement, saveTemplate } from "./domain/api";
import { composerContentFor, emptyAd, fromApiAdvertisement, normalizeStoredState } from "./domain/ads";
import { defaultTagProfiles, postTypes } from "./domain/constants";
import { buildPreparedPost, validateAdvertisement } from "./domain/post";
import { createQueueItem as createSubmissionQueueItem } from "./domain/queue";
import {
  loadRunnerSettings,
  loadStoredState,
  loadSubmissionQueue,
  loadSubmitTargets,
  loadTagProfiles,
  loadTemplates,
  saveRunnerSettings,
  saveStoredState,
  saveSubmissionQueue,
  saveSubmitTargets,
  saveTagProfiles,
  saveTemplates,
} from "./domain/storage";
import { fallbackTarget, submitTargetFromUrl, uniqueSubmitTargets } from "./domain/submitTargets";
import { normalizeTag, parseImportedTags, uniqueTags } from "./domain/tags";
import { applyTemplateToAdvertisement, normalizeTemplate, templateFromAdvertisement } from "./domain/templates";
import {
  Advertisement,
  ApiAdvertisement,
  OcrResult,
  RunnerSettings,
  RunnerStatus,
  SavedTemplate,
  SubmissionQueueItem,
  SubmissionStatus,
  StoredState,
  TumblrSubmitTarget,
  WorkspaceView,
} from "./domain/types";
function App() {
  const [stored, setStored] = useState<StoredState>(() => loadStoredState());
  const [submitTargets, setSubmitTargets] = useState<TumblrSubmitTarget[]>(() => loadSubmitTargets());
  const [submissionQueue, setSubmissionQueue] = useState<SubmissionQueueItem[]>(() => loadSubmissionQueue());
  const [tagProfiles, setTagProfiles] = useState<Record<string, string[]>>(() => loadTagProfiles());
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => loadTemplates());
  const [apiAvailable, setApiAvailable] = useState(false);
  const [customTag, setCustomTag] = useState("");
  const [templateDraft, setTemplateDraft] = useState({ name: "", content: "", forumUrl: "", tagsText: "" });
  const [templateStatus, setTemplateStatus] = useState("");
  const [newSubmitUrl, setNewSubmitUrl] = useState("");
  const [submitTargetStatus, setSubmitTargetStatus] = useState("");
  const [importText, setImportText] = useState("");
  const [importImageName, setImportImageName] = useState("");
  const [importImageDataUrl, setImportImageDataUrl] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [, setGeneratedPost] = useState("");
  const [queueStatus, setQueueStatus] = useState("");
  const [runnerSettings, setRunnerSettings] = useState<RunnerSettings>(() => loadRunnerSettings());
  const [runnerState, setRunnerState] = useState<RunnerStatus | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("editor");

  const activeAd = useMemo(() => {
    const normalized = normalizeStoredState(stored);
    return normalized.ads.find((ad) => ad.id === normalized.activeAdId) ?? normalized.ads[0];
  }, [stored]);
  const activeSubmitTarget = useMemo(
    () => submitTargets.find((target) => target.id === activeAd.destinationBlog) ?? fallbackTarget(activeAd.destinationBlog),
    [activeAd.destinationBlog, submitTargets],
  );
  const targetOptions = useMemo(
    () => uniqueSubmitTargets([...submitTargets, activeSubmitTarget]),
    [activeSubmitTarget, submitTargets],
  );

  const selectedTagCount = activeAd.tags.length;
  const activeQueue = submissionQueue.filter((item) => item.adId === activeAd.id);
  const activeBlogTags = tagProfiles[activeAd.destinationBlog] ?? defaultTagProfiles[activeAd.destinationBlog] ?? [];
  const checklistTags = uniqueTags([...activeBlogTags, ...activeAd.tags]);
  const parsedImportTags = parseImportedTags(importText);
  const editor = useEditor(
    {
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
      content: composerContentFor(activeAd),
      editorProps: {
        attributes: {
          class: "tumblr-rich-editor",
          "aria-label": "Tumblr post content",
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        updateActiveAd({ content: currentEditor.getHTML(), imageCaption: "" });
      },
    },
    [activeAd.id],
  );

  useEffect(() => {
    saveStoredState(stored);
  }, [stored]);

  useEffect(() => {
    saveSubmitTargets(submitTargets);
  }, [submitTargets]);

  useEffect(() => {
    saveSubmissionQueue(submissionQueue);
  }, [submissionQueue]);

  useEffect(() => {
    saveTagProfiles(tagProfiles);
  }, [tagProfiles]);

  useEffect(() => {
    saveTemplates(templates);
  }, [templates]);

  useEffect(() => {
    saveRunnerSettings(runnerSettings);
  }, [runnerSettings]);

  useEffect(() => {
    const nextContent = composerContentFor(activeAd);

    if (!editor || editor.isDestroyed) {
      return;
    }

    try {
      if (editor.getHTML() === nextContent) {
        return;
      }

      editor.commands.setContent(nextContent, { emitUpdate: false });
    } catch {
      // TipTap can briefly expose an editor whose schema is already being
      // replaced while switching drafts. The next editor instance will sync.
    }
  }, [activeAd.id, activeAd.content, activeAd.imageCaption, editor]);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendState() {
      try {
        const [advertisementResponse, backendTemplates] = await Promise.all([
          apiRequest<{ advertisements: ApiAdvertisement[] }>("/advertisements"),
          loadBackendTemplates(),
        ]);

        if (cancelled) {
          return;
        }

        const backendAds = advertisementResponse.advertisements.map(fromApiAdvertisement);
        const nextStored = normalizeStoredState({
          ads: backendAds.length ? backendAds : stored.ads,
          activeAdId: stored.activeAdId,
        });

        setStored(nextStored);
        setTemplates(backendTemplates);
        setApiAvailable(true);
      } catch {
        if (!cancelled) {
          setApiAvailable(false);
        }
      }
    }

    void loadBackendState();

    return () => {
      cancelled = true;
    };
  }, []);

  function syncAdvertisement(advertisement: Advertisement) {
    void saveAdvertisement(advertisement)
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
  }

  function syncTemplate(template: SavedTemplate) {
    void saveTemplate(template)
      .then((saved) => {
        setTemplates((current) => current.map((item) => (item.id === saved.id ? saved : item)));
        setApiAvailable(true);
      })
      .catch(() => setApiAvailable(false));
  }

  function updateActiveAd(patch: Partial<Advertisement>) {
    let nextActiveAd: Advertisement | null = null;

    setStored((current) => {
      const normalized = normalizeStoredState(current);
      const ads = normalized.ads.map((ad) =>
        ad.id === normalized.activeAdId
          ? (nextActiveAd = { ...ad, ...patch, updatedAt: new Date().toISOString() })
          : ad,
      );
      return { ...normalized, ads };
    });

    if (nextActiveAd) {
      syncAdvertisement(nextActiveAd);
    }
  }

  function saveCurrentAsTemplate() {
    const template = templateFromAdvertisement(activeAd);
    setTemplates((current) => [template, ...current]);
    syncTemplate(template);
    setTemplateStatus(`Saved ${template.name} as a reusable template.`);
  }

  function createTemplate(event: FormEvent) {
    event.preventDefault();
    const template = normalizeTemplate({
      name: templateDraft.name,
      content: templateDraft.content,
      forumUrl: templateDraft.forumUrl,
      tags: parseImportedTags(templateDraft.tagsText),
    });

    setTemplates((current) => [template, ...current]);
    syncTemplate(template);
    setTemplateDraft({ name: "", content: "", forumUrl: "", tagsText: "" });
    setTemplateStatus(`Saved ${template.name}.`);
  }

  function applyTemplate(template: SavedTemplate) {
    updateActiveAd(applyTemplateToAdvertisement(activeAd, template));
    setTemplateStatus(`Applied ${template.name} to the current submission.`);
    setActiveView("editor");
  }

  function deleteTemplate(id: string) {
    setTemplates((current) => current.filter((template) => template.id !== id));
    void removeTemplate(id)
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
    setTemplateStatus("Deleted template.");
  }

  function selectSubmitTarget(targetId: string) {
    const target = targetOptions.find((item) => item.id === targetId) ?? fallbackTarget(targetId);
    setSubmitTargetStatus(`Selected ${target.name}. Tumblr submit page: ${target.submitUrl}`);
    updateActiveAd({ destinationBlog: target.id });
  }

  function addSubmitTarget(event: FormEvent) {
    event.preventDefault();
    const target = submitTargetFromUrl(newSubmitUrl);

    if (!target) {
      setSubmitTargetStatus("Enter a Tumblr submit URL, like https://allthingsroleplay.tumblr.com/submit.");
      return;
    }

    setSubmitTargets((current) => uniqueSubmitTargets([...current, target]));
    setTagProfiles((current) => ({
      ...current,
      [target.id]: current[target.id] ?? [],
    }));
    updateActiveAd({ destinationBlog: target.id });
    setNewSubmitUrl("");
    setSubmitTargetStatus(`Added ${target.name}. Open ${target.submitUrl} when you are ready to paste the post into Tumblr.`);
  }

  function toggleTag(tag: string) {
    const exists = activeAd.tags.includes(tag);
    updateActiveAd({
      tags: exists ? activeAd.tags.filter((item) => item !== tag) : [...activeAd.tags, tag],
    });
  }

  function addCustomTag(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeTag(customTag);

    if (!normalized || activeAd.tags.includes(normalized)) {
      setCustomTag("");
      return;
    }

    updateActiveAd({ tags: [...activeAd.tags, normalized] });
    setTagProfiles((current) => ({
      ...current,
      [activeAd.destinationBlog]: uniqueTags([...(current[activeAd.destinationBlog] ?? []), normalized]),
    }));
    setCustomTag("");
  }

  function createDraft() {
    const targetId = activeAd.destinationBlog || activeSubmitTarget.id;
    const next = emptyAd(targetId);
    setValidation([]);
    setGeneratedPost("");
    setTermsAccepted(false);
    setStored((current) => ({
      ads: [next, ...current.ads],
      activeAdId: next.id,
    }));
    syncAdvertisement(next);
  }

  function deleteDraft(id: string) {
    setStored((current) => {
      const remaining = current.ads.filter((ad) => ad.id !== id);
      if (!remaining.length) {
        const next = emptyAd();
        return { ads: [next], activeAdId: next.id };
      }

      return {
        ads: remaining,
        activeAdId: current.activeAdId === id ? remaining[0].id : current.activeAdId,
      };
    });
    void removeAdvertisement(id)
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
  }

  function saveDraft() {
    updateActiveAd({ status: "draft" });
    setValidation([]);
    setTermsAccepted(false);
  }

  function validateAd() {
    const missing = validateAdvertisement(activeAd);
    setValidation(missing);
    return missing;
  }

  function buildPost() {
    return buildPreparedPost(activeAd);
  }

  function generatePost() {
    const missing = validateAd();
    if (missing.length) {
      return;
    }

    const finalPost = buildPost();

    setGeneratedPost(finalPost);
    updateActiveAd({ status: "ready" });
  }

  function submitRecord() {
    const missing = validateAd();
    if (!termsAccepted) {
      missing.push("Accept the Terms of Submission.");
    }

    if (missing.length) {
      setValidation(missing);
      return;
    }

    setGeneratedPost(buildPost());
    updateActiveAd({ status: "submitted" });
  }

  function openSubmitPage() {
    const missing = validateAd();
    if (missing.length) {
      return;
    }

    setGeneratedPost(buildPost());
    window.open(activeSubmitTarget.submitUrl, "_blank", "noopener,noreferrer");
    setSubmitTargetStatus(
      `Opened ${activeSubmitTarget.name}. Choose ${activeAd.postType} on Tumblr, then paste the prepared submission package.`,
    );
  }

  function createQueueItem(target: TumblrSubmitTarget): SubmissionQueueItem {
    return createSubmissionQueueItem(activeAd, target, buildPost());
  }

  function queueTargets(targets: TumblrSubmitTarget[]) {
    const missing = validateAd();
    if (missing.length) {
      return;
    }

    const nextItems = targets.map((target) => createQueueItem(target));
    setGeneratedPost(buildPost());
    setSubmissionQueue((current) => {
      const withoutExisting = current.filter(
        (item) => item.adId !== activeAd.id || !nextItems.some((next) => next.targetId === item.targetId),
      );
      return [...nextItems, ...withoutExisting];
    });
    setQueueStatus(`Queued ${nextItems.length} target${nextItems.length === 1 ? "" : "s"} for the local runner.`);
  }

  function updateQueueItem(id: string, status: SubmissionStatus, notes: string) {
    setSubmissionQueue((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              notes,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  }

  function clearCompletedQueueItems() {
    setSubmissionQueue((current) =>
      current.filter((item) => item.adId !== activeAd.id || !["submitted", "failed"].includes(item.status)),
    );
    setQueueStatus("Cleared submitted and failed entries for this saved submission.");
  }

  function buildRunnerPlan() {
    return {
      version: 1,
      workflow: "tumblr-submission-queue",
      generatedAt: new Date().toISOString(),
      items: activeQueue,
    };
  }

  function copyRunnerPlan() {
    const plan = JSON.stringify(buildRunnerPlan(), null, 2);
    navigator.clipboard.writeText(plan);
    const blob = new Blob([plan], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tumblr-runner-plan.json";
    link.click();
    URL.revokeObjectURL(url);
    setQueueStatus(
      `Downloaded and copied runner plan for ${activeQueue.length} queued target${activeQueue.length === 1 ? "" : "s"}.`,
    );
  }

  async function refreshRunnerStatus() {
    try {
      const response = await apiRequest<{ runner: RunnerStatus }>("/runner/status");
      setRunnerState(response.runner);
      setApiAvailable(true);
      setQueueStatus(response.runner.running ? `Runner is open in process ${response.runner.pid}.` : "Runner is not running.");
    } catch {
      setApiAvailable(false);
      setQueueStatus("Start the Python API before launching the runner from the app.");
    }
  }

  async function startRunner() {
    if (!activeQueue.length) {
      setQueueStatus("Queue at least one target before starting the runner.");
      return;
    }

    try {
      const response = await apiRequest<{ runner: RunnerStatus }>("/runner/start", {
        method: "POST",
        body: JSON.stringify({
          ...runnerSettings,
          items: activeQueue,
        }),
      });
      setRunnerState(response.runner);
      setApiAvailable(true);
      setQueueStatus(`Runner launched in a visible PowerShell window. Plan: ${response.runner.plan_path}`);
    } catch {
      setApiAvailable(false);
      setQueueStatus("Could not launch runner. Start the Python API and make sure no runner is already open.");
    }
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateActiveAd({
        imageName: file.name,
        imageDataUrl: String(reader.result),
      });
    };
    reader.readAsDataURL(file);
  }

  function handleVideoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    updateActiveAd({ videoName: file.name });
  }

  function handleTagScreenshotUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      setImportImageName(file.name);
      setImportImageDataUrl(dataUrl);
      setImportStatus("Screenshot loaded. Running local OCR.");

      try {
        const response = await apiRequest<{ ocr: OcrResult }>("/tags/ocr", {
          method: "POST",
          body: JSON.stringify({ imageDataUrl: dataUrl }),
        });

        if (response.ocr.tags.length) {
          setImportText(response.ocr.tags.join("\n"));
          setImportStatus(`${response.ocr.tags.length} tags detected from screenshot. Review before importing.`);
          setApiAvailable(true);
          return;
        }

        if (response.ocr.text.trim()) {
          setImportText(response.ocr.text);
        }
        setImportStatus(response.ocr.message || "OCR did not find tags. Paste the tags manually.");
        setApiAvailable(true);
        return;
      } catch {
        setApiAvailable(false);
        setImportStatus("Local OCR was not available. Start the Python API or paste the tags manually.");
      }

      const textDetector = (window as typeof window & {
        TextDetector?: new () => { detect: (source: HTMLImageElement) => Promise<{ rawValue?: string }[]> };
      }).TextDetector;
      if (!textDetector) {
        setImportStatus("Automatic text detection was not available. Paste the tags manually.");
        return;
      }

      try {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const results = await new textDetector().detect(image);
        const detectedText = results.map((result) => result.rawValue ?? "").filter(Boolean).join("\n");
        if (detectedText) {
          setImportText(detectedText);
          setImportStatus("Text detected from screenshot. Review the tags before importing.");
        }
      } catch {
        setImportStatus("Screenshot loaded. Automatic text detection was not available for this image.");
      }
    };
    reader.readAsDataURL(file);
  }

  function updateActiveBlogTags(tags: string[]) {
    setTagProfiles((current) => ({
      ...current,
      [activeAd.destinationBlog]: uniqueTags(tags),
    }));
  }

  function replaceActiveBlogTags() {
    if (!parsedImportTags.length) {
      setImportStatus("Add or detect tags before replacing this blog profile.");
      return;
    }

    updateActiveBlogTags(parsedImportTags);
    setImportStatus(`Replaced ${activeAd.destinationBlog} with ${parsedImportTags.length} tags.`);
  }

  function mergeActiveBlogTags() {
    if (!parsedImportTags.length) {
      setImportStatus("Add or detect tags before merging into this blog profile.");
      return;
    }

    updateActiveBlogTags([...activeBlogTags, ...parsedImportTags]);
    setImportStatus(`Merged ${parsedImportTags.length} tags into ${activeAd.destinationBlog}.`);
  }

  const submissionComplete = activeAd.status === "submitted";
  const pageTitles: Record<WorkspaceView, { eyebrow: string; title: string }> = {
    editor: { eyebrow: "Advertisement workspace", title: activeAd.title || "Untitled saved submission" },
    saved: { eyebrow: "Saved submission library", title: "Saved submissions" },
    templates: { eyebrow: "Reusable copy library", title: "Saved templates" },
    queue: { eyebrow: "Tumblr automation", title: "Submission queue" },
  };
  const toolbarButtons = [
    {
      label: "Bold",
      icon: <Bold size={16} />,
      active: editor?.isActive("bold") ?? false,
      onClick: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: <Italic size={16} />,
      active: editor?.isActive("italic") ?? false,
      onClick: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "Strikethrough",
      icon: <Strikethrough size={16} />,
      active: editor?.isActive("strike") ?? false,
      onClick: () => editor?.chain().focus().toggleStrike().run(),
    },
    {
      label: "Link",
      icon: <Link2 size={16} />,
      active: editor?.isActive("link") ?? false,
      onClick: () => {
        const href = window.prompt("Link URL", editor?.getAttributes("link").href ?? "https://");
        if (!href) {
          return;
        }

        editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
      },
    },
    {
      label: "Unlink",
      icon: <Unlink size={16} />,
      active: false,
      onClick: () => editor?.chain().focus().unsetLink().run(),
    },
    {
      label: "Ordered list",
      icon: <ListOrdered size={16} />,
      active: editor?.isActive("orderedList") ?? false,
      onClick: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Bulleted list",
      icon: <List size={16} />,
      active: editor?.isActive("bulletList") ?? false,
      onClick: () => editor?.chain().focus().toggleBulletList().run(),
    },
  ];

  return (
    <main className="app-shell">
      <AppSidebar
        activeView={activeView}
        apiAvailable={apiAvailable}
        savedCount={stored.ads.length}
        selectedTagCount={selectedTagCount}
        templateCount={templates.length}
        onViewChange={setActiveView}
      />

      <section className="workspace">
        <WorkspaceTopbar
          actionsVisible={activeView === "editor"}
          eyebrow={pageTitles[activeView].eyebrow}
          title={pageTitles[activeView].title}
          onCreateDraft={createDraft}
          onGeneratePost={generatePost}
          onSaveDraft={saveDraft}
        />

        {activeView === "editor" ? (
          <EditorWorkspace
            activeAd={activeAd}
            activeSubmitTarget={activeSubmitTarget}
            checklistTags={checklistTags}
            customTag={customTag}
            editor={editor}
            importImageDataUrl={importImageDataUrl}
            importImageName={importImageName}
            importStatus={importStatus}
            importText={importText}
            newSubmitUrl={newSubmitUrl}
            parsedImportTagCount={parsedImportTags.length}
            submissionComplete={submissionComplete}
            submitTargetStatus={submitTargetStatus}
            targetOptions={targetOptions}
            termsAccepted={termsAccepted}
            toolbarButtons={toolbarButtons}
            validation={validation}
            onAddCustomTag={addCustomTag}
            onAddSubmitTarget={addSubmitTarget}
            onImageUpload={handleImageUpload}
            onMergeActiveBlogTags={mergeActiveBlogTags}
            onOpenSubmitPage={openSubmitPage}
            onQueueTargets={queueTargets}
            onReplaceActiveBlogTags={replaceActiveBlogTags}
            onSelectSubmitTarget={selectSubmitTarget}
            onSubmitRecord={submitRecord}
            onTagScreenshotUpload={handleTagScreenshotUpload}
            onTermsAcceptedChange={setTermsAccepted}
            onToggleTag={toggleTag}
            onUpdateActiveAd={updateActiveAd}
            onUpdateCustomTag={setCustomTag}
            onUpdateImportText={setImportText}
            onUpdateNewSubmitUrl={setNewSubmitUrl}
            onVideoUpload={handleVideoUpload}
          />
        ) : null}
        {activeView === "queue" ? (
          <QueueWorkspace
            activeQueue={activeQueue}
            activeSubmitTarget={activeSubmitTarget}
            queueStatus={queueStatus}
            runnerSettings={runnerSettings}
            runnerState={runnerState}
            targetOptions={targetOptions}
            onClearCompleted={clearCompletedQueueItems}
            onCopyRunnerPlan={copyRunnerPlan}
            onQueueTargets={queueTargets}
            onRefreshRunnerStatus={refreshRunnerStatus}
            onRunnerSettingsChange={(patch) => setRunnerSettings((current) => ({ ...current, ...patch }))}
            onStartRunner={startRunner}
            onUpdateQueueItem={updateQueueItem}
          />
        ) : null}

        {activeView === "templates" ? (
          <TemplatesWorkspace
            draft={templateDraft}
            status={templateStatus}
            templates={templates}
            onApplyTemplate={applyTemplate}
            onCreateTemplate={createTemplate}
            onDeleteTemplate={deleteTemplate}
            onDraftChange={(patch) => setTemplateDraft((current) => ({ ...current, ...patch }))}
            onSaveCurrentAsTemplate={saveCurrentAsTemplate}
          />
        ) : null}

        {activeView === "saved" ? (
          <SavedSubmissionsView
            activeAdId={activeAd.id}
            ads={stored.ads}
            onDeleteDraft={deleteDraft}
            onSelectDraft={(id) => {
              setStored((current) => ({ ...current, activeAdId: id }));
              setActiveView("editor");
            }}
          />
        ) : null}
      </section>
    </main>
  );
}

export default App;

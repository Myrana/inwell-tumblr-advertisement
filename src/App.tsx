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
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { QueueWorkspace } from "./components/QueueWorkspace";
import { RunnerLogsWorkspace } from "./components/RunnerLogsWorkspace";
import { SavedSubmissionsView } from "./components/SavedSubmissionsView";
import { TemplatesWorkspace } from "./components/TemplatesWorkspace";
import { WorkspaceTopbar } from "./components/WorkspaceTopbar";

import {
  apiRequest,
  clearRunnerLogs,
  loadBackendQueue,
  loadBackendTemplates,
  loadRunnerLogs,
  removeAdvertisement,
  removeQueueItem,
  removeTemplate,
  saveAdvertisement,
  saveQueueItem,
  saveTemplate,
} from "./domain/api";
import { composerContentFor, emptyAd, fromApiAdvertisement, normalizeStoredState } from "./domain/ads";
import { defaultTagProfiles, postTypes } from "./domain/constants";
import { buildPreparedPost, validateAdvertisement } from "./domain/post";
import { createQueueItem as createSubmissionQueueItem } from "./domain/queue";
import {
  loadQueueScheduleSettings,
  loadRunnerSettings,
  loadStoredState,
  loadSubmissionQueue,
  loadSubmitTargets,
  loadTagProfiles,
  loadTemplates,
  saveQueueScheduleSettings,
  saveRunnerSettings,
  saveStoredState,
  saveSubmissionQueue,
  saveSubmitTargets,
  saveTagProfiles,
  saveTemplates,
} from "./domain/storage";
import {
  fallbackTarget,
  submitTargetFromUrl,
  uniqueSubmitTargets,
  upsertSubmitTarget,
  upsertSubmitTargetForumUrl,
} from "./domain/submitTargets";
import { normalizeTag, uniqueTags } from "./domain/tags";
import { applyTemplateToAdvertisement, normalizeTemplate, templateFromAdvertisement } from "./domain/templates";
import {
  Advertisement,
  ApiAdvertisement,
  QueueScheduleSettings,
  RunnerLog,
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
  const [templateDraft, setTemplateDraft] = useState({ name: "", content: "" });
  const [templateStatus, setTemplateStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [newSubmitUrl, setNewSubmitUrl] = useState("");
  const [submitTargetStatus, setSubmitTargetStatus] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [, setGeneratedPost] = useState("");
  const [queueStatus, setQueueStatus] = useState("");
  const [queueScheduleSettings, setQueueScheduleSettings] = useState<QueueScheduleSettings>(() => loadQueueScheduleSettings());
  const [runnerSettings, setRunnerSettings] = useState<RunnerSettings>(() => loadRunnerSettings());
  const [runnerState, setRunnerState] = useState<RunnerStatus | null>(null);
  const [runnerLogs, setRunnerLogs] = useState<RunnerLog[]>([]);
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

  const activeQueue = submissionQueue.filter((item) => item.adId === activeAd.id);
  const activeDestinationBlogRef = useRef(activeAd.destinationBlog);
  const activeBlogTags = tagProfiles[activeAd.destinationBlog] ?? defaultTagProfiles[activeAd.destinationBlog] ?? [];
  const checklistTags = uniqueTags([...activeBlogTags, ...activeAd.tags]);
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
    saveQueueScheduleSettings(queueScheduleSettings);
  }, [queueScheduleSettings]);

  useEffect(() => {
    activeDestinationBlogRef.current = activeAd.destinationBlog;
  }, [activeAd.destinationBlog]);

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
        const [advertisementResponse, backendTemplates, backendQueue, backendLogs] = await Promise.all([
          apiRequest<{ advertisements: ApiAdvertisement[] }>("/advertisements"),
          loadBackendTemplates(),
          loadBackendQueue(),
          loadRunnerLogs(),
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
        if (backendQueue.length) {
          setSubmissionQueue(backendQueue);
        }
        setRunnerLogs(backendLogs);
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

  useEffect(() => {
    if (!["queue", "logs"].includes(activeView) || !runnerState?.running) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRunnerStatus({ quiet: true });
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [activeView, runnerState?.running]);

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

  function syncQueueItem(item: SubmissionQueueItem) {
    void saveQueueItem(item)
      .then((saved) => {
        setSubmissionQueue((current) => current.map((queueItem) => (queueItem.id === saved.id ? saved : queueItem)));
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

  function createTemplate(event: FormEvent, contentHtml = templateDraft.content) {
    event.preventDefault();
    const template = normalizeTemplate({
      name: templateDraft.name,
      content: contentHtml,
      forumUrl: "",
      tags: [],
    });

    setTemplates((current) => [template, ...current]);
    syncTemplate(template);
    setTemplateDraft({ name: "", content: "" });
    setTemplateStatus(`Saved ${template.name}.`);
  }

  function applyTemplate(template: SavedTemplate) {
    updateActiveAd(applyTemplateToAdvertisement(template));
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
    activeDestinationBlogRef.current = target.id;
    setSubmitTargetStatus(
      target.submitUrl ? `Selected ${target.name}. Tumblr submit page: ${target.submitUrl}` : "No Tumblr blog selected.",
    );
    updateActiveAd({
      destinationBlog: target.id,
      forumUrl: target.id ? target.forumUrl || activeAd.forumUrl : "",
      title: target.id && !activeAd.title.trim() ? target.name : activeAd.title,
    });
  }

  function addSubmitTarget(event: FormEvent) {
    event.preventDefault();
    const target = submitTargetFromUrl(newSubmitUrl, activeAd.forumUrl);

    if (!target) {
      setSubmitTargetStatus("Enter a Tumblr submit URL, like https://allthingsroleplay.tumblr.com/submit.");
      return;
    }

    setSubmitTargets((current) => upsertSubmitTarget(current, target));
    setTagProfiles((current) => ({
      ...current,
      [target.id]: current[target.id] ?? [],
    }));
    activeDestinationBlogRef.current = target.id;
    updateActiveAd({
      destinationBlog: target.id,
      title: !activeAd.title.trim() ? target.name : activeAd.title,
    });
    setNewSubmitUrl("");
    setSubmitTargetStatus(`Added ${target.name}. Open ${target.submitUrl} when you are ready to paste the post into Tumblr.`);
  }

  function updateForumUrl(value: string) {
    updateActiveAd({ forumUrl: value });

    if (!activeAd.destinationBlog) {
      return;
    }

    setSubmitTargets((current) => upsertSubmitTargetForumUrl(current, activeAd.destinationBlog, value));
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
    const next = emptyAd();
    activeDestinationBlogRef.current = "";
    setValidation([]);
    setGeneratedPost("");
    setSaveStatus("");
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
    setSaveStatus("Saved. Start a new submission or keep editing this one.");
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
    nextItems.forEach(syncQueueItem);
    setQueueStatus(`Queued ${nextItems.length} target${nextItems.length === 1 ? "" : "s"} for the local runner.`);
  }

  function updateQueueItem(id: string, status: SubmissionStatus, notes: string) {
    let nextItem: SubmissionQueueItem | null = null;
    const timestamp = new Date().toISOString();
    setSubmissionQueue((current) =>
      current.map((item) => {
        if (item.id !== id) {
          return item;
        }

        nextItem = {
          ...item,
          status,
          notes,
          updatedAt: timestamp,
          lastRunAt: status === "running" ? timestamp : item.lastRunAt,
          postedAt: status === "posted" ? timestamp : item.postedAt,
          failedAt: status === "failed" ? timestamp : item.failedAt,
        };
        return nextItem;
      }),
    );

    if (nextItem) {
      syncQueueItem(nextItem);
    }
  }

  function clearCompletedQueueItems() {
    const removable = submissionQueue.filter((item) => item.adId === activeAd.id && ["posted", "failed"].includes(item.status));
    setSubmissionQueue((current) => current.filter((item) => item.adId !== activeAd.id || !["posted", "failed"].includes(item.status)));
    removable.forEach((item) => {
      void removeQueueItem(item.id).catch(() => setApiAvailable(false));
    });
    setQueueStatus("Cleared posted and failed entries for this saved submission.");
  }

  function runnableQueueItems() {
    return activeQueue.filter((item) => item.status !== "posted" && item.status !== "running");
  }

  async function refreshRunnerStatus(options: { quiet?: boolean } = {}) {
    try {
      const [response, logs, backendQueue] = await Promise.all([
        apiRequest<{ runner: RunnerStatus }>("/runner/status"),
        loadRunnerLogs(),
        loadBackendQueue(),
      ]);
      setRunnerState(response.runner);
      setRunnerLogs(logs);
      setSubmissionQueue(backendQueue);
      setApiAvailable(true);
      if (!options.quiet) {
        setQueueStatus(response.runner.running ? `Runner is open in process ${response.runner.pid}.` : "Runner is not running.");
      }
    } catch {
      setApiAvailable(false);
      if (!options.quiet) {
        setQueueStatus("Start the Python API before launching the runner from the app.");
      }
    }
  }

  async function startRunner() {
    const items = runnableQueueItems();
    if (!items.length) {
      setQueueStatus("Queue at least one target before starting the runner.");
      return;
    }

    try {
      const runId = `run-${crypto.randomUUID()}`;
      const response = await apiRequest<{ runner: RunnerStatus }>("/runner/start", {
        method: "POST",
        body: JSON.stringify({
          ...runnerSettings,
          runId,
          items,
        }),
      });
      setRunnerState(response.runner);
      const [logs, backendQueue] = await Promise.all([loadRunnerLogs(), loadBackendQueue()]);
      setRunnerLogs(logs);
      setSubmissionQueue(backendQueue);
      setApiAvailable(true);
      setQueueStatus(`Runner launched in a visible PowerShell window. Plan: ${response.runner.plan_path}`);
    } catch {
      setApiAvailable(false);
      setQueueStatus("Could not launch runner. Start the Python API and make sure no runner is already open.");
    }
  }

  async function clearRunnerLogHistory() {
    try {
      await clearRunnerLogs();
      setRunnerLogs([]);
      setApiAvailable(true);
      setQueueStatus("Runner log history cleared.");
    } catch {
      setApiAvailable(false);
      setQueueStatus("Could not clear runner logs. Start the Python API and try again.");
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

  const submissionComplete = activeAd.status === "submitted";
  const pageTitles: Record<WorkspaceView, { eyebrow: string; title: string }> = {
    editor: { eyebrow: "Advertisement workspace", title: activeAd.title || "Untitled saved submission" },
    saved: { eyebrow: "Saved submission library", title: "Saved submissions" },
    templates: { eyebrow: "Reusable copy library", title: "Saved templates" },
    queue: { eyebrow: "Tumblr automation", title: "Submission queue" },
    logs: { eyebrow: "Tumblr automation", title: "Runner logs" },
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
        onViewChange={setActiveView}
      />

      <section className="workspace">
        <WorkspaceTopbar
          actionsVisible={activeView === "editor"}
          eyebrow={pageTitles[activeView].eyebrow}
          title={pageTitles[activeView].title}
          saveStatus={saveStatus}
          onCreateDraft={createDraft}
          onGeneratePost={generatePost}
          onKeepEditing={() => setSaveStatus("")}
          onSaveDraft={saveDraft}
        />

        {activeView === "editor" ? (
          <EditorWorkspace
            activeAd={activeAd}
            activeSubmitTarget={activeSubmitTarget}
            checklistTags={checklistTags}
            customTag={customTag}
            editor={editor}
            newSubmitUrl={newSubmitUrl}
            submissionComplete={submissionComplete}
            submitTargetStatus={submitTargetStatus}
            targetOptions={targetOptions}
            templates={templates}
            toolbarButtons={toolbarButtons}
            validation={validation}
            onAddCustomTag={addCustomTag}
            onAddSubmitTarget={addSubmitTarget}
            onApplyTemplate={applyTemplate}
            onImageUpload={handleImageUpload}
            onQueueTargets={queueTargets}
            onSelectSubmitTarget={selectSubmitTarget}
            onToggleTag={toggleTag}
            onUpdateActiveAd={updateActiveAd}
            onUpdateCustomTag={setCustomTag}
            onUpdateForumUrl={updateForumUrl}
            onUpdateNewSubmitUrl={setNewSubmitUrl}
            onVideoUpload={handleVideoUpload}
          />
        ) : null}
        {activeView === "queue" ? (
          <QueueWorkspace
            activeQueue={activeQueue}
            activeSubmitTarget={activeSubmitTarget}
            queueStatus={queueStatus}
            queueScheduleSettings={queueScheduleSettings}
            runnerSettings={runnerSettings}
            runnerState={runnerState}
            runnerLogs={runnerLogs}
            targetOptions={targetOptions}
            onClearCompleted={clearCompletedQueueItems}
            onQueueTargets={queueTargets}
            onQueueScheduleSettingsChange={(patch) => setQueueScheduleSettings((current) => ({ ...current, ...patch }))}
            onRefreshRunnerStatus={refreshRunnerStatus}
            onRunnerSettingsChange={(patch) => setRunnerSettings((current) => ({ ...current, ...patch }))}
            onStartRunner={startRunner}
            onUpdateQueueItem={updateQueueItem}
          />
        ) : null}
        {activeView === "logs" ? (
          <RunnerLogsWorkspace
            activeQueue={activeQueue}
            runnerLogs={runnerLogs}
            runnerState={runnerState}
            onClearRunnerLogs={clearRunnerLogHistory}
            onRefreshRunnerStatus={refreshRunnerStatus}
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

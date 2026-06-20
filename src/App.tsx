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
import { QueueManagerWorkspace } from "./components/QueueManagerWorkspace";
import { LoginWorkspace } from "./components/LoginWorkspace";
import { RunnerLogsWorkspace } from "./components/RunnerLogsWorkspace";
import { SavedSubmissionsView } from "./components/SavedSubmissionsView";
import { TemplatesWorkspace } from "./components/TemplatesWorkspace";
import { TumblrAccountsWorkspace } from "./components/TumblrAccountsWorkspace";
import { WorkspaceTopbar } from "./components/WorkspaceTopbar";

import {
  ApiError,
  apiRequest,
  checkTumblrLogin,
  clearRunnerLogs,
  loadBackendAppSettings,
  loadBackendQueue,
  loadBackendTemplates,
  loadBackendTumblrAccounts,
  loadAuthSession,
  loadLocalRunnerCommand,
  loadRunnerLogs,
  launchTumblrLogin,
  loginInkwellUser,
  logoutInkwellUser,
  removeAdvertisement,
  removeQueueItem,
  removeTemplate,
  removeTumblrAccount,
  saveAdvertisement,
  saveBackendAppSettings,
  saveQueueItem,
  saveTemplate,
  saveTumblrAccount,
  registerInkwellUser,
} from "./domain/api";
import { composerContentFor, emptyAd, fromApiAdvertisement, normalizeStoredState } from "./domain/ads";
import { defaultTagProfiles, postTypes } from "./domain/constants";
import { buildPreparedPost, validateAdvertisement } from "./domain/post";
import { createQueueItem as createSubmissionQueueItem, queueIdFromName, uniqueQueueDefinitions } from "./domain/queue";
import {
  loadColorTheme,
  loadQueueScheduleSettings,
  loadQueueDefinitions,
  loadRunnerSettings,
  loadStoredState,
  loadSubmissionQueue,
  loadSubmitTargets,
  loadTagProfiles,
  loadTemplates,
  loadTumblrAccounts,
  saveColorTheme,
  saveQueueScheduleSettings,
  saveQueueDefinitions,
  saveRunnerSettings,
  saveStoredState,
  saveSubmissionQueue,
  saveSubmitTargets,
  saveTagProfiles,
  saveTemplates,
  saveTumblrAccounts,
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
import { fromApiTumblrAccount, normalizeTumblrAccount, tumblrAccountId, upsertTumblrAccount } from "./domain/tumblrAccounts";
import {
  Advertisement,
  AppSettings,
  ApiAdvertisement,
  AuthUser,
  ColorTheme,
  QueueScheduleSettings,
  QueueDefinition,
  RunnerLog,
  RunnerSettings,
  RunnerStatus,
  SavedTemplate,
  SubmissionQueueItem,
  SubmissionStatus,
  StoredState,
  TumblrSubmitTarget,
  TumblrAccount,
  WorkspaceView,
} from "./domain/types";
function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [loginStatus, setLoginStatus] = useState("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "", displayName: "", workspaceName: "Inkwell workspace" });
  const [stored, setStored] = useState<StoredState>(() => loadStoredState());
  const [submitTargets, setSubmitTargets] = useState<TumblrSubmitTarget[]>(() => loadSubmitTargets());
  const [submissionQueue, setSubmissionQueue] = useState<SubmissionQueueItem[]>(() => loadSubmissionQueue());
  const [queueDefinitions, setQueueDefinitions] = useState<QueueDefinition[]>(() => loadQueueDefinitions());
  const [tagProfiles, setTagProfiles] = useState<Record<string, string[]>>(() => loadTagProfiles());
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => loadTemplates());
  const [tumblrAccounts, setTumblrAccounts] = useState<TumblrAccount[]>(() => loadTumblrAccounts());
  const [accountDraft, setAccountDraft] = useState({ displayName: "", blogName: "" });
  const [accountStatus, setAccountStatus] = useState("");
  const [apiAvailable, setApiAvailable] = useState(false);
  const [backendStateLoaded, setBackendStateLoaded] = useState(false);
  const [customTag, setCustomTag] = useState("");
  const [templateDraft, setTemplateDraft] = useState({ name: "", content: "" });
  const [templateStatus, setTemplateStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [newSubmitUrl, setNewSubmitUrl] = useState("");
  const [submitTargetStatus, setSubmitTargetStatus] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [queueStatus, setQueueStatus] = useState("");
  const [editorQueueConfirmation, setEditorQueueConfirmation] = useState<{ count: number; queueName: string } | null>(null);
  const [queueNameDraft, setQueueNameDraft] = useState("");
  const [selectedQueueName, setSelectedQueueName] = useState("");
  const [queueScheduleSettings, setQueueScheduleSettings] = useState<QueueScheduleSettings>(() => loadQueueScheduleSettings());
  const [runnerSettings, setRunnerSettings] = useState<RunnerSettings>(() => loadRunnerSettings());
  const [runnerState, setRunnerState] = useState<RunnerStatus | null>(null);
  const [runnerLogs, setRunnerLogs] = useState<RunnerLog[]>([]);
  const [activeView, setActiveView] = useState<WorkspaceView>("editor");
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => loadColorTheme());
  const [accountSetupRouteApplied, setAccountSetupRouteApplied] = useState(false);

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
  const hasConnectedTumblrAccount = useMemo(
    () => tumblrAccounts.some((account) => account.status === "connected"),
    [tumblrAccounts],
  );

  const queueOptions = useMemo(() => uniqueQueueDefinitions(queueDefinitions, submissionQueue), [queueDefinitions, submissionQueue]);
  const activeQueueName = queueOptions.some((queue) => queue.name === selectedQueueName) ? selectedQueueName : queueOptions[0]?.name ?? "";
  const activeQueue = submissionQueue.filter((item) => item.queueName === activeQueueName);
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
    let cancelled = false;
    async function checkSession() {
      try {
        const session = await loadAuthSession();
        if (cancelled) return;
        setAuthUser(session.authenticated ? session.user : null);
        setBootstrapRequired(session.bootstrapRequired);
      } catch {
        if (!cancelled) {
          setAuthUser(null);
          setBootstrapRequired(true);
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

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
    saveQueueDefinitions(queueOptions);
  }, [queueOptions]);

  useEffect(() => {
    if (selectedQueueName !== activeQueueName) {
      setSelectedQueueName(activeQueueName);
    }
  }, [activeQueueName, selectedQueueName]);

  useEffect(() => {
    saveTagProfiles(tagProfiles);
  }, [tagProfiles]);

  useEffect(() => {
    saveTemplates(templates);
  }, [templates]);

  useEffect(() => {
    saveTumblrAccounts(tumblrAccounts);
  }, [tumblrAccounts]);

  useEffect(() => {
    saveRunnerSettings(runnerSettings);
  }, [runnerSettings]);

  useEffect(() => {
    saveQueueScheduleSettings(queueScheduleSettings);
  }, [queueScheduleSettings]);

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
    saveColorTheme(colorTheme);
  }, [colorTheme]);

  useEffect(() => {
    if (!authUser || !backendStateLoaded) {
      return;
    }

    const settings: AppSettings = {
      submitTargets,
      queueDefinitions: queueOptions,
      tagProfiles,
      runnerSettings,
      queueScheduleSettings,
    };

    void saveBackendAppSettings(settings)
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
  }, [authUser, backendStateLoaded, queueOptions, queueScheduleSettings, runnerSettings, submitTargets, tagProfiles]);

  useEffect(() => {
    if (!authUser) {
      setAccountSetupRouteApplied(false);
      return;
    }

    if (!backendStateLoaded || accountSetupRouteApplied) {
      return;
    }

    if (!hasConnectedTumblrAccount) {
      setActiveView("accounts");
    }
    setAccountSetupRouteApplied(true);
  }, [accountSetupRouteApplied, authUser, backendStateLoaded, hasConnectedTumblrAccount]);

  useEffect(() => {
    activeDestinationBlogRef.current = activeAd.destinationBlog;
  }, [activeAd.destinationBlog]);

  useEffect(() => {
    setEditorQueueConfirmation(null);
  }, [activeAd.id]);

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
      if (!authUser) {
        return;
      }
      try {
        const [advertisementResponse, backendTemplates, backendQueue, backendLogs, backendSettings, backendTumblrAccounts] = await Promise.all([
          apiRequest<{ advertisements: ApiAdvertisement[] }>("/advertisements"),
          loadBackendTemplates(),
          loadBackendQueue(),
          loadRunnerLogs(),
          loadBackendAppSettings(),
          loadBackendTumblrAccounts(),
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
        setSubmitTargets(
          backendSettings.submitTargets?.length ? uniqueSubmitTargets(backendSettings.submitTargets) : submitTargets,
        );
        setQueueDefinitions(
          backendSettings.queueDefinitions?.length
            ? uniqueQueueDefinitions(backendSettings.queueDefinitions, backendQueue)
            : uniqueQueueDefinitions(queueDefinitions, backendQueue),
        );
        setTagProfiles(
          backendSettings.tagProfiles && Object.keys(backendSettings.tagProfiles).length
            ? backendSettings.tagProfiles
            : tagProfiles,
        );
        setRunnerSettings(backendSettings.runnerSettings ? { ...runnerSettings, ...backendSettings.runnerSettings } : runnerSettings);
        setQueueScheduleSettings(backendSettings.queueScheduleSettings ?? queueScheduleSettings);
        setRunnerLogs(backendLogs);
        if (backendTumblrAccounts.length) {
          setTumblrAccounts(backendTumblrAccounts);
        }
        setApiAvailable(true);
        setBackendStateLoaded(true);
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
  }, [authUser]);

  useEffect(() => {
    if (!["queue", "logs"].includes(activeView)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRunnerStatus({ quiet: true });
    }, runnerState?.running ? 3000 : 15000);

    return () => window.clearInterval(intervalId);
  }, [activeView, runnerState?.running]);

  function syncAdvertisement(advertisement: Advertisement) {
    void saveAdvertisement(advertisement)
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
  }

  function authLockMessage(error: unknown, fallback: string) {
    if (error instanceof ApiError && error.status === 429) {
      const minutes = error.retryAfterSeconds ? Math.max(1, Math.ceil(error.retryAfterSeconds / 60)) : 15;
      return `${error.message} Wait about ${minutes} minute${minutes === 1 ? "" : "s"} before trying again.`;
    }
    return fallback;
  }

  async function registerInkwell(event: FormEvent) {
    event.preventDefault();
    try {
      const session = await registerInkwellUser(loginForm);
      setAuthUser(session.user);
      setBootstrapRequired(false);
      setBackendStateLoaded(false);
      setAccountSetupRouteApplied(false);
      setLoginStatus("");
    } catch (error) {
      setLoginStatus(authLockMessage(error, "Could not create that login. Use a valid email and a password with at least 8 characters."));
    }
  }

  async function loginInkwell(event: FormEvent) {
    event.preventDefault();
    try {
      const session = await loginInkwellUser({ email: loginForm.email, password: loginForm.password });
      setAuthUser(session.user);
      setBootstrapRequired(false);
      setBackendStateLoaded(false);
      setAccountSetupRouteApplied(false);
      setLoginStatus("");
    } catch (error) {
      setLoginStatus(authLockMessage(error, "Email or password was not accepted."));
    }
  }

  async function logoutInkwell() {
    try {
      await logoutInkwellUser();
    } finally {
      setAuthUser(null);
      setBackendStateLoaded(false);
      setLoginStatus("");
    }
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
    setSaveStatus("Saved.");
  }

  function validateAd() {
    const missing = validateAdvertisement(activeAd);
    setValidation(missing);
    return missing;
  }

  function buildPost() {
    return buildPreparedPost(activeAd);
  }

  function createQueueItem(target: TumblrSubmitTarget): SubmissionQueueItem {
    return createSubmissionQueueItem(activeAd, target, buildPost(), activeQueueName, runnerSettings.tumblrAccountId);
  }

  function queueTargets(targets: TumblrSubmitTarget[]) {
    if (!activeQueueName) {
      setQueueStatus("Create a queue before adding submissions.");
      setActiveView("queue-settings");
      return;
    }

    const missing = validateAd();
    if (missing.length) {
      return;
    }

    const nextItems = targets.map((target) => createQueueItem(target));
    setSubmissionQueue((current) => {
      const withoutExisting = current.filter(
        (item) => item.queueName !== activeQueueName || item.adId !== activeAd.id || !nextItems.some((next) => next.targetId === item.targetId),
      );
      return [...nextItems, ...withoutExisting];
    });
    nextItems.forEach(syncQueueItem);
    setQueueStatus(`Queued ${nextItems.length} target${nextItems.length === 1 ? "" : "s"} in ${activeQueueName}.`);
    if (activeView === "editor") {
      setEditorQueueConfirmation({ count: nextItems.length, queueName: activeQueueName });
    }
  }

  function renameQueueDefinition(currentName: string, nextNameValue: string) {
    const nextName = nextNameValue.trim();
    if (!nextName) {
      setQueueStatus("Enter a queue name first.");
      return;
    }
    if (nextName === currentName) {
      return;
    }
    if (queueOptions.some((queue) => queue.name.toLowerCase() === nextName.toLowerCase() && queue.name !== currentName)) {
      setQueueStatus(`${nextName} already exists.`);
      return;
    }

    const renamedQueue = { id: queueIdFromName(nextName), name: nextName };
    setQueueDefinitions((current) =>
      uniqueQueueDefinitions(
        current.map((queue) => (queue.name === currentName ? renamedQueue : queue)),
        submissionQueue.map((item) => (item.queueName === currentName ? { ...item, queueName: nextName } : item)),
      ),
    );
    setSubmissionQueue((current) =>
      current.map((item) => {
        if (item.queueName !== currentName) {
          return item;
        }
        const renamedItem = { ...item, queueName: nextName, updatedAt: new Date().toISOString() };
        syncQueueItem(renamedItem);
        return renamedItem;
      }),
    );
    if (selectedQueueName === currentName) {
      setSelectedQueueName(nextName);
    }
    setQueueStatus(`Renamed ${currentName} to ${nextName}.`);
  }

  function deleteQueueDefinition(queueName: string) {
    const removableItems = submissionQueue.filter((item) => item.queueName === queueName);
    const remainingDefinitions = queueDefinitions.filter((queue) => queue.name !== queueName);
    const remainingItems = submissionQueue.filter((item) => item.queueName !== queueName);
    const nextOptions = uniqueQueueDefinitions(remainingDefinitions, remainingItems);
    const nextSelectedQueue = selectedQueueName === queueName ? nextOptions[0]?.name ?? "" : selectedQueueName;

    setQueueDefinitions(remainingDefinitions);
    setSubmissionQueue(remainingItems);
    setSelectedQueueName(nextSelectedQueue);
    removableItems.forEach((item) => {
      void removeQueueItem(item.id).catch(() => setApiAvailable(false));
    });
    setQueueStatus(`Deleted ${queueName}.`);
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
          lastRunAt: status === "running" ? timestamp : status === "queued" ? "" : item.lastRunAt,
          postedAt: status === "posted" ? timestamp : status === "queued" ? "" : item.postedAt,
          failedAt: status === "failed" ? timestamp : status === "queued" ? "" : item.failedAt,
        };
        return nextItem;
      }),
    );

    if (nextItem) {
      syncQueueItem(nextItem);
    }
  }

  function editQueuedSubmission(id: string) {
    const item = submissionQueue.find((queueItem) => queueItem.id === id);
    if (!item) {
      setQueueStatus("That queued submission is no longer available.");
      return;
    }

    const normalized = normalizeStoredState(stored);
    const ad = normalized.ads.find((candidate) => candidate.id === item.adId);
    if (!ad) {
      setQueueStatus("That queued submission is not in the content library yet.");
      return;
    }

    setStored({ ...normalized, activeAdId: ad.id });
    setSelectedQueueName(item.queueName);
    setActiveView("editor");
  }

  function createQueueDefinition(event: FormEvent) {
    event.preventDefault();
    const name = queueNameDraft.trim();
    if (!name) {
      setQueueStatus("Enter a queue name first.");
      return;
    }

    const nextQueue = { id: queueIdFromName(name), name };
    setQueueDefinitions((current) => uniqueQueueDefinitions([...current, nextQueue], submissionQueue));
    setSelectedQueueName(name);
    setQueueNameDraft("");
    setActiveView("queue");
    setQueueStatus(`Created queue ${name}.`);
  }

  function clearQueueItems(queueName: string, completedOnly: boolean) {
    const completedStatuses: SubmissionStatus[] = ["submitted", "posted", "failed"];
    const removable = submissionQueue.filter(
      (item) => item.queueName === queueName && (!completedOnly || completedStatuses.includes(item.status)),
    );
    setSubmissionQueue((current) =>
      current.filter((item) => item.queueName !== queueName || (completedOnly && !completedStatuses.includes(item.status))),
    );
    removable.forEach((item) => {
      void removeQueueItem(item.id).catch(() => setApiAvailable(false));
    });
    setQueueStatus(
      completedOnly
        ? `Cleared completed entries from ${queueName}.`
        : `Cleared all entries from ${queueName}.`,
    );
  }

  function syncTumblrAccount(account: TumblrAccount) {
    void saveTumblrAccount(account)
      .then((saved) => {
        setTumblrAccounts((current) => upsertTumblrAccount(current, saved));
        setApiAvailable(true);
      })
      .catch(() => setApiAvailable(false));
  }

  function createTumblrAccount(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeTumblrAccount({
      id: tumblrAccountId(accountDraft.blogName || accountDraft.displayName),
      displayName: accountDraft.displayName,
      blogName: accountDraft.blogName,
      status: "needs-login",
      notes: "Connect a browser session before queue runs.",
    });
    if (!normalized) {
      setAccountStatus("Enter a Tumblr account name or blog name first.");
      return;
    }

    setTumblrAccounts((current) => upsertTumblrAccount(current, normalized));
    setRunnerSettings((current) => ({ ...current, tumblrAccountId: normalized.id }));
    syncTumblrAccount(normalized);
    setAccountDraft({ displayName: "", blogName: "" });
    setAccountStatus(`Added ${normalized.displayName}. Use Connect to log into Tumblr.`);
  }

  function deleteTumblrAccount(id: string) {
    setTumblrAccounts((current) => current.filter((account) => account.id !== id));
    setRunnerSettings((current) => ({ ...current, tumblrAccountId: current.tumblrAccountId === id ? "" : current.tumblrAccountId }));
    void removeTumblrAccount(id)
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
    setAccountStatus("Deleted Tumblr account session record.");
  }

  function selectTumblrAccount(id: string) {
    setRunnerSettings((current) => ({ ...current, tumblrAccountId: id }));
    const account = tumblrAccounts.find((item) => item.id === id);
    setAccountStatus(account ? `Selected ${account.displayName} for queue runs.` : "No Tumblr account selected.");
  }

  async function launchTumblrAccountLogin(id: string) {
    const account = tumblrAccounts.find((item) => item.id === id);
    if (!account) {
      setAccountStatus("Select or create a Tumblr account first.");
      return;
    }

    setRunnerSettings((current) => ({ ...current, tumblrAccountId: id }));

    try {
      const response = await launchTumblrLogin(id, runnerSettings.slowMo);
      const note =
        response.login.mode === "remote"
          ? response.login.message
          : "Login helper launched. Complete Tumblr login in the visible browser.";
      const checking: TumblrAccount = response.login.mode === "remote" && response.login.account
        ? fromApiTumblrAccount(response.login.account)
        : {
            ...account,
            status: "checking",
            lastCheckedAt: new Date().toISOString(),
            notes: note,
          };
      setTumblrAccounts((current) => upsertTumblrAccount(current, checking));
      setApiAvailable(true);
      if (response.login.mode === "remote") {
        window.open(response.login.launchUrl, "_blank", "noopener,noreferrer");
        setAccountStatus(response.login.message);
      } else {
        setAccountStatus(response.login.message || `Login helper opened in process ${response.login.pid}. Finish Tumblr login in that browser.`);
      }
    } catch (error) {
      setApiAvailable(false);
      const message = error instanceof ApiError ? error.message : "Could not start Tumblr account connection. Start the Python API and try again.";
      setAccountStatus(message);
    }
  }

  async function checkTumblrAccountLogin(id: string) {
    const account = tumblrAccounts.find((item) => item.id === id);
    if (!account) {
      setAccountStatus("Select or create a Tumblr account first.");
      return;
    }

    setRunnerSettings((current) => ({ ...current, tumblrAccountId: id }));
    setAccountStatus(`Checking saved Tumblr login for ${account.displayName}...`);

    try {
      const response = await checkTumblrLogin(id);
      const fallbackStatus: TumblrAccount["status"] =
        response.login.mode === "remote" && response.login.loggedIn ? "connected" : "needs-login";
      const checked = response.login.mode === "remote" && response.login.account
        ? fromApiTumblrAccount(response.login.account)
        : {
            ...account,
            status: fallbackStatus,
            lastCheckedAt: new Date().toISOString(),
            notes: response.login.message,
          };
      setTumblrAccounts((current) => upsertTumblrAccount(current, checked));
      setApiAvailable(true);
      if (response.login.mode === "remote" && response.login.launchUrl) {
        window.open(response.login.launchUrl, "_blank", "noopener,noreferrer");
      }
      setAccountStatus(response.login.message);
    } catch (error) {
      setApiAvailable(false);
      const message = error instanceof ApiError ? error.message : "Could not check saved Tumblr login. Start the Python API and try again.";
      setAccountStatus(message);
    }
  }

  function markTumblrAccountConnected(id: string) {
    const account = tumblrAccounts.find((item) => item.id === id);
    if (!account) {
      return;
    }

    const connected: TumblrAccount = {
      ...account,
      status: "connected",
      lastCheckedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      notes: "Marked connected after manual Tumblr login.",
    };
    setTumblrAccounts((current) => upsertTumblrAccount(current, connected));
    setRunnerSettings((current) => ({ ...current, tumblrAccountId: id }));
    syncTumblrAccount(connected);
    setAccountStatus(`${connected.displayName} is ready for queue runs.`);
  }

  function runnableQueueItems() {
    return activeQueue.filter((item) => !["submitted", "posted", "running"].includes(item.status));
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

  async function copyTextToClipboard(value: string) {
    if (!navigator.clipboard?.writeText) {
      return false;
    }

    await navigator.clipboard.writeText(value);
    return true;
  }

  async function prepareLocalRunnerCommand(options: { copy?: boolean } = {}) {
    const items = runnableQueueItems();
    if (!items.length) {
      setQueueStatus("Queue at least one target before starting the runner.");
      return;
    }

    try {
      const localRunner = await loadLocalRunnerCommand(activeQueueName);
      const [logs, backendQueue] = await Promise.all([loadRunnerLogs(), loadBackendQueue()]);
      setRunnerLogs(logs);
      setSubmissionQueue(backendQueue);
      setApiAvailable(true);
      const copied = options.copy ? await copyTextToClipboard(localRunner.command).catch(() => false) : false;
      const tokenWarning = localRunner.tokenConfigured ? "" : "Railway is missing INWELL_LOCAL_RUNNER_TOKEN. ";
      const copyMessage = copied ? "Local runner command copied. " : "";
      if (localRunner.usesDeviceToken) {
        const autoStartMessage = copied && localRunner.autoStartCommand ? " Auto-start command was also prepared with the same device token." : "";
        const actionMessage = copied ? "Keep the copied command private." : "Use Run locally to copy a fresh private device-token command.";
        setQueueStatus(`${copyMessage}${localRunner.message} ${actionMessage}${autoStartMessage}`);
        return;
      }
      const autoStartMessage = localRunner.autoStartCommand ? ` Auto-start: ${localRunner.autoStartCommand}` : "";
      setQueueStatus(`${copyMessage}${localRunner.message} ${tokenWarning}Command: ${localRunner.command}${autoStartMessage}`);
    } catch (error) {
      setApiAvailable(false);
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not prepare the local runner command.";
      setQueueStatus(`Could not prepare local runner command. ${message}`);
    }
  }

  async function startRunner() {
    await prepareLocalRunnerCommand({ copy: true });
  }

  async function showLocalRunnerCommand() {
    await prepareLocalRunnerCommand();
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
    editor: { eyebrow: "Submission workspace", title: activeAd.title || "Untitled submission" },
    saved: { eyebrow: "Content library", title: "Content library" },
    templates: { eyebrow: "Reusable copy library", title: "Saved templates" },
    queue: { eyebrow: "Tumblr automation", title: "Submission queue" },
    "queue-settings": { eyebrow: "Tumblr automation", title: "Queues" },
    accounts: { eyebrow: "Tumblr automation", title: "Tumblr accounts" },
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

  if (!authChecked) {
    return (
      <main className="login-shell" data-theme={colorTheme}>
        <section className="login-panel">
          <div className="brand login-brand">
            <div className="brand-mark">I</div>
            <div>
              <strong>Inkwell</strong>
              <span>Loading workspace</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!authUser) {
    return (
      <LoginWorkspace
        bootstrapRequired={bootstrapRequired}
        form={loginForm}
        status={loginStatus}
        onFormChange={(patch) => setLoginForm((current) => ({ ...current, ...patch }))}
        onLogin={loginInkwell}
        onRegister={registerInkwell}
      />
    );
  }

  return (
    <main className="app-shell" data-theme={colorTheme}>
      <AppSidebar
        activeView={activeView}
        user={authUser}
        onLogout={logoutInkwell}
        onViewChange={setActiveView}
      />

      <section className="workspace">
        <WorkspaceTopbar
          actionsVisible={activeView === "editor"}
          eyebrow={pageTitles[activeView].eyebrow}
          title={pageTitles[activeView].title}
          saveStatus={saveStatus}
          theme={colorTheme}
          onCreateDraft={createDraft}
          onSaveDraft={saveDraft}
          onToggleTheme={() => setColorTheme((current) => (current === "dark" ? "light" : "dark"))}
        />

        {activeView === "editor" ? (
          <EditorWorkspace
            activeAd={activeAd}
            activeSubmitTarget={activeSubmitTarget}
            checklistTags={checklistTags}
            customTag={customTag}
            editor={editor}
            newSubmitUrl={newSubmitUrl}
            queueConfirmation={editorQueueConfirmation}
            queueOptions={queueOptions}
            selectedQueueName={activeQueueName}
            submissionComplete={submissionComplete}
            submitTargetStatus={submitTargetStatus}
            targetOptions={targetOptions}
            templates={templates}
            toolbarButtons={toolbarButtons}
            validation={validation}
            onAddCustomTag={addCustomTag}
            onAddSubmitTarget={addSubmitTarget}
            onApplyTemplate={applyTemplate}
            onDismissQueueConfirmation={() => setEditorQueueConfirmation(null)}
            onImageUpload={handleImageUpload}
            onQueueTargets={queueTargets}
            onSelectQueue={(queueName) => {
              setSelectedQueueName(queueName);
              setEditorQueueConfirmation(null);
            }}
            onSelectSubmitTarget={selectSubmitTarget}
            onToggleTag={toggleTag}
            onUpdateActiveAd={updateActiveAd}
            onUpdateCustomTag={setCustomTag}
            onUpdateForumUrl={updateForumUrl}
            onUpdateNewSubmitUrl={setNewSubmitUrl}
            onViewQueue={() => setActiveView("queue")}
            onVideoUpload={handleVideoUpload}
          />
        ) : null}
        {activeView === "queue" ? (
          <QueueWorkspace
            activeQueue={activeQueue}
            activeQueueName={activeQueueName}
            activeSubmitTarget={activeSubmitTarget}
            queueOptions={queueOptions}
            queueStatus={queueStatus}
            queueScheduleSettings={queueScheduleSettings}
            runnerSettings={runnerSettings}
            runnerState={runnerState}
            runnerLogs={runnerLogs}
            targetOptions={targetOptions}
            tumblrAccounts={tumblrAccounts}
            onClearQueue={clearQueueItems}
            onEditQueueItem={editQueuedSubmission}
            onQueueTargets={queueTargets}
            onRenameQueue={renameQueueDefinition}
            onSelectQueue={setSelectedQueueName}
            onQueueScheduleSettingsChange={(patch) => setQueueScheduleSettings((current) => ({ ...current, ...patch }))}
            onRefreshRunnerStatus={refreshRunnerStatus}
            onRunnerSettingsChange={(patch) => setRunnerSettings((current) => ({ ...current, ...patch }))}
            onShowLocalRunnerCommand={showLocalRunnerCommand}
            onStartRunner={startRunner}
            onUpdateQueueItem={updateQueueItem}
          />
        ) : null}
        {activeView === "queue-settings" ? (
          <QueueManagerWorkspace
            activeQueueName={activeQueueName}
            queueNameDraft={queueNameDraft}
            queueOptions={queueOptions}
            queueStatus={queueStatus}
            submissionQueue={submissionQueue}
            onCreateQueue={createQueueDefinition}
            onDeleteQueue={deleteQueueDefinition}
            onQueueNameDraftChange={setQueueNameDraft}
            onSelectQueue={(queueName) => {
              setSelectedQueueName(queueName);
              setActiveView("queue");
            }}
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

        {activeView === "accounts" ? (
          <TumblrAccountsWorkspace
            accounts={tumblrAccounts}
            draft={accountDraft}
            runnerSettings={runnerSettings}
            selectedAccountId={runnerSettings.tumblrAccountId}
            status={accountStatus}
            onCreateSubmission={() => setActiveView("editor")}
            onCreateAccount={createTumblrAccount}
            onDeleteAccount={deleteTumblrAccount}
            onDraftChange={(patch) => setAccountDraft((current) => ({ ...current, ...patch }))}
            onCheckLogin={checkTumblrAccountLogin}
            onLaunchLogin={launchTumblrAccountLogin}
            onMarkConnected={markTumblrAccountConnected}
            onRunnerSettingsChange={(patch) => setRunnerSettings((current) => ({ ...current, ...patch }))}
            onSelectAccount={selectTumblrAccount}
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

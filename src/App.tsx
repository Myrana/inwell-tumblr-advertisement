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
import { DocumentationWorkspace } from "./components/DocumentationWorkspace";
import { LoginWorkspace, type LoginMode } from "./components/LoginWorkspace";
import { OperationsDashboard } from "./components/OperationsDashboard";
import { OperationalSettingsWorkspace } from "./components/OperationalSettingsWorkspace";
import { RunnerLogsWorkspace } from "./components/RunnerLogsWorkspace";
import { RunnerWorkspace } from "./components/RunnerWorkspace";
import { SavedSubmissionsView } from "./components/SavedSubmissionsView";
import { TemplatesWorkspace } from "./components/TemplatesWorkspace";
import { TumblrAccountsWorkspace } from "./components/TumblrAccountsWorkspace";
import { WorkspaceTopbar } from "./components/WorkspaceTopbar";
import { useEditorQueueActions } from "./hooks/useEditorQueueActions";
import { useQueueTransitionController } from "./hooks/useQueueTransitionController";
import { useWorkspaceChrome, workspacePageTitles } from "./hooks/useWorkspaceChrome";

import {
  ApiError,
  apiRequest,
  checkTumblrLogin,
  clearRunnerLogs,
  loadBackendAdvertisements,
  loadBackendAppSettings,
  loadBackendQueue,
  loadBackendTemplates,
  loadBackendTumblrAccounts,
  loadAuthSession,
  downloadLocalRunnerPackage,
  launchLocalCompanionLogin,
  loadLocalCompanionStatus,
  loadLocalRunnerCommand,
  loadRunnerLogs,
  loginInkwellUser,
  logoutInkwellUser,
  requestInkwellPasswordReset,
  removeAdvertisement,
  removeQueueItem,
  removeTemplate,
  removeTumblrAccount,
  saveAdvertisement,
  saveBackendAppSettings,
  saveDiscordWebhookSettings,
  saveQueueItem,
  saveTemplate,
  saveTumblrAccount,
  runLocalCompanion,
  registerInkwellUser,
  testDiscordWebhookSettings,
  type LocalCompanionStatus,
} from "./domain/api";
import { composerContentFor, emptyAd, hasLibraryContent, normalizeStoredState } from "./domain/ads";
import { defaultTagProfiles } from "./domain/constants";
import { MediaLibraryAsset, mediaLibraryFromAdvertisements } from "./domain/mediaLibrary";
import {
  automationQueueRunStatusMessage,
  defaultAutomationRefillTargetDepth,
  prepareAutomationQueueForRun,
  PreparedAutomationQueue,
  queueRefillAvailabilityPreview,
} from "./domain/queueAutomation";
import { queueIdFromName, uniqueQueueDefinitions } from "./domain/queue";
import {
  loadQueueScheduleSettings,
  clearBackendOwnedLocalStorage,
  normalizeQueueScheduleSettings,
  normalizeRunnerSettings,
  loadQueueDefinitions,
  loadRunnerSettings,
  loadStoredState,
  loadSubmissionQueue,
  loadSubmitTargets,
  loadTagProfiles,
  loadTemplates,
  loadTumblrAccounts,
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
import { normalizeTag, normalizeTagProfiles, uniqueTags } from "./domain/tags";
import { applyTemplateToAdvertisement, normalizeTemplate, templateFromAdvertisement } from "./domain/templates";
import { fromApiTumblrAccount, normalizeTumblrAccount, runnerAccountReadiness, tumblrAccountId, upsertTumblrAccount } from "./domain/tumblrAccounts";
import {
  Advertisement,
  AppSettings,
  AuthUser,
  QueueSchedulePreference,
  QueueScheduleSettings,
  QueueDefinition,
  RunnerLog,
  RunnerSettings,
  RunnerStatus,
  SavedTemplate,
  SubmissionQueueItem,
  StoredState,
  TumblrSubmitTarget,
  TumblrAccount,
  WorkspaceView,
} from "./domain/types";
import { startLocalCompanionRun } from "./domain/localRunner";
import { scheduleRunnerReadinessFromState } from "./domain/localRunnerReadiness";

function applyArchiveDraftState(current: StoredState, id: string, archived: boolean): {
  nextStored: StoredState;
  updatedDraft: Advertisement | null;
} {
  const normalized = normalizeStoredState(current);
  let updatedDraft: Advertisement | null = null;
  const nextStored = {
    ...normalized,
    ads: normalized.ads.map((ad) => {
      if (ad.id !== id) {
        return ad;
      }
      const nextDraft: Advertisement = {
        ...ad,
        archived,
        updatedAt: new Date().toISOString(),
      }
      updatedDraft = nextDraft;
      return nextDraft;
    }),
  };
  return { nextStored, updatedDraft };
}

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [loginMode, setLoginMode] = useState<LoginMode>("login");
  const [loginStatus, setLoginStatus] = useState("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "", displayName: "", workspaceName: "Inkwell workspace" });
  const [stored, setStored] = useState<StoredState>(() => loadStoredState());
  const storedRef = useRef(stored);
  const [submitTargets, setSubmitTargets] = useState<TumblrSubmitTarget[]>(() => loadSubmitTargets());
  const [submissionQueue, setSubmissionQueue] = useState<SubmissionQueueItem[]>(() => loadSubmissionQueue());
  const [queueDefinitions, setQueueDefinitions] = useState<QueueDefinition[]>(() => loadQueueDefinitions());
  const [tagProfiles, setTagProfiles] = useState<Record<string, string[]>>(() => loadTagProfiles());
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => loadTemplates());
  const [tumblrAccounts, setTumblrAccounts] = useState<TumblrAccount[]>(() => loadTumblrAccounts());
  const [accountDraft, setAccountDraft] = useState({ displayName: "", blogName: "" });
  const [accountStatus, setAccountStatus] = useState("");
  const [, setApiAvailable] = useState(false);
  const [backendStateLoaded, setBackendStateLoaded] = useState(false);
  const [customTag, setCustomTag] = useState("");
  const [templateDraft, setTemplateDraft] = useState({ name: "", content: "" });
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
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
  const runnerSettingsRef = useRef(runnerSettings);
  const [runnerState, setRunnerState] = useState<RunnerStatus | null>(null);
  const [localCompanion, setLocalCompanion] = useState<LocalCompanionStatus | null>(null);
  const [runnerLogs, setRunnerLogs] = useState<RunnerLog[]>([]);
  const [activeView, setActiveView] = useState<WorkspaceView>("dashboard");
  const [accountSetupRouteApplied, setAccountSetupRouteApplied] = useState(false);
  const { colorTheme, colorSkin, workspaceDensity, selectColorSkin, setWorkspaceDensity, toggleColorTheme } = useWorkspaceChrome();

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
  const libraryAds = useMemo(() => stored.ads.filter(hasLibraryContent), [stored.ads]);
  const activeQueueName = queueOptions.some((queue) => queue.name === selectedQueueName) ? selectedQueueName : queueOptions[0]?.name ?? "";
  const activeQueue = submissionQueue.filter((item) => item.queueName === activeQueueName);
  const backendOwnsWorkspaceState = Boolean(authUser && backendStateLoaded);
  const {
    bulkUpdateQueueItems,
    isQueueBusy,
    retryQueueItemTestRun,
    updateQueueItem,
  } = useQueueTransitionController({
    backendOwnsWorkspaceState,
    loadBackendQueue,
    setApiAvailable,
    setQueueStatus,
    setSubmissionQueue,
    startRunner,
    stored,
    submissionQueue,
    submitTargets,
    syncQueueItem,
    tumblrAccountId: runnerSettings.tumblrAccountId,
  });
  const defaultQueueScheduleSettings: QueueSchedulePreference = useMemo(
    () => ({
      enabled: queueScheduleSettings.enabled,
      dailyTime: queueScheduleSettings.dailyTime,
      timezone: queueScheduleSettings.timezone,
    }),
    [queueScheduleSettings.dailyTime, queueScheduleSettings.enabled, queueScheduleSettings.timezone],
  );
  const activeQueueScheduleSettings = activeQueueName
    ? queueScheduleSettings.perQueue[activeQueueName] ?? defaultQueueScheduleSettings
    : defaultQueueScheduleSettings;
  const canAutoFillActiveQueue = useMemo(() => {
    const accountReadiness = runnerAccountReadiness(tumblrAccounts, runnerSettings.tumblrAccountId);
    if (!accountReadiness.ready) {
      return false;
    }
    return queueRefillAvailabilityPreview({
      queue: submissionQueue,
      sourceAds: normalizeStoredState(stored).ads,
      submitTargets,
      queueName: activeQueueName,
      targetDepth: defaultAutomationRefillTargetDepth,
    }).availableCount > 0;
  }, [activeQueueName, runnerSettings.tumblrAccountId, stored, submissionQueue, submitTargets, tumblrAccounts]);
  const runnerConnectionLabel = useMemo(() => {
    if (localCompanion?.ok) {
      if (localCompanion.running) {
        return "Local companion running";
      }
      if (localCompanion.status === "error") {
        return "Local companion needs attention";
      }
      if (localCompanion.status === "watching") {
        return localCompanion.queueName ? `Local companion watching: ${localCompanion.queueName}` : "Local companion watching";
      }
      return "Local companion connected";
    }
    const localRunner = runnerState?.local_runner;
    return localRunner?.online
      ? `Local runner online${localRunner.queue_name ? `: ${localRunner.queue_name}` : ""}`
      : "Local runner offline";
  }, [localCompanion, runnerState]);
  const runnerActivity = useMemo(() => {
    if (localCompanion?.ok) {
      return {
        status: localCompanion.running ? "Running" : localCompanion.status === "error" ? "Needs attention" : localCompanion.watching ? "Watching" : "Connected",
        detail: localCompanion.running
          ? `Working through ${localCompanion.queueName || activeQueueName}.`
          : localCompanion.status === "error"
            ? localCompanion.lastError || "Last local run failed. Check the latest queue item notes."
            : localCompanion.watching
              ? `Ready for new items in ${localCompanion.queueName || activeQueueName}.`
              : "Connected on this computer.",
      };
    }
    const localRunner = runnerState?.local_runner;
    if (localRunner?.online) {
      return {
        status: localRunner.status === "running" ? "Running" : localRunner.watching ? "Watching" : "Online",
        detail: localRunner.watching
          ? `Runner is watching ${localRunner.queue_name || activeQueueName}.`
          : "Runner heartbeat is online.",
      };
    }
    return {
      status: "Offline",
      detail: runnerSettings.headless ? "Headless mode is enabled. Start the local runner to run in the background." : "Start the local runner on this computer.",
    };
  }, [activeQueueName, localCompanion, runnerSettings.headless, runnerState]);
  const scheduleRunnerReadiness = useMemo(
    () =>
      scheduleRunnerReadinessFromState({
        activeQueueName,
        offlineDetail: runnerActivity.detail,
        localCompanion,
        runnerState,
      }),
    [activeQueueName, localCompanion, runnerActivity, runnerState],
  );
  const canLaunchLocalRunner = !localCompanion?.ok;
  const localCompanionQueueStatus = (status: LocalCompanionStatus) => {
    if (status.running) {
      const mode = status.lastRun?.headless ? "headless" : "visible";
      return `Local companion is running the queue ${mode}.`;
    }
    if (status.lastError) {
      return status.lastError;
    }
    if (status.status === "watching") {
      return status.queueName ? `Local companion is watching ${status.queueName}.` : "Local companion is watching.";
    }
    return "Local companion is connected.";
  };
  const localCompanionUserDataDir = (userDataDir: string) => {
    const value = userDataDir.trim();
    const normalized = value.replace(/\\/g, "/");
    return normalized.startsWith("/app/") ? "" : value;
  };
  const shouldReplaceStaleLocalRunnerStatus = (status: string) =>
    status.includes("Local companion was not detected") ||
    status.includes("Local runner command copied") ||
    status.includes("Local runner setup command copied") ||
    status.includes("Opening the installed local runner");
  const activeDestinationBlogRef = useRef(activeAd.destinationBlog);
  const activeBlogTags = tagProfiles[activeAd.destinationBlog] ?? defaultTagProfiles[activeAd.destinationBlog] ?? [];
  const checklistTags = uniqueTags([...activeBlogTags, ...activeAd.tags]);
  const mediaLibraryAssets = useMemo(() => mediaLibraryFromAdvertisements(stored.ads, activeAd.id), [activeAd.id, stored.ads]);
  const { queueSavedDraft, queueTargets } = useEditorQueueActions({
    activeAd,
    activeQueueName,
    activeView,
    runnerSettings,
    stored,
    submitTargets,
    syncQueueItem,
    setActiveView,
    setEditorQueueConfirmation,
    setQueueStatus,
    setSelectedQueueName,
    setStored,
    setSubmissionQueue,
    setValidation,
  });
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
    if (backendOwnsWorkspaceState) {
      clearBackendOwnedLocalStorage();
    }
  }, [backendOwnsWorkspaceState]);

  useEffect(() => {
    storedRef.current = stored;
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveStoredState(stored);
  }, [backendOwnsWorkspaceState, stored]);

  useEffect(() => {
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveSubmitTargets(submitTargets);
  }, [backendOwnsWorkspaceState, submitTargets]);

  useEffect(() => {
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveSubmissionQueue(submissionQueue);
  }, [backendOwnsWorkspaceState, submissionQueue]);

  useEffect(() => {
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveQueueDefinitions(queueOptions);
  }, [backendOwnsWorkspaceState, queueOptions]);

  useEffect(() => {
    if (!queueOptions.length) {
      if (selectedQueueName) {
        setSelectedQueueName("");
      }
      return;
    }
    if (!queueOptions.some((queue) => queue.name === selectedQueueName)) {
      setSelectedQueueName(queueOptions[0]?.name ?? "");
    }
  }, [queueOptions, selectedQueueName]);

  useEffect(() => {
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveTagProfiles(tagProfiles);
  }, [backendOwnsWorkspaceState, tagProfiles]);

  useEffect(() => {
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveTemplates(templates);
  }, [backendOwnsWorkspaceState, templates]);

  useEffect(() => {
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveTumblrAccounts(tumblrAccounts);
  }, [backendOwnsWorkspaceState, tumblrAccounts]);

  useEffect(() => {
    runnerSettingsRef.current = runnerSettings;
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveRunnerSettings(runnerSettings);
  }, [backendOwnsWorkspaceState, runnerSettings]);

  useEffect(() => {
    if (backendOwnsWorkspaceState) {
      return;
    }

    saveQueueScheduleSettings(queueScheduleSettings);
  }, [backendOwnsWorkspaceState, queueScheduleSettings]);

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
      .then(() => {
        setApiAvailable(true);
        setSaveStatus((current) => current === "Could not save operational settings. Try again." ? "Operational settings saved" : current);
      })
      .catch(() => {
        setApiAvailable(false);
        setSaveStatus("Could not save operational settings. Try again.");
      });
  }, [authUser, backendStateLoaded, queueOptions, queueScheduleSettings, runnerSettings, submitTargets, tagProfiles]);

  async function saveDiscordWebhook(webhookUrl: string) {
    try {
      const status = await saveDiscordWebhookSettings(webhookUrl);
      setApiAvailable(true);
      setRunnerSettings((current) => ({ ...current, discordWebhookConfigured: status.configured }));
      const message = status.configured ? "Discord webhook saved." : "Discord webhook cleared.";
      setSaveStatus(message);
      return { ok: true, message };
    } catch (error) {
      setApiAvailable(false);
      const message = error instanceof ApiError ? error.message : "Could not save Discord webhook. Try again.";
      setSaveStatus(message);
      return { ok: false, message };
    }
  }

  async function testDiscordWebhook(webhookUrl?: string) {
    try {
      await testDiscordWebhookSettings(webhookUrl);
      setApiAvailable(true);
      const message = "Discord test sent.";
      setSaveStatus(message);
      return { ok: true, message };
    } catch (error) {
      setApiAvailable(false);
      const message = error instanceof ApiError ? error.message : "Could not send Discord test. Check the webhook URL.";
      setSaveStatus(message);
      return { ok: false, message };
    }
  }

  useEffect(() => {
    if (!authUser) {
      setAccountSetupRouteApplied(false);
      return;
    }

    if (!backendStateLoaded || accountSetupRouteApplied) {
      return;
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
        const [advertisementResponse, backendTemplates, backendQueue, backendLogs, backendSettings] = await Promise.all([
          loadBackendAdvertisements(),
          loadBackendTemplates(),
          loadBackendQueue(),
          loadRunnerLogs(),
          loadBackendAppSettings(),
        ]);
        let backendTumblrAccounts: TumblrAccount[] = [];
        let accountsLoadFailed = false;
        try {
          backendTumblrAccounts = await loadBackendTumblrAccounts();
        } catch {
          accountsLoadFailed = true;
        }

        if (cancelled) {
          return;
        }

        const backendAds = advertisementResponse;
        const nextStored = normalizeStoredState({
          ads: backendAds,
          activeAdId: stored.activeAdId,
        });

        setStored(nextStored);
        setTemplates(backendTemplates);
        setSubmissionQueue(backendQueue);
        setSubmitTargets(uniqueSubmitTargets(backendSettings.submitTargets ?? []));
        setQueueDefinitions(
          uniqueQueueDefinitions(backendSettings.queueDefinitions ?? [], backendQueue),
        );
        setTagProfiles(normalizeTagProfiles(backendSettings.tagProfiles ?? {}));
        setRunnerSettings(normalizeRunnerSettings(backendSettings.runnerSettings ?? {}));
        setQueueScheduleSettings(
          backendSettings.queueScheduleSettings
            ? normalizeQueueScheduleSettings(backendSettings.queueScheduleSettings)
            : normalizeQueueScheduleSettings({}),
        );
        setRunnerLogs(backendLogs);
        setTumblrAccounts(backendTumblrAccounts);
        if (accountsLoadFailed) {
          setAccountStatus("Could not load Tumblr accounts from the backend. Reopen Accounts or check the API before running automation.");
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
    if (!["dashboard", "queue", "runner", "logs"].includes(activeView)) {
      return;
    }

    void refreshRunnerStatus({ quiet: true });
    void refreshLocalCompanionStatus({ quiet: true });
    const intervalId = window.setInterval(() => {
      void refreshRunnerStatus({ quiet: true });
      void refreshLocalCompanionStatus({ quiet: true });
    }, runnerState?.running ? 3000 : 15000);

    return () => window.clearInterval(intervalId);
  }, [activeView, runnerState?.running]);

  function syncAdvertisement(advertisement: Advertisement) {
    return saveAdvertisement(advertisement)
      .then(() => {
        setApiAvailable(true);
        return true;
      })
      .catch(() => {
        setApiAvailable(false);
        return false;
      });
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

  async function requestPasswordReset(event: FormEvent) {
    event.preventDefault();
    try {
      const reset = await requestInkwellPasswordReset({ email: loginForm.email });
      setLoginStatus(reset.message);
      setLoginMode("login");
    } catch (error) {
      setLoginStatus(error instanceof ApiError ? error.message : "Could not start password reset.");
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
    if (!backendOwnsWorkspaceState) {
      setSubmissionQueue((current) =>
        current.some((queueItem) => queueItem.id === item.id)
          ? current.map((queueItem) => (queueItem.id === item.id ? item : queueItem))
          : [item, ...current],
      );
      return Promise.resolve(item);
    }

    return saveQueueItem(item)
      .then((saved) => {
        setSubmissionQueue((current) =>
          current.some((queueItem) => queueItem.id === saved.id)
            ? current.map((queueItem) => (queueItem.id === saved.id ? saved : queueItem))
            : [saved, ...current],
        );
        setApiAvailable(true);
        return saved;
      })
      .catch(() => {
        setApiAvailable(false);
        return null;
      });
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
      setSaveStatus("Saved just now");
    }
  }

  function saveCurrentAsTemplate() {
    if (!hasLibraryContent(activeAd)) {
      setTemplateStatus("Write an advertisement first, then save it as a reusable template.");
      return;
    }

    const template = templateFromAdvertisement(activeAd, activeQueueName);
    setTemplates((current) => [template, ...current]);
    syncTemplate(template);
    setEditingTemplateId(template.id);
    setTemplateDraft({ name: template.name, content: template.content });
    setTemplateStatus(`Saved ${template.name} as a reusable template.`);
  }

  function clearTemplateDraft() {
    setEditingTemplateId(null);
    setTemplateDraft({ name: "", content: "" });
    setTemplateStatus("");
  }

  function editTemplate(template: SavedTemplate) {
    setEditingTemplateId(template.id);
    setTemplateDraft({ name: template.name, content: template.content });
    setTemplateStatus(`Editing ${template.name}.`);
  }

  function saveTemplateDraft(event: FormEvent, contentHtml = templateDraft.content) {
    event.preventDefault();
    const existingTemplate = editingTemplateId ? templates.find((template) => template.id === editingTemplateId) : null;
    const template = normalizeTemplate({
      ...existingTemplate,
      id: editingTemplateId ?? undefined,
      name: templateDraft.name,
      content: contentHtml,
      queueName: existingTemplate?.queueName ?? activeQueueName,
      updatedAt: new Date().toISOString(),
    });

    setTemplates((current) =>
      editingTemplateId ? current.map((item) => (item.id === editingTemplateId ? template : item)) : [template, ...current],
    );
    syncTemplate(template);
    setEditingTemplateId(template.id);
    setTemplateDraft({ name: template.name, content: template.content });
    setTemplateStatus(editingTemplateId ? `Updated ${template.name}.` : `Saved ${template.name}.`);
  }

  function applyTemplate(template: SavedTemplate) {
    updateActiveAd(applyTemplateToAdvertisement(template));
    if (template.queueName && queueOptions.some((queue) => queue.name === template.queueName)) {
      setSelectedQueueName(template.queueName);
    }
    setTemplateStatus(`Applied ${template.name} to the current submission.`);
    setActiveView("editor");
  }

  function deleteTemplate(id: string) {
    setTemplates((current) => current.filter((template) => template.id !== id));
    if (editingTemplateId === id) {
      clearTemplateDraft();
    }
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

  function createSampleAdvertisement() {
    const next: Advertisement = {
      ...emptyAd(),
      title: "Open canons photo ad",
      campaignName: "Summer wanted ads",
      content:
        "<p>Our supernatural town is open for canon applications, original families, and slow-burn plotlines.</p><p>Looking for writers who enjoy active plotting, flexible pacing, and character-first drama.</p>",
      forumUrl: "https://your-forum.jcink.net",
      tags: ["roleplay", "jcink", "wanted ad"],
      imageCaption:
        "<p>Our supernatural town is open for canon applications, original families, and slow-burn plotlines.</p><p>Looking for writers who enjoy active plotting, flexible pacing, and character-first drama.</p>",
      updatedAt: new Date().toISOString(),
    };
    activeDestinationBlogRef.current = next.destinationBlog;
    setValidation([]);
    setSaveStatus("Example ad loaded");
    setStored((current) => ({
      ads: [next, ...current.ads],
      activeAdId: next.id,
    }));
    syncAdvertisement(next);
    setActiveView("editor");
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

  async function archiveDraft(id: string, archived: boolean) {
    const { nextStored, updatedDraft } = applyArchiveDraftState(storedRef.current, id, archived);
    if (!updatedDraft) {
      return;
    }
    const attemptedDraft = updatedDraft;
    const previousDraft = stored.ads.find((ad: Advertisement) => ad.id === id);
    const archivedBeforeAttempt = previousDraft?.archived ?? false;
    const updatedAtBeforeAttempt = previousDraft?.updatedAt ?? attemptedDraft.updatedAt;
    if (backendOwnsWorkspaceState) {
      setSaveStatus(archived ? "Archiving saved ad..." : "Restoring saved ad...");
      try {
        await saveAdvertisement(updatedDraft);
        storedRef.current = nextStored;
        setStored(nextStored);
        setApiAvailable(true);
        setSaveStatus(archived ? "Archived saved ad" : "Restored saved ad");
      } catch {
        setApiAvailable(false);
        setSaveStatus(archived ? "Could not archive saved ad. Try again." : "Could not restore saved ad. Try again.");
      }
      return;
    }

    storedRef.current = nextStored;
    setStored(nextStored);
    const synced = await syncAdvertisement(attemptedDraft);
    if (!synced) {
      const latestState = storedRef.current;
      const latestDraftState = latestState.ads.find((ad: Advertisement) => ad.id === id);
      if (
        latestDraftState &&
        latestDraftState.archived === archived &&
        latestDraftState.updatedAt === attemptedDraft.updatedAt
      ) {
        const revertedStored = {
          ...latestState,
          ads: latestState.ads.map((ad) =>
            ad.id !== id
              ? ad
              : {
                  ...ad,
                  archived: archivedBeforeAttempt,
                  updatedAt: updatedAtBeforeAttempt,
                },
          ),
        };
        storedRef.current = revertedStored;
        setStored(revertedStored);
      }

      setSaveStatus(archived ? "Could not archive saved ad. Try again." : "Could not restore saved ad. Try again.");
      return;
    }
    setSaveStatus(archived ? "Archived saved ad" : "Restored saved ad");
  }

  function saveDraft() {
    updateActiveAd({ status: "draft" });
    setValidation([]);
    setSaveStatus("Saved just now");
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
    setQueueScheduleSettings((current) => {
      const { [currentName]: currentQueueSettings, [nextName]: _existingNextSettings, ...remainingPerQueue } = current.perQueue;
      if (!currentQueueSettings) {
        return current;
      }
      return {
        ...current,
        perQueue: {
          ...remainingPerQueue,
          [nextName]: currentQueueSettings,
        },
      };
    });
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
    setQueueScheduleSettings((current) => {
      if (!current.perQueue[queueName]) {
        return current;
      }
      const { [queueName]: _removedQueueSettings, ...remainingPerQueue } = current.perQueue;
      return { ...current, perQueue: remainingPerQueue };
    });
    setSelectedQueueName(nextSelectedQueue);
    removableItems.forEach((item) => {
      void removeQueueItem(item.id).catch(() => setApiAvailable(false));
    });
    setQueueStatus(`Deleted ${queueName}.`);
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
      notes: "Use the local runner to verify this Tumblr session before queue runs.",
    });
    if (!normalized) {
      setAccountStatus("Enter a Tumblr account name or blog name first.");
      return;
    }

    setTumblrAccounts((current) => upsertTumblrAccount(current, normalized));
    syncTumblrAccount(normalized);
    setAccountDraft({ displayName: "", blogName: "" });
    setAccountStatus(`Added ${normalized.displayName}. Use the local runner test flow to log into Tumblr on this computer.`);
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
    const account = tumblrAccounts.find((item) => item.id === id);
    if (!account || account.status !== "connected") {
      setAccountStatus("Connect that Tumblr account before selecting it for queue runs.");
      return;
    }

    setRunnerSettings((current) => ({ ...current, tumblrAccountId: id }));
    setAccountStatus(`Selected ${account.displayName} for queue runs.`);
  }

  async function launchTumblrAccountLogin(id: string) {
    const account = tumblrAccounts.find((item) => item.id === id);
    if (!account) {
      setAccountStatus("Select or create a Tumblr account first.");
      return;
    }

    try {
      const companion = localCompanion ?? await refreshLocalCompanionStatus({ quiet: true });
      if (!companion?.ok) {
        setAccountStatus("Start or install the local runner on this computer, then click Connect again.");
        return;
      }

      const login = await launchLocalCompanionLogin({
        accountId: account.id,
        userDataDir: localCompanionUserDataDir(account.userDataDir),
        slowMo: runnerSettings.slowMo,
      });
      setLocalCompanion(login);
      const checking: TumblrAccount = {
        ...account,
        status: "checking",
        lastCheckedAt: new Date().toISOString(),
        notes: "Tumblr login window opened on this computer. Finish login, leave Tumblr dashboard open, then mark this account connected.",
      };
      setTumblrAccounts((current) => upsertTumblrAccount(current, checking));
      syncTumblrAccount(checking);
      setAccountStatus(login.message || "Tumblr login window opened on this computer. Finish login, then mark this account connected.");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Local companion was not detected on this computer.";
      setLocalCompanion(null);
      setAccountStatus(`${message} Start or install the local runner, then click Connect again.`);
    }
  }

  async function checkTumblrAccountLogin(id: string) {
    const account = tumblrAccounts.find((item) => item.id === id);
    if (!account) {
      setAccountStatus("Select or create a Tumblr account first.");
      return;
    }

    setAccountStatus(`Checking saved Tumblr login for ${account.displayName}...`);

    try {
      const checked = await checkTumblrAccountHealth(account);
      setTumblrAccounts((current) => upsertTumblrAccount(current, checked));
      if (checked.status === "connected") {
        setRunnerSettings((current) => ({ ...current, tumblrAccountId: checked.id }));
      }
      setApiAvailable(true);
      setAccountStatus(checked.notes);
    } catch (error) {
      setApiAvailable(false);
      const message = error instanceof ApiError ? error.message : "Could not check saved Tumblr login. Start the Python API and try again.";
      setAccountStatus(message);
    }
  }

  async function checkTumblrAccountHealth(account: TumblrAccount) {
    const response = await checkTumblrLogin(account.id);
    const fallbackStatus: TumblrAccount["status"] =
      response.login.mode === "remote" ? (response.login.loggedIn ? "connected" : "needs-login") : account.status;
    const checked = response.login.mode === "remote" && response.login.account
      ? fromApiTumblrAccount(response.login.account)
      : {
          ...account,
          status: fallbackStatus,
          lastCheckedAt: new Date().toISOString(),
          notes: response.login.message,
        };
    if (response.login.mode === "remote" && response.login.launchUrl) {
      window.open(response.login.launchUrl, "_blank", "noopener,noreferrer");
    }
    return checked;
  }

  async function checkAllTumblrAccountLogins() {
    if (!tumblrAccounts.length) {
      setAccountStatus("Add a Tumblr account before checking saved logins.");
      return;
    }

    setAccountStatus(`Checking ${tumblrAccounts.length} saved Tumblr login${tumblrAccounts.length === 1 ? "" : "s"}...`);
    let connectedCount = 0;
    let checkedCount = 0;

    for (const account of tumblrAccounts) {
      try {
        const checked = await checkTumblrAccountHealth(account);
        checkedCount += 1;
        if (checked.status === "connected") {
          connectedCount += 1;
          setRunnerSettings((current) => current.tumblrAccountId ? current : { ...current, tumblrAccountId: checked.id });
        }
        setTumblrAccounts((current) => upsertTumblrAccount(current, checked));
        setApiAvailable(true);
      } catch {
        const failed: TumblrAccount = {
          ...account,
          status: "needs-login",
          lastCheckedAt: new Date().toISOString(),
          notes: "Saved Tumblr login could not be verified.",
        };
        checkedCount += 1;
        setTumblrAccounts((current) => upsertTumblrAccount(current, failed));
        syncTumblrAccount(failed);
      }
    }

    setAccountStatus(`Checked ${checkedCount} account${checkedCount === 1 ? "" : "s"}: ${connectedCount} connected.`);
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

  async function prepareAutomationQueue(options: { queueOverride?: SubmissionQueueItem[] } = {}) {
    const accountReadiness = runnerAccountReadiness(tumblrAccounts, runnerSettingsRef.current.tumblrAccountId);
    const queue = options.queueOverride ?? submissionQueue;
    const preparation = await prepareAutomationQueueForRun({
      queue,
      sourceAds: normalizeStoredState(storedRef.current).ads,
      submitTargets,
      queueName: activeQueueName,
      tumblrAccountId: accountReadiness.readyAccount?.id || runnerSettingsRef.current.tumblrAccountId,
      targetDepth: defaultAutomationRefillTargetDepth,
      saveQueueItem: syncQueueItem,
    });
    if (preparation.status === "blocked") {
      if (preparation.reconciledQueue) {
        setSubmissionQueue(preparation.reconciledQueue);
      }
      setQueueStatus(preparation.message);
      return null;
    }
    setSubmissionQueue(preparation.preparedQueue.queue);
    return preparation.preparedQueue;
  }

  function updateActiveQueueScheduleSettings(patch: Partial<QueueSchedulePreference>) {
    setQueueScheduleSettings((current) => {
      if (!activeQueueName) {
        return {
          ...current,
          ...patch,
          timezone: "America/New_York",
        };
      }

      const currentQueueSettings = current.perQueue[activeQueueName] ?? {
        enabled: current.enabled,
        dailyTime: current.dailyTime,
        timezone: current.timezone,
      };
      return {
        ...current,
        perQueue: {
          ...current.perQueue,
          [activeQueueName]: {
            ...currentQueueSettings,
            ...patch,
            timezone: "America/New_York",
          },
        },
      };
    });
  }

  async function refreshLocalCompanionStatus(options: { quiet?: boolean } = {}) {
    try {
      const status = await loadLocalCompanionStatus();
      setLocalCompanion(status);
      if (!options.quiet) {
        setQueueStatus(localCompanionQueueStatus(status));
      } else if (status.ok) {
        setQueueStatus((current) => shouldReplaceStaleLocalRunnerStatus(current) ? localCompanionQueueStatus(status) : current);
      }
      return status;
    } catch {
      setLocalCompanion(null);
      return null;
    }
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

  function requireSelectedConnectedRunnerAccount() {
    const accountReadiness = runnerAccountReadiness(tumblrAccounts, runnerSettingsRef.current.tumblrAccountId);
    if (accountReadiness.ready) {
      return true;
    }
    setQueueStatus(accountReadiness.blocker || "Select a connected Tumblr account before starting the runner.");
    setActiveView("accounts");
    return false;
  }

  async function prepareLocalRunnerCommand(options: { copy?: boolean; target?: "run" | "setup"; fallbackReason?: string; submit?: boolean; testRun?: boolean; preparedQueue?: PreparedAutomationQueue; queueOverride?: SubmissionQueueItem[] } = {}) {
    if (!requireSelectedConnectedRunnerAccount()) {
      return;
    }
    const target = options.target ?? "run";
    const preparedQueue = target === "setup"
      ? null
      : options.preparedQueue ?? await prepareAutomationQueue({ queueOverride: options.queueOverride });
    if (target !== "setup" && !preparedQueue) {
      return;
    }

    try {
      const localRunner = await loadLocalRunnerCommand(activeQueueName, { headless: runnerSettingsRef.current.headless, submit: options.submit });
      const [logs, backendQueue] = await Promise.all([loadRunnerLogs(), loadBackendQueue()]);
      setRunnerLogs(logs);
      setSubmissionQueue(backendQueue);
      setApiAvailable(true);
      const commandToCopy = target === "setup" ? localRunner.autoStartCommand || localRunner.command : localRunner.command;
      const copied = options.copy ? await copyTextToClipboard(commandToCopy).catch(() => false) : false;
      const tokenWarning = localRunner.tokenConfigured ? "" : "Railway is missing INWELL_LOCAL_RUNNER_TOKEN. ";
      const copyMessage = copied ? `${target === "setup" ? "Local runner setup command" : "Local runner command"} copied. ` : "";
      const fallbackMessage = options.fallbackReason ? `${options.fallbackReason} ` : "";
      const automationMessage = preparedQueue ? automationQueueRunStatusMessage(preparedQueue.addedCount, preparedQueue.attentionCount) : "";
      if (localRunner.usesDeviceToken) {
        const actionMessage = copied && target === "setup"
          ? "Open PowerShell in the repo folder, paste it, and press Enter to install the Windows login task. Keep the copied command private."
          : copied
            ? options.testRun
              ? "Open PowerShell in the repo folder, paste it, and press Enter to start a test run that prepares Tumblr without submitting. Keep the copied command private."
              : options.submit === false
                ? "Open PowerShell in the repo folder, paste it, and press Enter to prepare Tumblr without submitting. Turn on Approve live posting when you want the runner to submit. Keep the copied command private."
              : "Open PowerShell in the repo folder, paste it, and press Enter to start the local runner. Keep the copied command private."
            : "Use Run or Setup to copy a fresh private device-token command.";
        setQueueStatus(`${automationMessage}${copyMessage}${fallbackMessage}${localRunner.message} ${actionMessage}`);
        return;
      }
      const autoStartMessage = localRunner.autoStartCommand ? ` Auto-start: ${localRunner.autoStartCommand}` : "";
      setQueueStatus(`${automationMessage}${copyMessage}${fallbackMessage}${localRunner.message} ${tokenWarning}Command: ${localRunner.command}${autoStartMessage}`);
    } catch (error) {
      setApiAvailable(false);
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not prepare the local runner command.";
      setQueueStatus(`Could not prepare local runner command. ${message}`);
    }
  }

  async function startRunner(options: { queueOverride?: SubmissionQueueItem[]; submit?: boolean } = {}) {
    const submit = options.submit ?? runnerSettingsRef.current.submit;
    const testRun = options.submit === false;
    if (!requireSelectedConnectedRunnerAccount()) {
      return;
    }
    const preparedQueue = await prepareAutomationQueue({ queueOverride: options.queueOverride });
    if (!preparedQueue) {
      return;
    }

    const companionRun = await startLocalCompanionRun({
      activeQueueName,
      companion: localCompanion,
      headless: runnerSettings.headless,
      submit,
      testRun,
      refreshCompanionStatus: () => refreshLocalCompanionStatus({ quiet: true }),
      runCompanion: runLocalCompanion,
    });
    if (companionRun.kind === "started") {
      setLocalCompanion(companionRun.companion);
      setQueueStatus(`${automationQueueRunStatusMessage(preparedQueue.addedCount, preparedQueue.attentionCount)}${companionRun.queueStatus}`);
      [2500, 6000].forEach((delay) => {
        window.setTimeout(() => {
          void refreshLocalCompanionStatus({ quiet: true });
        }, delay);
      });
      void refreshRunnerStatus({ quiet: true });
      return;
    }
    if (companionRun.kind === "companion-error") {
      setLocalCompanion(companionRun.companion);
      setQueueStatus(`${automationQueueRunStatusMessage(preparedQueue.addedCount, preparedQueue.attentionCount)}${companionRun.queueStatus}`);
      return;
    }

    const offlineFallbackReason = submit
      ? "Local companion was not detected on this computer, so the queue was not started and Discord will not post until a live local runner command runs."
      : testRun
        ? "Local companion was not detected on this computer, so the test run was not started."
        : "Local companion was not detected on this computer, so the prep run was not started.";

    await prepareLocalRunnerCommand({
      copy: true,
      target: "run",
      queueOverride: options.queueOverride,
      preparedQueue,
      submit,
      testRun,
      fallbackReason: offlineFallbackReason,
    });
  }

  async function startTestRunner() {
    await startRunner({ submit: false });
  }

  function launchLocalRunnerProtocol() {
    window.location.href = "inkwell-runner://start";
    setQueueStatus("Opening the installed local runner. If Windows asks, allow Inkwell Local Runner.");
    [1000, 2500, 5000, 8000].forEach((delay) => {
      window.setTimeout(() => {
        void refreshLocalCompanionStatus({ quiet: true });
      }, delay);
    });
  }

  async function downloadLocalRunnerInstaller() {
    try {
      const { blob, filename } = await downloadLocalRunnerPackage(activeQueueName, { headless: runnerSettings.headless, submit: runnerSettings.submit });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setApiAvailable(true);
      setQueueStatus("Local runner installer downloaded. Unzip it, double-click install.cmd once, then Run will connect to this computer.");
    } catch (error) {
      setApiAvailable(false);
      const message = error instanceof ApiError ? error.message : "Could not download the local runner installer.";
      setQueueStatus(`Could not download local runner installer. ${message}`);
    }
  }

  async function copyLocalRunnerSetup() {
    await prepareLocalRunnerCommand({ copy: true, target: "setup", submit: runnerSettings.submit });
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

  function applyMediaAsset(asset: MediaLibraryAsset) {
    if (asset.kind === "photo") {
      updateActiveAd({
        postType: "photo",
        imageName: asset.imageName,
        imageDataUrl: asset.imageDataUrl,
        videoName: "",
        videoUrl: "",
      });
      return;
    }

    updateActiveAd({
      postType: "video",
      imageName: "",
      imageDataUrl: "",
      videoName: asset.videoName,
      videoUrl: asset.videoUrl,
    });
  }

  const submissionComplete = activeAd.status === "submitted";
  const pageTitles = workspacePageTitles(activeAd.title);
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
        mode={loginMode}
        form={loginForm}
        status={loginStatus}
        onFormChange={(patch) => setLoginForm((current) => ({ ...current, ...patch }))}
        onModeChange={(mode) => {
          setLoginMode(mode);
          setLoginStatus("");
        }}
        onLogin={loginInkwell}
        onRegister={registerInkwell}
        onPasswordReset={requestPasswordReset}
      />
    );
  }

  return (
    <main className="app-shell" data-theme={colorTheme} data-density={workspaceDensity}>
      <AppSidebar
        activeView={activeView}
        user={authUser}
        onLogout={logoutInkwell}
        onViewChange={setActiveView}
        counts={{ saved: libraryAds.length, queue: submissionQueue.length, accounts: tumblrAccounts.length, logs: runnerLogs.length }}
      />

      <section className={activeView === "saved" ? "workspace workspace-saved" : "workspace"}>
        <WorkspaceTopbar
          actionsVisible={activeView === "editor"}
          eyebrow={pageTitles[activeView].eyebrow}
          title={pageTitles[activeView].title}
          saveStatus={saveStatus}
          skin={colorSkin}
          theme={colorTheme}
          density={workspaceDensity}
          onBackToOperations={!["dashboard", "editor", "docs"].includes(activeView) ? () => setActiveView("dashboard") : undefined}
          onCreateDraft={createDraft}
          onSaveDraft={saveDraft}
          onSkinChange={selectColorSkin}
          onToggleTheme={toggleColorTheme}
          onDensityChange={setWorkspaceDensity}
        />

        {activeView === "editor" ? (
          <EditorWorkspace
            activeAd={activeAd}
            activeSubmitTarget={activeSubmitTarget}
            checklistTags={checklistTags}
            customTag={customTag}
            editor={editor}
            mediaLibraryAssets={mediaLibraryAssets}
            newSubmitUrl={newSubmitUrl}
            queueConfirmation={editorQueueConfirmation}
            queueOptions={queueOptions}
            selectedQueueName={selectedQueueName || activeQueueName}
            submissionComplete={submissionComplete}
            submitTargetStatus={submitTargetStatus}
            targetOptions={targetOptions}
            templates={templates}
            toolbarButtons={toolbarButtons}
            validation={validation}
            saveStatus={saveStatus}
            onAddCustomTag={addCustomTag}
            onAddSubmitTarget={addSubmitTarget}
            onApplyTemplate={applyTemplate}
            onDismissQueueConfirmation={() => setEditorQueueConfirmation(null)}
            onImageUpload={handleImageUpload}
            onApplyMediaAsset={applyMediaAsset}
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
        {activeView === "dashboard" ? (
          <OperationsDashboard
            activeQueueName={activeQueueName}
            displayName={authUser.displayName || authUser.email}
            queueItems={submissionQueue}
            runnerActivity={runnerActivity}
            runnerConnectionLabel={runnerConnectionLabel}
            scheduleRunnerReadiness={scheduleRunnerReadiness}
            runnerSubmitApproved={runnerSettings.submit}
            savedDraftCount={libraryAds.length}
            savedDrafts={libraryAds}
            selectedTumblrAccountId={runnerSettings.tumblrAccountId}
            tumblrAccounts={tumblrAccounts}
            onCreateSampleAd={createSampleAdvertisement}
            onNavigate={setActiveView}
          />
        ) : null}
        {activeView === "queue" ? (
          <QueueWorkspace
            activeQueue={activeQueue}
            activeQueueName={activeQueueName}
            queueOptions={queueOptions}
            queueStatus={queueStatus}
            queueTransitionBusy={isQueueBusy(activeQueueName)}
            queueScheduleSettings={activeQueueScheduleSettings}
            runnerActivity={runnerActivity}
            scheduleRunnerReadiness={scheduleRunnerReadiness}
            runnerSubmitApproved={runnerSettings.submit}
            savedDraftCount={libraryAds.length}
            sourceAds={stored.ads}
            submitTargets={submitTargets}
            selectedTumblrAccountId={runnerSettings.tumblrAccountId}
            tumblrAccounts={tumblrAccounts}
            runnerLogs={runnerLogs}
            onEditQueueItem={editQueuedSubmission}
            onRenameQueue={renameQueueDefinition}
            onSelectQueue={setSelectedQueueName}
            onQueueScheduleSettingsChange={updateActiveQueueScheduleSettings}
            onRetryQueueItemTestRun={retryQueueItemTestRun}
            onBulkUpdateQueueItems={bulkUpdateQueueItems}
            onUpdateQueueItem={updateQueueItem}
            onCreateSubmission={() => setActiveView("editor")}
            onManageBlogs={() => setActiveView("queue-settings")}
            onManageAccounts={() => setActiveView("accounts")}
            onOpenSavedLibrary={() => setActiveView("saved")}
            onOpenRunner={() => setActiveView("runner")}
          />
        ) : null}
        {activeView === "runner" ? (
          <RunnerWorkspace
            activeQueue={activeQueue}
            activeQueueName={activeQueueName}
            queueOptions={queueOptions}
            queueStatus={queueStatus}
            discordWebhookConfigured={runnerSettings.discordWebhookConfigured}
            localCompanion={localCompanion}
            runnerActivity={runnerActivity}
            runnerConnectionLabel={runnerConnectionLabel}
            scheduleRunnerReadiness={scheduleRunnerReadiness}
            runnerHeadless={runnerSettings.headless}
            runnerLogs={runnerLogs}
            runnerState={runnerState}
            runnerSubmitApproved={runnerSettings.submit}
            selectedTumblrAccountId={runnerSettings.tumblrAccountId}
            showLaunchLocalRunner={canLaunchLocalRunner}
            canAutoFillQueue={canAutoFillActiveQueue}
            tumblrAccounts={tumblrAccounts}
            onCopyLocalRunnerSetup={copyLocalRunnerSetup}
            onDownloadLocalRunner={downloadLocalRunnerInstaller}
            onLaunchLocalRunner={launchLocalRunnerProtocol}
            onNavigateAccounts={() => setActiveView("accounts")}
            onNavigateLogs={() => setActiveView("logs")}
            onNavigateQueue={() => setActiveView("queue")}
            onRunnerHeadlessChange={(headless) => setRunnerSettings((current) => ({ ...current, headless }))}
            onRunnerSubmitApprovedChange={(submit) => setRunnerSettings((current) => ({ ...current, submit }))}
            onStartRunner={startRunner}
            onStartTestRun={startTestRunner}
          />
        ) : null}
        {activeView === "queue-settings" ? (
          <QueueManagerWorkspace
            activeQueueName={activeQueueName}
            queueNameDraft={queueNameDraft}
            queueOptions={queueOptions}
            queueScheduleSettings={queueScheduleSettings}
            queueStatus={queueStatus}
            submissionQueue={submissionQueue}
            onCreateQueue={createQueueDefinition}
            onDeleteQueue={deleteQueueDefinition}
            onQueueNameDraftChange={setQueueNameDraft}
            onSelectQueue={(queueName) => {
              setSelectedQueueName(queueName);
              setActiveView("queue");
            }}
            onCreateSubmission={() => setActiveView("editor")}
          />
        ) : null}
        {activeView === "logs" ? (
          <RunnerLogsWorkspace
            activeQueue={activeQueue}
            runnerLogs={runnerLogs}
            runnerState={runnerState}
            onClearRunnerLogs={clearRunnerLogHistory}
          />
        ) : null}

        {activeView === "settings" ? (
          <OperationalSettingsWorkspace
            activeQueueName={activeQueueName}
            queueOptions={queueOptions}
            queueScheduleSettings={queueScheduleSettings}
            runnerSettings={runnerSettings}
            tumblrAccounts={tumblrAccounts}
            onNavigate={setActiveView}
            onQueueScheduleSettingsChange={(patch) => setQueueScheduleSettings((current) => ({ ...current, ...patch }))}
            onRunnerSettingsChange={(patch) => setRunnerSettings((current) => ({ ...current, ...patch }))}
            onSaveDiscordWebhook={saveDiscordWebhook}
            onTestDiscordWebhook={testDiscordWebhook}
          />
        ) : null}

        {activeView === "docs" ? (
          <DocumentationWorkspace />
        ) : null}

        {activeView === "accounts" ? (
          <TumblrAccountsWorkspace
            accounts={tumblrAccounts}
            draft={accountDraft}
            selectedAccountId={runnerSettings.tumblrAccountId}
            status={accountStatus}
            onCreateSubmission={() => setActiveView("editor")}
            onCreateAccount={createTumblrAccount}
            onDeleteAccount={deleteTumblrAccount}
            onDraftChange={(patch) => setAccountDraft((current) => ({ ...current, ...patch }))}
            onCheckAllLogins={checkAllTumblrAccountLogins}
            onCheckLogin={checkTumblrAccountLogin}
            onLaunchLogin={launchTumblrAccountLogin}
            onMarkConnected={markTumblrAccountConnected}
            onSelectAccount={selectTumblrAccount}
          />
        ) : null}

        {activeView === "templates" ? (
          <TemplatesWorkspace
            draft={templateDraft}
            editingTemplateId={editingTemplateId}
            status={templateStatus}
            templates={templates}
            onClearTemplateDraft={clearTemplateDraft}
            onDeleteTemplate={deleteTemplate}
            onEditTemplate={editTemplate}
            onDraftChange={(patch) => setTemplateDraft((current) => ({ ...current, ...patch }))}
            onSaveTemplate={saveTemplateDraft}
            onSaveCurrentAsTemplate={saveCurrentAsTemplate}
            canSaveCurrentAsTemplate={hasLibraryContent(activeAd)}
          />
        ) : null}

        {activeView === "saved" ? (
          <SavedSubmissionsView
            activeAdId={activeAd.id}
            ads={stored.ads}
            activeQueueName={activeQueueName}
            queueOptions={queueOptions}
            onDeleteDraft={deleteDraft}
            onArchiveDraft={archiveDraft}
            onBatchQueued={() => setActiveView("queue")}
            onQueueDraft={queueSavedDraft}
            onCreateDraft={() => setActiveView("editor")}
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

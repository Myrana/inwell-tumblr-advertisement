import {
  queueDefinitionsStorageKey,
  queueScheduleSettingsStorageKey,
  runnerSettingsStorageKey,
  colorSkins,
  skinStorageKey,
  storageKey,
  submissionQueueStorageKey,
  submitTargetStorageKey,
  tagProfileStorageKey,
  templateStorageKey,
  themeStorageKey,
  tumblrAccountsStorageKey,
} from "./constants";
import { emptyAd, normalizeStoredState } from "./ads";
import { loadSubmissionQueue, normalizeQueueDefinition, uniqueQueueDefinitions } from "./queue";
import { loadSubmitTargets } from "./submitTargets";
import { loadTagProfiles } from "./tags";
import { normalizeTemplate } from "./templates";
import { normalizeTumblrAccount } from "./tumblrAccounts";
import {
  ColorTheme,
  ColorSkin,
  QueueDefinition,
  QueueSchedulePreference,
  QueueScheduleSettings,
  RemoteBrowserProvider,
  RunnerSettings,
  SavedTemplate,
  StoredState,
  SubmissionQueueItem,
  TumblrAccount,
} from "./types";

export { loadSubmissionQueue, loadSubmitTargets, loadTagProfiles };

const backendOwnedStorageKeys = [
  storageKey,
  submitTargetStorageKey,
  submissionQueueStorageKey,
  queueDefinitionsStorageKey,
  tagProfileStorageKey,
  runnerSettingsStorageKey,
  queueScheduleSettingsStorageKey,
  templateStorageKey,
  tumblrAccountsStorageKey,
];

export function loadQueueDefinitions(): QueueDefinition[] {
  try {
    const raw = localStorage.getItem(queueDefinitionsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<QueueDefinition>[]) : [];
    const definitions = Array.isArray(parsed)
      ? (parsed.map((definition) => normalizeQueueDefinition(definition)).filter(Boolean) as QueueDefinition[])
      : [];
    return uniqueQueueDefinitions(definitions);
  } catch {
    return uniqueQueueDefinitions([]);
  }
}

export function loadStoredState(): StoredState {
  const fallback = emptyAd();

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { ads: [fallback], activeAdId: fallback.id };
    }

    const parsed = JSON.parse(raw) as StoredState;
    return normalizeStoredState(parsed);
  } catch {
    return { ads: [fallback], activeAdId: fallback.id };
  }
}

export function loadRunnerSettings(): RunnerSettings {
  try {
    const raw = localStorage.getItem(runnerSettingsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<RunnerSettings>) : {};
    return normalizeRunnerSettings(parsed);
  } catch {
    return defaultRunnerSettings();
  }
}

export function normalizeRunnerSettings(value: unknown): RunnerSettings {
  const parsed = value && typeof value === "object" ? (value as Partial<RunnerSettings>) : {};
  const provider = normalizeRemoteBrowserProvider(parsed.remoteBrowserProvider);
  return {
    mediaDir: typeof parsed.mediaDir === "string" ? parsed.mediaDir : "",
    slowMo: typeof parsed.slowMo === "number" ? parsed.slowMo : 500,
    headless: Boolean(parsed.headless),
    submit: Boolean(parsed.submit),
    tumblrAccountId: typeof parsed.tumblrAccountId === "string" ? parsed.tumblrAccountId : "",
    remoteBrowserProvider: provider,
    remoteBrowserLaunchUrl: provider === "none" ? "" : typeof parsed.remoteBrowserLaunchUrl === "string" ? parsed.remoteBrowserLaunchUrl : "",
    discordWebhookConfigured: Boolean(parsed.discordWebhookConfigured),
  };
}

function defaultRunnerSettings(): RunnerSettings {
  return {
    mediaDir: "",
    slowMo: 500,
    headless: false,
    submit: false,
    tumblrAccountId: "",
    remoteBrowserProvider: "none",
    remoteBrowserLaunchUrl: "",
    discordWebhookConfigured: false,
  };
}

function normalizeRemoteBrowserProvider(_value: unknown): RemoteBrowserProvider {
  return "none";
}

export function loadTumblrAccounts(): TumblrAccount[] {
  try {
    const raw = localStorage.getItem(tumblrAccountsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<TumblrAccount>[]) : [];
    return Array.isArray(parsed)
      ? (parsed.map((account) => normalizeTumblrAccount(account)).filter(Boolean) as TumblrAccount[])
      : [];
  } catch {
    return [];
  }
}

export function loadQueueScheduleSettings(): QueueScheduleSettings {
  try {
    const raw = localStorage.getItem(queueScheduleSettingsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<QueueScheduleSettings>) : {};
    return normalizeQueueScheduleSettings(parsed);
  } catch {
    return defaultQueueScheduleSettings();
  }
}

export function normalizeQueueScheduleSettings(value: unknown): QueueScheduleSettings {
  const parsed = value && typeof value === "object" ? (value as Partial<QueueScheduleSettings>) : {};
  const fallback = normalizeQueueSchedulePreference(parsed);
  const perQueue: Record<string, QueueSchedulePreference> = {};
  if (parsed.perQueue && typeof parsed.perQueue === "object") {
    Object.entries(parsed.perQueue).forEach(([queueName, queueSettings]) => {
      const name = queueName.trim();
      if (name) {
        perQueue[name] = normalizeQueueSchedulePreference(queueSettings);
      }
    });
  }
  return {
    ...fallback,
    perQueue,
  };
}

function normalizeQueueSchedulePreference(value: unknown): QueueSchedulePreference {
  const parsed = value && typeof value === "object" ? (value as Partial<QueueSchedulePreference>) : {};
  const dailyTime = typeof parsed.dailyTime === "string" && /^\d{2}:\d{2}$/.test(parsed.dailyTime) ? parsed.dailyTime : "09:00";
  return {
    enabled: Boolean(parsed.enabled),
    dailyTime,
    timezone: "America/New_York",
  };
}

function defaultQueueScheduleSettings(): QueueScheduleSettings {
  return { enabled: false, dailyTime: "09:00", timezone: "America/New_York", perQueue: {} };
}

export function loadTemplates(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(templateStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<SavedTemplate>[]) : [];
    return Array.isArray(parsed) ? parsed.map((template) => normalizeTemplate(template)) : [];
  } catch {
    return [];
  }
}

export function loadColorTheme(): ColorTheme {
  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function loadColorSkin(): ColorSkin {
  try {
    const value = localStorage.getItem(skinStorageKey);
    return colorSkins.some((skin) => skin.value === value) ? (value as ColorSkin) : "inkwell-dark";
  } catch {
    return "inkwell-dark";
  }
}

export function saveStoredState(stored: StoredState) {
  safeSetLocalStorage(storageKey, stored);
}

export function saveSubmitTargets(value: unknown) {
  safeSetLocalStorage(submitTargetStorageKey, value);
}

export function saveSubmissionQueue(value: unknown) {
  safeSetLocalStorage(submissionQueueStorageKey, compactSubmissionQueueForStorage(value));
}

export function saveQueueDefinitions(value: unknown) {
  safeSetLocalStorage(queueDefinitionsStorageKey, value);
}

export function saveTagProfiles(value: unknown) {
  safeSetLocalStorage(tagProfileStorageKey, value);
}

export function saveRunnerSettings(value: unknown) {
  safeSetLocalStorage(runnerSettingsStorageKey, value);
}

export function saveQueueScheduleSettings(value: unknown) {
  safeSetLocalStorage(queueScheduleSettingsStorageKey, value);
}

export function saveTemplates(value: unknown) {
  safeSetLocalStorage(templateStorageKey, value);
}

export function saveTumblrAccounts(value: unknown) {
  safeSetLocalStorage(tumblrAccountsStorageKey, value);
}

export function saveColorTheme(value: ColorTheme) {
  safeSetLocalStorage(themeStorageKey, value);
}

export function saveColorSkin(value: ColorSkin) {
  safeSetLocalStorage(skinStorageKey, value);
}

export function clearBackendOwnedLocalStorage() {
  backendOwnedStorageKeys.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Local cache cleanup is best effort.
    }
  });
}

function compactSubmissionQueueForStorage(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((item: Partial<SubmissionQueueItem>) => ({
    ...item,
    runnerPayload: "",
  }));
}

function safeSetLocalStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch (error) {
    console.warn(`Inkwell could not persist ${key} locally. Backend state remains available.`, error);
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures; persistence is best effort.
    }
  }
}

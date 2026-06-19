import {
  queueDefinitionsStorageKey,
  queueScheduleSettingsStorageKey,
  runnerSettingsStorageKey,
  storageKey,
  submissionQueueStorageKey,
  submitTargetStorageKey,
  tagProfileStorageKey,
  templateStorageKey,
  tumblrAccountsStorageKey,
} from "./constants";
import { emptyAd, normalizeStoredState } from "./ads";
import { loadSubmissionQueue, normalizeQueueDefinition, uniqueQueueDefinitions } from "./queue";
import { loadSubmitTargets } from "./submitTargets";
import { loadTagProfiles } from "./tags";
import { normalizeTemplate } from "./templates";
import { normalizeTumblrAccount } from "./tumblrAccounts";
import { QueueDefinition, QueueScheduleSettings, RunnerSettings, SavedTemplate, StoredState, TumblrAccount } from "./types";

export { loadSubmissionQueue, loadSubmitTargets, loadTagProfiles };

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
    return {
      mediaDir: typeof parsed.mediaDir === "string" ? parsed.mediaDir : "",
      slowMo: typeof parsed.slowMo === "number" ? parsed.slowMo : 500,
      submit: Boolean(parsed.submit),
      tumblrAccountId: typeof parsed.tumblrAccountId === "string" ? parsed.tumblrAccountId : "",
    };
  } catch {
    return { mediaDir: "", slowMo: 500, submit: false, tumblrAccountId: "" };
  }
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
    const dailyTime = typeof parsed.dailyTime === "string" && /^\d{2}:\d{2}$/.test(parsed.dailyTime) ? parsed.dailyTime : "09:00";
    return {
      enabled: Boolean(parsed.enabled),
      dailyTime,
      timezone: "America/New_York",
    };
  } catch {
    return { enabled: false, dailyTime: "09:00", timezone: "America/New_York" };
  }
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

export function saveStoredState(stored: StoredState) {
  localStorage.setItem(storageKey, JSON.stringify(stored));
}

export function saveSubmitTargets(value: unknown) {
  localStorage.setItem(submitTargetStorageKey, JSON.stringify(value));
}

export function saveSubmissionQueue(value: unknown) {
  localStorage.setItem(submissionQueueStorageKey, JSON.stringify(value));
}

export function saveQueueDefinitions(value: unknown) {
  localStorage.setItem(queueDefinitionsStorageKey, JSON.stringify(value));
}

export function saveTagProfiles(value: unknown) {
  localStorage.setItem(tagProfileStorageKey, JSON.stringify(value));
}

export function saveRunnerSettings(value: unknown) {
  localStorage.setItem(runnerSettingsStorageKey, JSON.stringify(value));
}

export function saveQueueScheduleSettings(value: unknown) {
  localStorage.setItem(queueScheduleSettingsStorageKey, JSON.stringify(value));
}

export function saveTemplates(value: unknown) {
  localStorage.setItem(templateStorageKey, JSON.stringify(value));
}

export function saveTumblrAccounts(value: unknown) {
  localStorage.setItem(tumblrAccountsStorageKey, JSON.stringify(value));
}

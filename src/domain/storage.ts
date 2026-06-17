import {
  runnerSettingsStorageKey,
  storageKey,
  submissionQueueStorageKey,
  submitTargetStorageKey,
  tagProfileStorageKey,
  templateStorageKey,
} from "./constants";
import { emptyAd, normalizeStoredState } from "./ads";
import { loadSubmissionQueue } from "./queue";
import { loadSubmitTargets } from "./submitTargets";
import { loadTagProfiles } from "./tags";
import { normalizeTemplate } from "./templates";
import { RunnerSettings, SavedTemplate, StoredState } from "./types";

export { loadSubmissionQueue, loadSubmitTargets, loadTagProfiles };

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
    };
  } catch {
    return { mediaDir: "", slowMo: 500, submit: false };
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

export function saveTagProfiles(value: unknown) {
  localStorage.setItem(tagProfileStorageKey, JSON.stringify(value));
}

export function saveRunnerSettings(value: unknown) {
  localStorage.setItem(runnerSettingsStorageKey, JSON.stringify(value));
}

export function saveTemplates(value: unknown) {
  localStorage.setItem(templateStorageKey, JSON.stringify(value));
}

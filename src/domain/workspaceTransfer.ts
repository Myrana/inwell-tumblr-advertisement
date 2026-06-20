import { normalizeStoredState } from "./ads";
import { defaultTagProfiles } from "./constants";
import { normalizeQueueItem, uniqueQueueDefinitions } from "./queue";
import { normalizeQueueScheduleSettings, normalizeRunnerSettings } from "./storage";
import { uniqueSubmitTargets } from "./submitTargets";
import { uniqueTags } from "./tags";
import { normalizeTemplate } from "./templates";
import { normalizeTumblrAccount } from "./tumblrAccounts";
import {
  QueueDefinition,
  QueueScheduleSettings,
  RunnerSettings,
  SavedTemplate,
  StoredState,
  SubmissionQueueItem,
  TumblrAccount,
  TumblrSubmitTarget,
} from "./types";

export type WorkspaceTransferData = {
  stored: StoredState;
  submitTargets: TumblrSubmitTarget[];
  templates: SavedTemplate[];
  queueDefinitions: QueueDefinition[];
  submissionQueue: SubmissionQueueItem[];
  queueScheduleSettings: QueueScheduleSettings;
  tagProfiles: Record<string, string[]>;
  tumblrAccounts: TumblrAccount[];
  runnerSettings: RunnerSettings;
};

export type WorkspaceExport = {
  schema: "inkwell-workspace-export";
  version: 1;
  exportedAt: string;
  data: WorkspaceTransferData;
};

export function createWorkspaceExport(data: WorkspaceTransferData, now = new Date()): WorkspaceExport {
  return {
    schema: "inkwell-workspace-export",
    version: 1,
    exportedAt: now.toISOString(),
    data: normalizeWorkspaceTransferData(data),
  };
}

export function parseWorkspaceImport(text: string): WorkspaceTransferData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Choose a valid Inkwell workspace JSON file.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Choose a valid Inkwell workspace JSON file.");
  }

  const record = parsed as Partial<WorkspaceExport>;
  if (record.schema !== "inkwell-workspace-export" || record.version !== 1 || !record.data) {
    throw new Error("This file is not an Inkwell workspace export.");
  }

  return normalizeWorkspaceTransferData(record.data);
}

function normalizeWorkspaceTransferData(data: Partial<WorkspaceTransferData>): WorkspaceTransferData {
  const submissionQueue = Array.isArray(data.submissionQueue)
    ? data.submissionQueue.map((item) => normalizeQueueItem(item)).filter((item): item is SubmissionQueueItem => Boolean(item))
    : [];
  const queueDefinitions = Array.isArray(data.queueDefinitions)
    ? uniqueQueueDefinitions(data.queueDefinitions, submissionQueue)
    : uniqueQueueDefinitions([], submissionQueue);

  return {
    stored: normalizeStoredState(data.stored),
    submitTargets: Array.isArray(data.submitTargets) ? uniqueSubmitTargets(data.submitTargets) : [],
    templates: Array.isArray(data.templates) ? data.templates.map((template) => normalizeTemplate(template)) : [],
    queueDefinitions,
    submissionQueue,
    queueScheduleSettings: normalizeQueueScheduleSettings(data.queueScheduleSettings),
    tagProfiles: normalizeTagProfiles(data.tagProfiles),
    tumblrAccounts: Array.isArray(data.tumblrAccounts)
      ? data.tumblrAccounts.map((account) => normalizeTumblrAccount(account)).filter((account): account is TumblrAccount => Boolean(account))
      : [],
    runnerSettings: normalizeRunnerSettings(data.runnerSettings),
  };
}

function normalizeTagProfiles(value: unknown) {
  const profiles: Record<string, string[]> = { ...defaultTagProfiles };
  if (!value || typeof value !== "object") {
    return profiles;
  }

  Object.entries(value as Record<string, unknown>).forEach(([target, tags]) => {
    if (Array.isArray(tags)) {
      profiles[target] = uniqueTags(tags.filter((tag): tag is string => typeof tag === "string"));
    }
  });

  return profiles;
}

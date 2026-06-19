import { apiBaseUrl } from "./constants";
import { toApiAdvertisement } from "./ads";
import { normalizeQueueName } from "./queue";
import { fromApiTemplate, toApiTemplate } from "./templates";
import {
  Advertisement,
  AppSettings,
  ApiQueueItem,
  ApiRunnerLog,
  ApiTemplate,
  RunnerLog,
  SavedTemplate,
  SubmissionQueueItem,
} from "./types";

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function saveAdvertisement(advertisement: Advertisement) {
  await apiRequest(`/advertisements/${advertisement.id}`, {
    method: "PUT",
    body: JSON.stringify(toApiAdvertisement(advertisement)),
  });
}

export async function removeAdvertisement(id: string) {
  await apiRequest(`/advertisements/${id}`, { method: "DELETE" });
}

export async function loadBackendTemplates() {
  const response = await apiRequest<{ templates: ApiTemplate[] }>("/templates");
  return response.templates.map(fromApiTemplate);
}

export async function saveTemplate(template: SavedTemplate) {
  const response = await apiRequest<{ template: ApiTemplate }>(`/templates/${template.id}`, {
    method: "PUT",
    body: JSON.stringify(toApiTemplate(template)),
  });
  return fromApiTemplate(response.template);
}

export async function removeTemplate(id: string) {
  await apiRequest(`/templates/${id}`, { method: "DELETE" });
}

export async function loadBackendAppSettings() {
  const response = await apiRequest<{ settings: Partial<AppSettings> }>("/settings");
  return response.settings;
}

export async function saveBackendAppSettings(settings: AppSettings) {
  const response = await apiRequest<{ settings: AppSettings }>("/settings/app", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return response.settings;
}

export function fromApiQueueItem(item: ApiQueueItem): SubmissionQueueItem {
  return {
    id: item.id,
    adId: item.ad_id,
    targetId: item.target_id,
    targetName: item.target_name,
    queueName: normalizeQueueName(item.queue_name),
    submitUrl: item.submit_url,
    postType: item.post_type,
    status: item.status,
    scheduledFor: item.scheduled_for ?? "",
    timezone: item.timezone ?? "America/New_York",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    lastRunAt: item.last_run_at ?? "",
    postedAt: item.posted_at ?? "",
    failedAt: item.failed_at ?? "",
    notes: item.notes,
    runnerPayload: item.runner_payload,
  };
}

export function toApiQueueItem(item: SubmissionQueueItem): ApiQueueItem {
  return {
    id: item.id,
    ad_id: item.adId,
    target_id: item.targetId,
    target_name: item.targetName,
    queue_name: normalizeQueueName(item.queueName),
    submit_url: item.submitUrl,
    post_type: item.postType,
    status: item.status,
    scheduled_for: item.scheduledFor || null,
    timezone: item.timezone,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    last_run_at: item.lastRunAt || null,
    posted_at: item.postedAt || null,
    failed_at: item.failedAt || null,
    notes: item.notes,
    runner_payload: item.runnerPayload,
  };
}

export function fromApiRunnerLog(log: ApiRunnerLog): RunnerLog {
  return {
    id: log.id,
    runId: log.run_id ?? "",
    queueItemId: log.queue_item_id,
    targetName: log.target_name ?? "",
    level: log.level,
    message: log.message,
    details: log.details ?? {},
    createdAt: log.created_at,
  };
}

export async function loadBackendQueue() {
  const response = await apiRequest<{ queue: ApiQueueItem[] }>("/queue");
  return response.queue.map(fromApiQueueItem);
}

export async function saveQueueItem(item: SubmissionQueueItem) {
  const response = await apiRequest<{ queue_item: ApiQueueItem }>(`/queue/${item.id}`, {
    method: "PUT",
    body: JSON.stringify(toApiQueueItem(item)),
  });
  return fromApiQueueItem(response.queue_item);
}

export async function removeQueueItem(id: string) {
  await apiRequest(`/queue/${id}`, { method: "DELETE" });
}

export async function loadRunnerLogs() {
  const response = await apiRequest<{ logs: ApiRunnerLog[] }>("/runner/logs");
  return response.logs.map(fromApiRunnerLog);
}

export async function clearRunnerLogs() {
  await apiRequest("/runner/logs", { method: "DELETE" });
}

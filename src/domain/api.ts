import { apiBaseUrl } from "./constants";
import { toApiAdvertisement } from "./ads";
import { normalizeQueueName } from "./queue";
import { fromApiTemplate, toApiTemplate } from "./templates";
import { fromApiTumblrAccount, toApiTumblrAccount } from "./tumblrAccounts";
import {
  Advertisement,
  AppSettings,
  ApiQueueItem,
  ApiRunnerLog,
  ApiTemplate,
  ApiTumblrAccount,
  AuthUser,
  RunnerLog,
  SavedTemplate,
  SubmissionQueueItem,
  TumblrAccount,
} from "./types";

export class ApiError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let payload: { error?: string; retryAfterSeconds?: number } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      payload = {};
    }
    throw new ApiError(response.status, payload.error || `API request failed: ${response.status}`, payload.retryAfterSeconds);
  }

  return response.json() as Promise<T>;
}

export type AuthSessionResponse = {
  authenticated: boolean;
  user: AuthUser | null;
  bootstrapRequired: boolean;
};

export async function loadAuthSession() {
  return apiRequest<AuthSessionResponse>("/auth/session");
}

export async function registerInkwellUser(payload: { email: string; password: string; displayName: string; workspaceName: string }) {
  return apiRequest<AuthSessionResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loginInkwellUser(payload: { email: string; password: string }) {
  return apiRequest<AuthSessionResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function logoutInkwellUser() {
  return apiRequest<AuthSessionResponse>("/auth/logout", { method: "POST" });
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
    tumblrAccountId: item.tumblr_account_id ?? "",
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
    tumblr_account_id: item.tumblrAccountId,
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

export type LocalCompanionStatus = {
  ok: boolean;
  version: string;
  apiBaseUrl: string;
  workspaceId: string;
  queueName: string;
  watching: boolean;
  running: boolean;
  status: string;
  lastStartedAt: string;
  lastFinishedAt: string;
  lastExitCode: number | null;
  lastError: string;
  accepted?: boolean;
  error?: string;
};

const localCompanionBaseUrl = "http://127.0.0.1:17842";

type LocalCompanionRequestInit = RequestInit & {
  targetAddressSpace?: "loopback";
};

async function localCompanionRequest<T>(path: string, init?: RequestInit, timeoutMs = 1200): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${localCompanionBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      targetAddressSpace: "loopback",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    } as LocalCompanionRequestInit);
    if (!response.ok) {
      let payload: { error?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }
      throw new ApiError(response.status, payload.error || `Local companion request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function loadLocalCompanionStatus() {
  return localCompanionRequest<LocalCompanionStatus>("/status", { method: "GET" }, 350);
}

export async function runLocalCompanion(queueName: string) {
  return localCompanionRequest<LocalCompanionStatus>(
    "/run",
    {
      method: "POST",
      body: JSON.stringify({ queueName }),
    },
    1500,
  );
}

export async function downloadLocalRunnerPackage(queueName: string) {
  const response = await fetch(`${apiBaseUrl}/runner/local-package?queueName=${encodeURIComponent(queueName)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    let payload: { error?: string } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      payload = {};
    }
    throw new ApiError(response.status, payload.error || `API request failed: ${response.status}`);
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return {
    blob: await response.blob(),
    filename: match?.[1] || "inkwell-local-runner.zip",
  };
}

export async function loadLocalRunnerCommand(queueName: string) {
  const response = await apiRequest<{
    localRunner: {
      command: string;
      autoStartCommand?: string;
      tokenConfigured: boolean;
      usesDeviceToken?: boolean;
      tokenEnv: string;
      message: string;
    };
  }>(`/runner/local-command?queueName=${encodeURIComponent(queueName)}`);
  return response.localRunner;
}

export async function loadBackendTumblrAccounts() {
  const response = await apiRequest<{ accounts: ApiTumblrAccount[] }>("/tumblr/accounts");
  return response.accounts.map(fromApiTumblrAccount);
}

export async function saveTumblrAccount(account: TumblrAccount) {
  const response = await apiRequest<{ account: ApiTumblrAccount }>(`/tumblr/accounts/${account.id}`, {
    method: "PUT",
    body: JSON.stringify(toApiTumblrAccount(account)),
  });
  return fromApiTumblrAccount(response.account);
}

export async function removeTumblrAccount(id: string) {
  await apiRequest(`/tumblr/accounts/${id}`, { method: "DELETE" });
}

export type TumblrLoginResponse =
  | { login: { mode: "local"; pid: number; command: string[]; message: string } }
  | {
      login: {
        mode: "remote";
        provider: string;
        launchUrl: string;
        message: string;
        loggedIn?: boolean;
        sessionId?: string;
        contextId?: string;
        account?: ApiTumblrAccount;
      };
    };

export async function launchTumblrLogin(accountId: string, slowMo = 250) {
  return apiRequest<TumblrLoginResponse>("/tumblr/login", {
    method: "POST",
    body: JSON.stringify({ accountId, slowMo }),
  });
}

export async function checkTumblrLogin(accountId: string) {
  return apiRequest<TumblrLoginResponse>("/tumblr/login-check", {
    method: "POST",
    body: JSON.stringify({ accountId }),
  });
}

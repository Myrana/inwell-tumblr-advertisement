import { apiBaseUrl } from "./constants";
import { fromApiAdvertisement, toApiAdvertisement } from "./ads";
import { normalizeQueueItem, normalizeQueueName } from "./queue";
import { fromApiTemplate, toApiTemplate } from "./templates";
import { fromApiTumblrAccount, normalizeTumblrAccount, toApiTumblrAccount } from "./tumblrAccounts";
import {
  Advertisement,
  AppSettings,
  ApiQueueItem,
  ApiAdvertisement,
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

export async function requestInkwellPasswordReset(payload: { email: string }) {
  const response = await apiRequest<{ passwordReset: { submitted: boolean; message: string } }>("/auth/password-reset", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.passwordReset;
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

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export async function loadBackendAdvertisements() {
  const response = await apiRequest<{ advertisements: ApiAdvertisement[] }>("/advertisements");
  return safeArray<ApiAdvertisement>(response.advertisements)
    .map((advertisement) => {
      try {
        return fromApiAdvertisement(advertisement);
      } catch {
        return null;
      }
    })
    .filter((advertisement): advertisement is Advertisement => Boolean(advertisement));
}

export async function loadBackendTemplates() {
  const response = await apiRequest<{ templates: ApiTemplate[] }>("/templates");
  return safeArray<ApiTemplate>(response.templates).map(fromApiTemplate);
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

export async function saveDiscordWebhookSettings(webhookUrl: string) {
  const response = await apiRequest<{ discordWebhook: { configured: boolean } }>("/settings/discord-webhook", {
    method: "PUT",
    body: JSON.stringify({ webhookUrl }),
  });
  return response.discordWebhook;
}

export async function testDiscordWebhookSettings(webhookUrl?: string) {
  const response = await apiRequest<{ discordWebhook: { tested: boolean } }>("/settings/discord-webhook-test", {
    method: "POST",
    body: JSON.stringify({ webhookUrl: webhookUrl ?? "" }),
  });
  return response.discordWebhook;
}

export function fromApiQueueItem(item: ApiQueueItem): SubmissionQueueItem {
  const normalized = normalizeQueueItem({
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
  });

  if (!normalized) {
    throw new ApiError(422, "Queue item is missing required fields.");
  }

  return normalized;
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
  const details = log.details && typeof log.details === "object" && !Array.isArray(log.details) ? log.details : {};
  const level = log.level === "warning" || log.level === "error" ? log.level : "info";

  return {
    id: typeof log.id === "string" && log.id ? log.id : `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    runId: typeof log.run_id === "string" ? log.run_id : "",
    queueItemId: typeof log.queue_item_id === "string" ? log.queue_item_id : "",
    targetName: typeof log.target_name === "string" ? log.target_name : "",
    level,
    message: typeof log.message === "string" ? log.message : "",
    details,
    createdAt: typeof log.created_at === "string" ? log.created_at : new Date().toISOString(),
  };
}

export async function loadBackendQueue() {
  const response = await apiRequest<{ queue: ApiQueueItem[] }>("/queue");
  return safeArray<ApiQueueItem>(response.queue)
    .map((item) => {
      try {
        return fromApiQueueItem(item);
      } catch {
        return null;
      }
    })
    .filter((item): item is SubmissionQueueItem => Boolean(item));
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
  return safeArray<ApiRunnerLog>(response.logs).map(fromApiRunnerLog);
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
  submit?: boolean;
  watching: boolean;
  running: boolean;
  status: string;
  lastStartedAt: string;
  lastFinishedAt: string;
  lastExitCode: number | null;
  lastExitSignal: string;
  lastBlockerCode: string;
  lastError: string;
  lastRun: {
    queueName: string;
    headless: boolean;
    submit: boolean;
    itemCount: number;
    runId: string;
    startedAt: string;
    finishedAt: string;
    exitCode: number | null;
    exitSignal: string;
    blockerCode?: string;
    status: string;
  } | null;
  accepted?: boolean;
  pid?: number;
  message?: string;
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

export async function runLocalCompanion(queueName: string, options: { headless?: boolean; submit?: boolean } = {}) {
  const body: { queueName: string; headless: boolean; submit?: boolean } = {
    queueName,
    headless: Boolean(options.headless),
  };
  if (typeof options.submit === "boolean") {
    body.submit = options.submit;
  }
  return localCompanionRequest<LocalCompanionStatus>(
    "/run",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    1500,
  );
}

export async function launchLocalCompanionLogin(options: { accountId: string; userDataDir?: string; slowMo?: number }) {
  return localCompanionRequest<LocalCompanionStatus>(
    "/login",
    {
      method: "POST",
      body: JSON.stringify({
        accountId: options.accountId,
        userDataDir: options.userDataDir || "",
        slowMo: options.slowMo ?? 250,
      }),
    },
    1500,
  );
}

export async function downloadLocalRunnerPackage(queueName: string, options: { submit?: boolean } = {}) {
  const params = new URLSearchParams({ queueName });
  if (typeof options.submit === "boolean") {
    params.set("submit", String(options.submit));
  }
  const response = await fetch(`${apiBaseUrl}/runner/local-package?${params.toString()}`, {
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

export async function loadLocalRunnerCommand(queueName: string, options: { submit?: boolean } = {}) {
  const params = new URLSearchParams({ queueName });
  if (typeof options.submit === "boolean") {
    params.set("submit", String(options.submit));
  }
  const response = await apiRequest<{
    localRunner: {
      command: string;
      autoStartCommand?: string;
      tokenConfigured: boolean;
      usesDeviceToken?: boolean;
      tokenEnv: string;
      message: string;
    };
  }>(`/runner/local-command?${params.toString()}`);
  return response.localRunner;
}

export async function loadBackendTumblrAccounts() {
  const response = await apiRequest<{ accounts: ApiTumblrAccount[] }>("/tumblr/accounts");
  return safeArray<ApiTumblrAccount>(response.accounts)
    .map((account) => normalizeTumblrAccount(fromApiTumblrAccount(account)))
    .filter((account): account is TumblrAccount => Boolean(account));
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

import { ApiTumblrAccount, TumblrAccount, TumblrAccountStatus } from "./types";

export function normalizeTumblrAccountStatus(value: unknown): TumblrAccountStatus {
  return value === "connected" || value === "expired" || value === "checking" ? value : "needs-login";
}

export function tumblrAccountId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalizeTumblrAccount(value: Partial<TumblrAccount> | null | undefined): TumblrAccount | null {
  const displayName = typeof value?.displayName === "string" ? value.displayName.trim() : "";
  const blogName = typeof value?.blogName === "string" ? value.blogName.trim().toLowerCase() : "";
  const id = typeof value?.id === "string" && value.id.trim() ? value.id.trim() : tumblrAccountId(blogName || displayName);
  if (!id) {
    return null;
  }

  return {
    id,
    displayName: displayName || blogName || id,
    blogName,
    userDataDir: typeof value?.userDataDir === "string" ? value.userDataDir : "",
    status: normalizeTumblrAccountStatus(value?.status),
    lastCheckedAt: typeof value?.lastCheckedAt === "string" ? value.lastCheckedAt : "",
    lastLoginAt: typeof value?.lastLoginAt === "string" ? value.lastLoginAt : "",
    notes: typeof value?.notes === "string" ? value.notes : "",
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

export function fromApiTumblrAccount(account: ApiTumblrAccount): TumblrAccount {
  return {
    id: account.id,
    displayName: account.display_name,
    blogName: account.blog_name,
    userDataDir: account.user_data_dir,
    status: normalizeTumblrAccountStatus(account.status),
    lastCheckedAt: account.last_checked_at ?? "",
    lastLoginAt: account.last_login_at ?? "",
    notes: account.notes,
    updatedAt: account.updated_at,
  };
}

export function toApiTumblrAccount(account: TumblrAccount): ApiTumblrAccount {
  return {
    id: account.id,
    display_name: account.displayName,
    blog_name: account.blogName,
    user_data_dir: account.userDataDir,
    status: account.status,
    last_checked_at: account.lastCheckedAt || null,
    last_login_at: account.lastLoginAt || null,
    notes: account.notes,
    updated_at: account.updatedAt,
  };
}

export function upsertTumblrAccount(accounts: TumblrAccount[], account: TumblrAccount) {
  const withoutExisting = accounts.filter((item) => item.id !== account.id);
  return [account, ...withoutExisting].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

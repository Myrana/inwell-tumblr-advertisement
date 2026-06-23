import { defaultSubmitTargets, submitTargetStorageKey } from "./constants";
import { TumblrSubmitTarget } from "./types";

const removedSeedTargetIds = new Set(["inwell-ads", "jcink-directory", "roleplay-finder"]);

export function normalizeSubmitUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (!url.hostname.endsWith("tumblr.com")) {
      return "";
    }

    url.protocol = "https:";
    url.pathname = "/submit";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function submitTargetFromUrl(value: string, forumUrl = ""): TumblrSubmitTarget | null {
  const submitUrl = normalizeSubmitUrl(value);
  if (!submitUrl) {
    return null;
  }

  const hostname = new URL(submitUrl).hostname;
  const blogName = hostname.replace(/\.tumblr\.com$/i, "");
  const id = blogName.toLowerCase();

  return { id, name: blogName, profileName: blogName, submitUrl, forumUrl: forumUrl.trim(), postingRules: "" };
}

export function fallbackTarget(id: string): TumblrSubmitTarget {
  const targetId = id.trim();
  if (!targetId || removedSeedTargetIds.has(targetId)) {
    return {
      id: "",
      name: "Add a Tumblr blog",
      profileName: "",
      submitUrl: "",
      forumUrl: "",
      postingRules: "",
    };
  }

  return {
    id: targetId,
    name: targetId,
    profileName: targetId,
    submitUrl: `https://${targetId}.tumblr.com/submit`,
    forumUrl: "",
    postingRules: "",
  };
}

function normalizeSubmitTarget(target: Partial<TumblrSubmitTarget> | null | undefined): TumblrSubmitTarget | null {
  const id = typeof target?.id === "string" ? target.id.trim().toLowerCase() : "";
  const submitUrl = normalizeSubmitUrl(typeof target?.submitUrl === "string" ? target.submitUrl : "");
  if (!id || !submitUrl || removedSeedTargetIds.has(id)) {
    return null;
  }

  const name = typeof target?.name === "string" && target.name.trim() ? target.name.trim() : id;
  const profileName = typeof target?.profileName === "string" && target.profileName.trim() ? target.profileName.trim() : name;
  const forumUrl = typeof target?.forumUrl === "string" ? target.forumUrl.trim() : "";
  const postingRules = typeof target?.postingRules === "string" ? target.postingRules.trim() : "";
  return { id, name, profileName, submitUrl, forumUrl, postingRules };
}

export function uniqueSubmitTargets(targets: Array<Partial<TumblrSubmitTarget> | null | undefined>) {
  const seen = new Map<string, TumblrSubmitTarget>();

  targets.forEach((target) => {
    const normalized = normalizeSubmitTarget(target);
    if (!normalized || seen.has(normalized.id)) {
      return;
    }

    seen.set(normalized.id, normalized);
  });

  return Array.from(seen.values());
}

export function upsertSubmitTarget(targets: TumblrSubmitTarget[], nextTarget: TumblrSubmitTarget) {
  const hasExisting = targets.some((target) => target.id === nextTarget.id);

  if (!hasExisting) {
    return uniqueSubmitTargets([...targets, nextTarget]);
  }

  return uniqueSubmitTargets(
    targets.map((target) =>
      target.id === nextTarget.id
        ? {
            ...target,
            name: nextTarget.name || target.name,
            profileName: nextTarget.profileName || target.profileName || nextTarget.name || target.name,
            submitUrl: nextTarget.submitUrl || target.submitUrl,
            forumUrl: nextTarget.forumUrl || target.forumUrl,
            postingRules: nextTarget.postingRules || target.postingRules || "",
          }
        : target,
    ),
  );
}

export function upsertSubmitTargetProfile(
  targets: TumblrSubmitTarget[],
  targetId: string,
  patch: Partial<Pick<TumblrSubmitTarget, "profileName" | "postingRules">>,
) {
  const normalizedTargetId = targetId.trim();

  if (!normalizedTargetId) {
    return targets;
  }

  return uniqueSubmitTargets(
    targets.map((target) =>
      target.id === normalizedTargetId
        ? {
            ...target,
            profileName: typeof patch.profileName === "string" ? patch.profileName : target.profileName,
            postingRules: typeof patch.postingRules === "string" ? patch.postingRules : target.postingRules,
          }
        : target,
    ),
  );
}

export function upsertSubmitTargetForumUrl(targets: TumblrSubmitTarget[], targetId: string, forumUrl: string) {
  const normalizedTargetId = targetId.trim();

  if (!normalizedTargetId) {
    return targets;
  }

  return uniqueSubmitTargets(
    targets.map((target) => (target.id === normalizedTargetId ? { ...target, forumUrl: forumUrl.trim() } : target)),
  );
}

export function loadSubmitTargets() {
  try {
    const raw = localStorage.getItem(submitTargetStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Partial<TumblrSubmitTarget>[];
    const imported = Array.isArray(parsed)
      ? parsed
          .map((target) => {
            return normalizeSubmitTarget(target);
          })
          .filter((target): target is TumblrSubmitTarget => Boolean(target))
      : [];

    return uniqueSubmitTargets(imported);
  } catch {
    return [];
  }
}

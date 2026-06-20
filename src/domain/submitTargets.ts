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

export function uniqueSubmitTargets(targets: TumblrSubmitTarget[]) {
  const seen = new Map<string, TumblrSubmitTarget>();

  targets.forEach((target) => {
    if (!target.id || seen.has(target.id)) {
      return;
    }

    if (removedSeedTargetIds.has(target.id)) {
      return;
    }

    seen.set(target.id, {
      ...target,
      name: target.name || target.id,
      profileName: target.profileName || target.name || target.id,
      forumUrl: target.forumUrl || "",
      postingRules: target.postingRules || "",
    });
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
            const submitUrl = normalizeSubmitUrl(target.submitUrl ?? "");
            const id = (target.id ?? "").trim().toLowerCase();
            const name = (target.name ?? id).trim();
            const profileName = (target.profileName ?? name).trim();
            const forumUrl = (target.forumUrl ?? "").trim();
            const postingRules = (target.postingRules ?? "").trim();
            return submitUrl && id ? { id, name: name || id, profileName: profileName || name || id, submitUrl, forumUrl, postingRules } : null;
          })
          .filter((target): target is TumblrSubmitTarget => Boolean(target))
      : [];

    return uniqueSubmitTargets(imported);
  } catch {
    return [];
  }
}

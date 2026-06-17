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

export function submitTargetFromUrl(value: string): TumblrSubmitTarget | null {
  const submitUrl = normalizeSubmitUrl(value);
  if (!submitUrl) {
    return null;
  }

  const hostname = new URL(submitUrl).hostname;
  const blogName = hostname.replace(/\.tumblr\.com$/i, "");
  const id = blogName.toLowerCase();

  return { id, name: blogName, submitUrl };
}

export function fallbackTarget(id: string): TumblrSubmitTarget {
  const targetId = id.trim();
  if (!targetId || removedSeedTargetIds.has(targetId)) {
    return {
      id: "",
      name: "Add a Tumblr blog",
      submitUrl: "",
    };
  }

  return {
    id: targetId,
    name: targetId,
    submitUrl: `https://${targetId}.tumblr.com/submit`,
  };
}

export function uniqueSubmitTargets(targets: TumblrSubmitTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (!target.id || seen.has(target.id)) {
      return false;
    }

    if (removedSeedTargetIds.has(target.id)) {
      return false;
    }

    seen.add(target.id);
    return true;
  });
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
            return submitUrl && id ? { id, name: name || id, submitUrl } : null;
          })
          .filter((target): target is TumblrSubmitTarget => Boolean(target))
      : [];

    return uniqueSubmitTargets(imported);
  } catch {
    return [];
  }
}

import { defaultTagProfiles, tagProfileStorageKey } from "./constants";

export function normalizeTag(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function uniqueTags(values: string[]) {
  return [...new Set(values.map(normalizeTag).filter(Boolean))];
}

export function parseImportedTags(value: string) {
  return uniqueTags(
    value
      .split(/[\n,]/)
      .map((item) => item.replace(/^\s*[-*•]\s*/, ""))
      .filter((item) => !/^tags?:?$/i.test(item.trim())),
  );
}

export function loadTagProfiles() {
  try {
    const raw = localStorage.getItem(tagProfileStorageKey);
    if (!raw) {
      return defaultTagProfiles;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profiles: Record<string, string[]> = { ...defaultTagProfiles };
    Object.entries(parsed).forEach(([blog, tags]) => {
      if (Array.isArray(tags)) {
        profiles[blog] = tags.length ? uniqueTags(tags as string[]) : (defaultTagProfiles[blog] ?? []);
      }
    });
    Object.keys(defaultTagProfiles).forEach((blog) => {
      profiles[blog] = profiles[blog] ?? defaultTagProfiles[blog];
    });
    return profiles;
  } catch {
    return defaultTagProfiles;
  }
}

import { defaultTagProfiles, tagProfileStorageKey } from "./constants";

export function normalizeTag(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

export function uniqueTags(values: unknown[]) {
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

    return normalizeTagProfiles(JSON.parse(raw));
  } catch {
    return defaultTagProfiles;
  }
}

export function normalizeTagProfiles(value: unknown) {
  const profiles: Record<string, string[]> = { ...defaultTagProfiles };
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([blog, tags]) => {
      const blogName = normalizeTag(blog);
      if (blogName && Array.isArray(tags)) {
        profiles[blogName] = tags.length ? uniqueTags(tags) : (defaultTagProfiles[blogName] ?? []);
      }
    });
  }
  Object.keys(defaultTagProfiles).forEach((blog) => {
    profiles[blog] = profiles[blog] ?? defaultTagProfiles[blog];
  });
  return profiles;
}

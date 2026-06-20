import { composerContentFor, htmlToPlainText } from "./ads";
import { Advertisement } from "./types";

export type DuplicateContentMatch = {
  groupKey: string;
  adIds: string[];
  labels: string[];
};

function normalizeDuplicatePart(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function duplicateFingerprintFor(advertisement: Advertisement) {
  const copy = normalizeDuplicatePart(htmlToPlainText(composerContentFor(advertisement)));
  if (!copy) {
    return "";
  }

  return [
    advertisement.postType,
    normalizeDuplicatePart(advertisement.destinationBlog),
    normalizeDuplicatePart(advertisement.forumUrl),
    copy,
  ].join("|");
}

export function findDuplicateContentMatches(advertisements: Advertisement[]): DuplicateContentMatch[] {
  const groups = new Map<string, Advertisement[]>();

  advertisements.forEach((advertisement) => {
    const key = duplicateFingerprintFor(advertisement);
    if (!key) {
      return;
    }

    groups.set(key, [...(groups.get(key) ?? []), advertisement]);
  });

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([groupKey, group]) => ({
      groupKey,
      adIds: group.map((advertisement) => advertisement.id),
      labels: group.map((advertisement) => advertisement.title || "Untitled submission"),
    }));
}

export function mapDuplicateMatchesByAdId(matches: DuplicateContentMatch[]) {
  const byAdId = new Map<string, DuplicateContentMatch>();

  matches.forEach((match) => {
    match.adIds.forEach((adId) => {
      byAdId.set(adId, match);
    });
  });

  return byAdId;
}

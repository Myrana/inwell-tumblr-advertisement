import { PostType, TumblrSubmitTarget } from "./types";

export const storageKey = "inwell-ad-assistant-state";
export const tagProfileStorageKey = "inwell-blog-tag-profiles";
export const submitTargetStorageKey = "inwell-tumblr-submit-targets";
export const submissionQueueStorageKey = "inwell-tumblr-submission-queue";
export const runnerSettingsStorageKey = "inwell-tumblr-runner-settings";
export const apiBaseUrl = "http://127.0.0.1:8021/api";

export const defaultSubmitTargets: TumblrSubmitTarget[] = [
  { id: "inwell-ads", name: "inwell-ads", submitUrl: "https://inwell-ads.tumblr.com/submit" },
  { id: "jcink-directory", name: "jcink-directory", submitUrl: "https://jcink-directory.tumblr.com/submit" },
  { id: "roleplay-finder", name: "roleplay-finder", submitUrl: "https://roleplay-finder.tumblr.com/submit" },
];

export const blogs = defaultSubmitTargets.map((target) => target.id);

export const defaultTagProfiles: Record<string, string[]> = {
  "inwell-ads": [
    "invisionfree/zifboards site",
    "jcink site",
    "premium jcink",
    "site buzz",
    "advertisement",
    "character request",
    "staff request",
    "semi-private site",
    "public site",
    "short app",
    "shipper app",
    "profile app",
    "band celeb rpg",
    "city town rpg",
    "historical rpg",
    "school rpg",
    "other real life rpg",
    "futuristic postapoc rpg",
    "harry potter rpg",
    "supernatural rpg",
    "other fantasy rpg",
    "other scifi rpg",
    "based on rpg",
    "multi genre rpg",
    "animal rpg",
    "animated rpg",
    "resource site",
    "6 months",
    "1 year",
    "3 years",
  ],
  "jcink-directory": [
    "jcink site",
    "premium jcink",
    "advertisement",
    "character request",
    "staff request",
    "semi-private site",
    "public site",
    "short app",
    "shipper app",
    "supernatural rpg",
    "other fantasy rpg",
    "multi genre rpg",
    "1 year",
    "3 years",
  ],
  "roleplay-finder": [
    "advertisement",
    "public site",
    "semi-private site",
    "city town rpg",
    "historical rpg",
    "school rpg",
    "other real life rpg",
    "futuristic postapoc rpg",
    "animal rpg",
    "animated rpg",
    "6 months",
    "1 year",
  ],
};

export const defaultSelectedTags = ["jcink site", "premium jcink", "semi-private site", "supernatural rpg", "1 year"];

export const postTypes: { value: PostType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
];

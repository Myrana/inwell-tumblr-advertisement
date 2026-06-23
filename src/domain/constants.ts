import { ColorSkin, ColorTheme, PostType, TumblrSubmitTarget } from "./types";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const storageKey = "inwell-ad-assistant-state";
export const tagProfileStorageKey = "inwell-blog-tag-profiles";
export const submitTargetStorageKey = "inwell-tumblr-submit-targets";
export const submissionQueueStorageKey = "inwell-tumblr-submission-queue";
export const queueDefinitionsStorageKey = "inwell-tumblr-queue-definitions";
export const queueScheduleSettingsStorageKey = "inwell-queue-schedule-settings";
export const runnerSettingsStorageKey = "inwell-tumblr-runner-settings";
export const tumblrAccountsStorageKey = "inwell-tumblr-accounts";
export const templateStorageKey = "inkwell-saved-templates";
export const themeStorageKey = "inkwell-color-theme";
export const skinStorageKey = "inkwell-color-skin";
export const apiBaseUrl = configuredApiBaseUrl || (import.meta.env.DEV ? "http://127.0.0.1:8021/api" : "/api");

export const defaultSubmitTargets: TumblrSubmitTarget[] = [];
export const defaultQueueName = "Default queue";

export const blogs = defaultSubmitTargets.map((target) => target.id);

export const defaultTagProfiles: Record<string, string[]> = {};

export const postTypes: { value: PostType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
];

export const colorSkins: { value: ColorSkin; label: string; theme: ColorTheme }[] = [
  { value: "inkwell-dark", label: "Inkwell Dark", theme: "dark" },
  { value: "forest-night", label: "Forest Night", theme: "dark" },
  { value: "blue-archive", label: "Blue Archive", theme: "dark" },
  { value: "soft-green", label: "Soft Green", theme: "light" },
  { value: "paper-desk", label: "Paper Desk", theme: "light" },
  { value: "rose-ledger", label: "Rose Ledger", theme: "light" },
];

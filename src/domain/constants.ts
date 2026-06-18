import { PostType, TumblrSubmitTarget } from "./types";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const storageKey = "inwell-ad-assistant-state";
export const tagProfileStorageKey = "inwell-blog-tag-profiles";
export const submitTargetStorageKey = "inwell-tumblr-submit-targets";
export const submissionQueueStorageKey = "inwell-tumblr-submission-queue";
export const queueScheduleSettingsStorageKey = "inwell-queue-schedule-settings";
export const runnerSettingsStorageKey = "inwell-tumblr-runner-settings";
export const templateStorageKey = "inkwell-saved-templates";
export const apiBaseUrl = configuredApiBaseUrl || (import.meta.env.DEV ? "http://127.0.0.1:8021/api" : "/api");

export const defaultSubmitTargets: TumblrSubmitTarget[] = [];

export const blogs = defaultSubmitTargets.map((target) => target.id);

export const defaultTagProfiles: Record<string, string[]> = {};

export const postTypes: { value: PostType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
];

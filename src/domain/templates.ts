import { Advertisement, ApiTemplate, SavedTemplate } from "./types";
import { uniqueTags } from "./tags";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeTemplate(value: Partial<SavedTemplate> | null | undefined): SavedTemplate {
  return {
    id: value?.id || createId(),
    name: value?.name?.trim() || "Untitled template",
    content: value?.content ?? "",
    forumUrl: value?.forumUrl ?? "",
    queueName: value?.queueName?.trim() || "",
    tags: Array.isArray(value?.tags) ? uniqueTags(value.tags) : [],
    updatedAt: value?.updatedAt || new Date().toISOString(),
  };
}

export function templateFromAdvertisement(advertisement: Advertisement, queueName = ""): SavedTemplate {
  return normalizeTemplate({
    name: advertisement.title || "Untitled template",
    content: advertisement.content || advertisement.imageCaption,
    forumUrl: "",
    queueName,
    tags: [],
  });
}

export function applyTemplateToAdvertisement(template: SavedTemplate): Partial<Advertisement> {
  return {
    content: template.content,
    imageCaption: "",
    status: "draft",
  };
}

export function fromApiTemplate(value: ApiTemplate): SavedTemplate {
  return normalizeTemplate({
    id: value.id,
    name: value.name,
    content: value.content,
    forumUrl: value.forum_url,
    queueName: value.queue_name ?? "",
    tags: value.tags,
    updatedAt: value.updated_at,
  });
}

export function toApiTemplate(template: SavedTemplate): ApiTemplate {
  return {
    id: template.id,
    name: template.name,
    content: template.content,
    forum_url: template.forumUrl,
    queue_name: template.queueName,
    tags: template.tags,
    updated_at: template.updatedAt,
  };
}

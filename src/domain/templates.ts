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
    tags: Array.isArray(value?.tags) ? uniqueTags(value.tags) : [],
    updatedAt: value?.updatedAt || new Date().toISOString(),
  };
}

export function templateFromAdvertisement(advertisement: Advertisement): SavedTemplate {
  return normalizeTemplate({
    name: advertisement.title || "Untitled template",
    content: advertisement.content || advertisement.imageCaption,
    forumUrl: advertisement.forumUrl,
    tags: advertisement.tags,
  });
}

export function applyTemplateToAdvertisement(advertisement: Advertisement, template: SavedTemplate): Partial<Advertisement> {
  return {
    title: advertisement.title || template.name,
    content: template.content,
    imageCaption: "",
    forumUrl: template.forumUrl,
    tags: template.tags,
    status: "draft",
  };
}

export function fromApiTemplate(value: ApiTemplate): SavedTemplate {
  return normalizeTemplate({
    id: value.id,
    name: value.name,
    content: value.content,
    forumUrl: value.forum_url,
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
    tags: template.tags,
    updated_at: template.updatedAt,
  };
}

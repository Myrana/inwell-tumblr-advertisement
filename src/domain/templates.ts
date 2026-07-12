import { Advertisement, ApiTemplate, SavedTemplate } from "./types";
import { uniqueTags } from "./tags";
import { sanitizeHtml } from "./htmlSanitizer";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeTemplate(value: Partial<SavedTemplate> | null | undefined): SavedTemplate {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  const content = typeof value?.content === "string" ? sanitizeHtml(value.content) : "";
  const forumUrl = typeof value?.forumUrl === "string" ? value.forumUrl : "";
  const imageClickThroughUrl = typeof value?.imageClickThroughUrl === "string" ? value.imageClickThroughUrl : "";
  const queueName = typeof value?.queueName === "string" ? value.queueName.trim() : "";
  const updatedAt = typeof value?.updatedAt === "string" ? value.updatedAt : "";

  return {
    id: typeof value?.id === "string" && value.id ? value.id : createId(),
    name: name || "Untitled template",
    content,
    forumUrl,
    imageClickThroughUrl,
    queueName,
    tags: Array.isArray(value?.tags) ? uniqueTags(value.tags) : [],
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

export function templateFromAdvertisement(advertisement: Advertisement, queueName = ""): SavedTemplate {
  return normalizeTemplate({
    name: advertisement.title || "Untitled template",
    content: advertisement.content || advertisement.imageCaption,
    forumUrl: "",
    imageClickThroughUrl: advertisement.imageClickThroughUrl,
    queueName,
    tags: [],
  });
}

export function applyTemplateToAdvertisement(template: SavedTemplate): Partial<Advertisement> {
  return {
    content: template.content,
    imageCaption: "",
    imageClickThroughUrl: template.imageClickThroughUrl,
    status: "draft",
  };
}

export function fromApiTemplate(value: ApiTemplate): SavedTemplate {
  return normalizeTemplate({
    id: value.id,
    name: value.name,
    content: value.content,
    forumUrl: value.forum_url,
    imageClickThroughUrl: value.image_click_through_url ?? "",
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
    image_click_through_url: template.imageClickThroughUrl,
    queue_name: template.queueName,
    tags: template.tags,
    updated_at: template.updatedAt,
  };
}

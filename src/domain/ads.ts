import { blogs } from "./constants";
import { Advertisement, ApiAdvertisement, StoredState } from "./types";

const removedSeedTargetIds = new Set(["inwell-ads", "jcink-directory", "roleplay-finder"]);
const starterImageName = "sample-forum-ad.png";
const starterImageDataUrl = "/sample-forum-ad.png";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `ad-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizedText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizedUpdatedAt(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  return Number.isNaN(new Date(value).getTime()) ? fallback : value;
}

export const emptyAd = (destinationBlog = blogs[0] ?? ""): Advertisement => ({
  id: createId(),
  postType: "photo",
  title: "",
  campaignName: "",
  content: "",
  destinationBlog,
  forumUrl: "",
  tags: [],
  imageCaption: "",
  imageName: starterImageName,
  imageDataUrl: starterImageDataUrl,
  videoUrl: "",
  videoName: "",
  status: "draft",
  updatedAt: new Date().toISOString(),
});

export function normalizeAd(value: Partial<Advertisement> | null | undefined): Advertisement {
  const fallback = emptyAd();
  const postType = value?.postType === "text" || value?.postType === "video" ? value.postType : "photo";
  const destinationBlog = normalizedText(value?.destinationBlog, fallback.destinationBlog);

  return {
    id: normalizedText(value?.id, fallback.id),
    postType,
    title: normalizedText(value?.title),
    campaignName: normalizedText(value?.campaignName),
    content: normalizedText(value?.content),
    destinationBlog: removedSeedTargetIds.has(destinationBlog) ? "" : destinationBlog,
    forumUrl: normalizedText(value?.forumUrl),
    tags: Array.isArray(value?.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : fallback.tags,
    imageCaption: normalizedText(value?.imageCaption),
    imageName: normalizedText(value?.imageName, fallback.imageName),
    imageDataUrl: normalizedText(value?.imageDataUrl, fallback.imageDataUrl),
    videoUrl: normalizedText(value?.videoUrl),
    videoName: normalizedText(value?.videoName),
    status: value?.status === "ready" || value?.status === "submitted" ? value.status : "draft",
    updatedAt: normalizedUpdatedAt(value?.updatedAt, fallback.updatedAt),
  };
}

export function normalizeStoredState(value: Partial<StoredState> | null | undefined): StoredState {
  const ads = Array.isArray(value?.ads) ? value.ads.map((ad) => normalizeAd(ad)) : [];
  if (!ads.length) {
    const fallback = emptyAd();
    return { ads: [fallback], activeAdId: fallback.id };
  }

  const requestedActiveAdId = value?.activeAdId;
  const activeAdId = requestedActiveAdId && ads.some((ad) => ad.id === requestedActiveAdId) ? requestedActiveAdId : ads[0].id;
  return { ads, activeAdId };
}

export function fromApiAdvertisement(value: ApiAdvertisement): Advertisement {
  return normalizeAd({
    id: value.id,
    postType: value.post_type,
    title: value.title,
    campaignName: value.campaign_name ?? "",
    content: value.content,
    destinationBlog: value.destination_blog,
    forumUrl: value.forum_url,
    tags: value.tags,
    imageCaption: value.image_caption,
    imageName: value.image_name,
    imageDataUrl: value.image_data_url,
    videoUrl: value.video_url ?? "",
    videoName: value.video_name ?? "",
    status: value.status,
    updatedAt: value.updated_at,
  });
}

export function toApiAdvertisement(advertisement: Advertisement): ApiAdvertisement {
  return {
    id: advertisement.id,
    post_type: advertisement.postType,
    title: advertisement.title,
    campaign_name: advertisement.campaignName,
    content: advertisement.content,
    destination_blog: advertisement.destinationBlog,
    forum_url: advertisement.forumUrl,
    tags: advertisement.tags,
    image_caption: advertisement.imageCaption,
    image_name: advertisement.imageName,
    image_data_url: advertisement.imageDataUrl,
    video_url: advertisement.videoUrl,
    video_name: advertisement.videoName,
    status: advertisement.status,
    updated_at: advertisement.updatedAt,
  };
}

export function composerContentFor(advertisement: Advertisement) {
  return advertisement.imageCaption || advertisement.content;
}

export function hasLibraryContent(advertisement: Advertisement) {
  return Boolean(
    advertisement.title.trim() ||
      advertisement.campaignName.trim() ||
      htmlToPlainText(composerContentFor(advertisement)) ||
      advertisement.destinationBlog.trim() ||
      advertisement.forumUrl.trim() ||
      advertisement.tags.length ||
      advertisement.postType !== "photo" ||
      advertisement.imageName.trim() !== starterImageName ||
      advertisement.imageDataUrl.trim() !== starterImageDataUrl ||
      advertisement.videoUrl.trim() ||
      advertisement.videoName.trim() ||
      advertisement.status !== "draft",
  );
}

export function htmlToPlainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

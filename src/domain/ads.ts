import { blogs } from "./constants";
import { Advertisement, ApiAdvertisement, StoredState } from "./types";

const removedSeedTargetIds = new Set(["inwell-ads", "jcink-directory", "roleplay-finder"]);

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `ad-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const emptyAd = (destinationBlog = blogs[0] ?? ""): Advertisement => ({
  id: createId(),
  postType: "photo",
  title: "",
  content: "",
  destinationBlog,
  forumUrl: "",
  tags: [],
  imageCaption: "",
  imageName: "sample-forum-ad.png",
  imageDataUrl: "/sample-forum-ad.png",
  videoUrl: "",
  videoName: "",
  status: "draft",
  updatedAt: new Date().toISOString(),
});

export function normalizeAd(value: Partial<Advertisement> | null | undefined): Advertisement {
  const fallback = emptyAd();
  const postType = value?.postType === "text" || value?.postType === "video" ? value.postType : "photo";

  return {
    ...fallback,
    ...value,
    postType,
    id: value?.id || fallback.id,
    destinationBlog: removedSeedTargetIds.has(value?.destinationBlog ?? "") ? "" : value?.destinationBlog ?? fallback.destinationBlog,
    tags: Array.isArray(value?.tags) ? value.tags : fallback.tags,
    status: value?.status === "ready" || value?.status === "submitted" ? value.status : "draft",
    updatedAt: value?.updatedAt || fallback.updatedAt,
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

export function htmlToPlainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

import { composerContentFor, htmlToPlainText } from "./ads";
import { Advertisement } from "./types";

export type DraftReadinessItem = {
  label: string;
  ready: boolean;
};

export type DraftReadinessScore = {
  items: DraftReadinessItem[];
  readyCount: number;
  totalCount: number;
  percent: number;
  label: string;
};

export function validateAdvertisement(advertisement: Advertisement) {
  const bodyText = htmlToPlainText(composerContentFor(advertisement));
  const imageClickThroughUrl = advertisement.imageClickThroughUrl?.trim() ?? "";
  const imageClickThroughIsHttp = !imageClickThroughUrl || /^https?:\/\/[^\s]+$/i.test(imageClickThroughUrl);
  const imageClickThroughIsSubmitPage = /tumblr\.com\/submit(?:[/?#]|$)/i.test(imageClickThroughUrl);
  return [
    !advertisement.title.trim() ? "Add a submission name." : "",
    !advertisement.forumUrl.trim() ? "Add a forum URL." : "",
    !advertisement.destinationBlog.trim() ? "Choose a target Tumblr blog." : "",
    !bodyText ? "Add post content." : "",
    advertisement.postType === "photo" && !advertisement.imageDataUrl.trim() && !advertisement.imageName.trim()
      ? "Choose an image for the photo post."
      : "",
    advertisement.postType === "photo" && !imageClickThroughIsHttp ? "Use a complete http:// or https:// image click-through URL." : "",
    advertisement.postType === "photo" && imageClickThroughIsSubmitPage
      ? "Use a reader destination for the image click-through URL, not a Tumblr submit page."
      : "",
    advertisement.postType === "video" && !advertisement.videoUrl.trim() && !advertisement.videoName.trim()
      ? "Add a video URL or upload a video file."
      : "",
  ].filter(Boolean);
}

export function scoreDraftReadiness(advertisement: Advertisement): DraftReadinessScore {
  const blockers = validateAdvertisement(advertisement);
  const bodyText = htmlToPlainText(composerContentFor(advertisement));
  const mediaReady =
    advertisement.postType === "text"
      ? true
      : advertisement.postType === "photo"
        ? Boolean(advertisement.imageDataUrl.trim() || advertisement.imageName.trim())
        : Boolean(advertisement.videoUrl.trim() || advertisement.videoName.trim());
  const items = [
    { label: "Submission name", ready: Boolean(advertisement.title.trim()) },
    { label: "Target blog", ready: Boolean(advertisement.destinationBlog.trim()) },
    { label: "Forum link", ready: Boolean(advertisement.forumUrl.trim()) },
    { label: "Post content", ready: Boolean(bodyText) && !blockers.includes("Add post content.") },
    { label: "Media", ready: mediaReady },
    { label: "Tags", ready: advertisement.tags.length > 0 },
  ];
  const readyCount = items.filter((item) => item.ready).length;
  const totalCount = items.length;
  const percent = Math.round((readyCount / totalCount) * 100);

  return {
    items,
    readyCount,
    totalCount,
    percent,
    label: `${percent}% ready`,
  };
}

export function buildPreparedPost(advertisement: Advertisement) {
  const richBody = composerContentFor(advertisement).trim();
  const sharedLines = [
    "",
    `Forum: ${advertisement.forumUrl.trim()}`,
    advertisement.tags.length ? `Tags: ${advertisement.tags.join(" ")}` : "",
  ].filter(Boolean);

  return advertisement.postType === "text"
    ? ["Tumblr Text Post", richBody, ...sharedLines].filter(Boolean).join("\n")
    : advertisement.postType === "video"
      ? [
          "Tumblr Video Post",
          advertisement.videoUrl.trim() ? `Video URL: ${advertisement.videoUrl.trim()}` : "",
          advertisement.videoName.trim() ? `Video file: ${advertisement.videoName.trim()}` : "",
          "",
          richBody,
          ...sharedLines,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "Tumblr Photo Post",
          advertisement.imageName.trim() ? `Image: ${advertisement.imageName.trim()}` : "",
          advertisement.imageClickThroughUrl?.trim() ? `Image destination: ${advertisement.imageClickThroughUrl.trim()}` : "",
          "",
          richBody,
          ...sharedLines,
        ]
          .filter(Boolean)
          .join("\n");
}

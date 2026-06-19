import { composerContentFor, htmlToPlainText } from "./ads";
import { Advertisement } from "./types";

export function validateAdvertisement(advertisement: Advertisement) {
  const bodyText = htmlToPlainText(composerContentFor(advertisement));
  return [
    !advertisement.title.trim() ? "Add a submission name." : "",
    !advertisement.forumUrl.trim() ? "Add a forum URL." : "",
    !advertisement.destinationBlog.trim() ? "Choose a target Tumblr blog." : "",
    !bodyText ? "Add post content." : "",
    advertisement.postType === "photo" && !advertisement.imageDataUrl.trim() && !advertisement.imageName.trim()
      ? "Choose an image for the photo post."
      : "",
    advertisement.postType === "video" && !advertisement.videoUrl.trim() && !advertisement.videoName.trim()
      ? "Add a video URL or upload a video file."
      : "",
  ].filter(Boolean);
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
          "",
          richBody,
          ...sharedLines,
        ]
          .filter(Boolean)
          .join("\n");
}

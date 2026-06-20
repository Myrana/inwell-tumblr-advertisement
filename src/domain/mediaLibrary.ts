import { Advertisement, PostType } from "./types";

export type MediaLibraryAsset = {
  id: string;
  kind: Extract<PostType, "photo" | "video">;
  name: string;
  sourceTitle: string;
  imageName: string;
  imageDataUrl: string;
  videoName: string;
  videoUrl: string;
  updatedAt: string;
};

export function mediaLibraryFromAdvertisements(advertisements: Advertisement[], activeAdId = "") {
  const seen = new Set<string>();
  const assets: MediaLibraryAsset[] = [];

  advertisements.forEach((advertisement) => {
    if (advertisement.id === activeAdId) {
      return;
    }

    const sourceTitle = advertisement.title.trim() || "Untitled submission";
    const photoName = advertisement.imageName.trim();
    const photoDataUrl = advertisement.imageDataUrl.trim();
    if (photoName || photoDataUrl) {
      const key = `photo:${photoName}:${photoDataUrl}`;
      if (!seen.has(key)) {
        seen.add(key);
        assets.push({
          id: key,
          kind: "photo",
          name: photoName || "Saved photo",
          sourceTitle,
          imageName: photoName,
          imageDataUrl: photoDataUrl,
          videoName: "",
          videoUrl: "",
          updatedAt: advertisement.updatedAt,
        });
      }
    }

    const videoName = advertisement.videoName.trim();
    const videoUrl = advertisement.videoUrl.trim();
    if (videoName || videoUrl) {
      const key = `video:${videoName}:${videoUrl}`;
      if (!seen.has(key)) {
        seen.add(key);
        assets.push({
          id: key,
          kind: "video",
          name: videoName || videoUrl || "Saved video",
          sourceTitle,
          imageName: "",
          imageDataUrl: "",
          videoName,
          videoUrl,
          updatedAt: advertisement.updatedAt,
        });
      }
    }
  });

  return assets.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 12);
}

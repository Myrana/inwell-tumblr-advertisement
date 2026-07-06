import { ImageIcon } from "lucide-react";
import { PostType } from "../../domain/types";
import { AD_PREVIEW_IMAGE_SRC } from "../sharedPreviewAssets";

type QueueItemThumbnailProps = {
  postType: PostType;
};

export function QueueItemThumbnail({ postType }: QueueItemThumbnailProps) {
  return (
    <span className="queue-item-thumb" aria-hidden="true">
      {postType === "photo" ? <img src={AD_PREVIEW_IMAGE_SRC} alt="" /> : <ImageIcon size={20} />}
    </span>
  );
}

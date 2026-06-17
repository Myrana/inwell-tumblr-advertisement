export type Status = "draft" | "ready" | "submitted";
export type PostType = "text" | "photo" | "video";
export type WorkspaceView = "editor" | "saved" | "queue";

export type Advertisement = {
  id: string;
  postType: PostType;
  title: string;
  content: string;
  destinationBlog: string;
  forumUrl: string;
  tags: string[];
  imageCaption: string;
  imageName: string;
  imageDataUrl: string;
  videoUrl: string;
  videoName: string;
  status: Status;
  updatedAt: string;
};

export type StoredState = {
  ads: Advertisement[];
  activeAdId: string;
};

export type TumblrSubmitTarget = {
  id: string;
  name: string;
  submitUrl: string;
};

export type SubmissionStatus = "queued" | "submitting" | "submitted" | "manual-action" | "failed";

export type SubmissionQueueItem = {
  id: string;
  adId: string;
  targetId: string;
  targetName: string;
  submitUrl: string;
  postType: PostType;
  status: SubmissionStatus;
  createdAt: string;
  updatedAt: string;
  notes: string;
  runnerPayload: string;
};

export type RunnerSettings = {
  mediaDir: string;
  slowMo: number;
  submit: boolean;
};

export type RunnerStatus = {
  running: boolean;
  pid: number | null;
  plan_path: string;
  command: string[];
};

export type OcrResult = {
  available: boolean;
  text: string;
  tags: string[];
  message: string;
};

export type ApiAdvertisement = {
  id: string;
  post_type?: PostType;
  title: string;
  content: string;
  destination_blog: string;
  forum_url: string;
  tags: string[];
  image_caption: string;
  image_name: string;
  image_data_url: string;
  video_url?: string;
  video_name?: string;
  status: Status;
  updated_at: string;
};

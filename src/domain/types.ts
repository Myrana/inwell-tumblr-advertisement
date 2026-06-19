export type Status = "draft" | "ready" | "submitted";
export type PostType = "text" | "photo" | "video";
export type WorkspaceView = "editor" | "saved" | "templates" | "queue" | "queue-settings" | "logs";

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

export type SavedTemplate = {
  id: string;
  name: string;
  content: string;
  forumUrl: string;
  tags: string[];
  updatedAt: string;
};

export type TumblrSubmitTarget = {
  id: string;
  name: string;
  submitUrl: string;
  forumUrl: string;
};

export type QueueDefinition = {
  id: string;
  name: string;
};

export type SubmissionStatus = "queued" | "scheduled" | "running" | "submitted" | "posted" | "needs-review" | "failed";

export type SubmissionQueueItem = {
  id: string;
  adId: string;
  targetId: string;
  targetName: string;
  queueName: string;
  submitUrl: string;
  postType: PostType;
  status: SubmissionStatus;
  scheduledFor: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string;
  postedAt: string;
  failedAt: string;
  notes: string;
  runnerPayload: string;
};

export type RunnerSettings = {
  mediaDir: string;
  slowMo: number;
  submit: boolean;
};

export type QueueScheduleSettings = {
  enabled: boolean;
  dailyTime: string;
  timezone: "America/New_York";
};

export type AppSettings = {
  submitTargets: TumblrSubmitTarget[];
  queueDefinitions: QueueDefinition[];
  tagProfiles: Record<string, string[]>;
  runnerSettings: RunnerSettings;
  queueScheduleSettings: QueueScheduleSettings;
};

export type RunnerStatus = {
  running: boolean;
  pid: number | null;
  plan_path: string;
  command: string[];
  run_id?: string;
};

export type RunnerLog = {
  id: string;
  runId: string;
  queueItemId: string;
  targetName: string;
  level: "info" | "warning" | "error";
  message: string;
  details: Record<string, unknown>;
  createdAt: string;
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

export type ApiTemplate = {
  id: string;
  name: string;
  content: string;
  forum_url: string;
  tags: string[];
  updated_at: string;
};

export type ApiQueueItem = {
  id: string;
  ad_id: string;
  target_id: string;
  target_name: string;
  queue_name?: string;
  submit_url: string;
  post_type: PostType;
  status: SubmissionStatus;
  scheduled_for?: string | null;
  timezone?: string;
  created_at: string;
  updated_at: string;
  last_run_at?: string | null;
  posted_at?: string | null;
  failed_at?: string | null;
  notes: string;
  runner_payload: string;
};

export type ApiRunnerLog = {
  id: string;
  run_id?: string;
  queue_item_id: string;
  target_name?: string;
  level: "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
  created_at: string;
};

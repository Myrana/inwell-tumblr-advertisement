import {
  Archive,
  Bold,
  Copy,
  FileText,
  ImagePlus,
  Italic,
  Link,
  Link2,
  List,
  ListOrdered,
  LogOut,
  Plus,
  Save,
  Send,
  Sparkles,
  Strikethrough,
  Tags,
  Trash2,
  Unlink,
  Video,
} from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import LinkExtension from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Status = "draft" | "ready" | "submitted";
type PostType = "text" | "photo" | "video";
type WorkspaceView = "editor" | "saved" | "queue";

type Advertisement = {
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

type TumblrSubmitTarget = {
  id: string;
  name: string;
  submitUrl: string;
};

type SubmissionStatus = "queued" | "submitting" | "submitted" | "manual-action" | "failed";

type SubmissionQueueItem = {
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

const storageKey = "inwell-ad-assistant-state";
const tagProfileStorageKey = "inwell-blog-tag-profiles";
const submitTargetStorageKey = "inwell-tumblr-submit-targets";
const submissionQueueStorageKey = "inwell-tumblr-submission-queue";
const apiBaseUrl = "http://127.0.0.1:8021/api";

type ApiAdvertisement = {
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

const defaultSubmitTargets: TumblrSubmitTarget[] = [
  { id: "inwell-ads", name: "inwell-ads", submitUrl: "https://inwell-ads.tumblr.com/submit" },
  { id: "jcink-directory", name: "jcink-directory", submitUrl: "https://jcink-directory.tumblr.com/submit" },
  { id: "roleplay-finder", name: "roleplay-finder", submitUrl: "https://roleplay-finder.tumblr.com/submit" },
];
const blogs = defaultSubmitTargets.map((target) => target.id);
const defaultTagProfiles: Record<string, string[]> = {
  "inwell-ads": [
    "invisionfree/zifboards site",
    "jcink site",
    "premium jcink",
    "site buzz",
    "advertisement",
    "character request",
    "staff request",
    "semi-private site",
    "public site",
    "short app",
    "shipper app",
    "profile app",
    "band celeb rpg",
    "city town rpg",
    "historical rpg",
    "school rpg",
    "other real life rpg",
    "futuristic postapoc rpg",
    "harry potter rpg",
    "supernatural rpg",
    "other fantasy rpg",
    "other scifi rpg",
    "based on rpg",
    "multi genre rpg",
    "animal rpg",
    "animated rpg",
    "resource site",
    "6 months",
    "1 year",
    "3 years",
  ],
  "jcink-directory": [
    "jcink site",
    "premium jcink",
    "advertisement",
    "character request",
    "staff request",
    "semi-private site",
    "public site",
    "short app",
    "shipper app",
    "supernatural rpg",
    "other fantasy rpg",
    "multi genre rpg",
    "1 year",
    "3 years",
  ],
  "roleplay-finder": [
    "advertisement",
    "public site",
    "semi-private site",
    "city town rpg",
    "historical rpg",
    "school rpg",
    "other real life rpg",
    "futuristic postapoc rpg",
    "animal rpg",
    "animated rpg",
    "6 months",
    "1 year",
  ],
};
const defaultSelectedTags = ["jcink site", "premium jcink", "semi-private site", "supernatural rpg", "1 year"];
const postTypes: { value: PostType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
];

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `ad-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const emptyAd = (): Advertisement => ({
  id: createId(),
  postType: "photo",
  title: "",
  content: "",
  destinationBlog: blogs[0],
  forumUrl: "",
  tags: defaultSelectedTags,
  imageCaption: "",
  imageName: "sample-forum-ad.png",
  imageDataUrl: "/sample-forum-ad.png",
  videoUrl: "",
  videoName: "",
  status: "draft",
  updatedAt: new Date().toISOString(),
});

type StoredState = {
  ads: Advertisement[];
  activeAdId: string;
};

function normalizeAd(value: Partial<Advertisement> | null | undefined): Advertisement {
  const fallback = emptyAd();
  const postType = value?.postType === "text" || value?.postType === "video" ? value.postType : "photo";

  return {
    ...fallback,
    ...value,
    postType,
    id: value?.id || fallback.id,
    tags: Array.isArray(value?.tags) ? value.tags : fallback.tags,
    status: value?.status === "ready" || value?.status === "submitted" ? value.status : "draft",
    updatedAt: value?.updatedAt || fallback.updatedAt,
  };
}

function fromApiAdvertisement(value: ApiAdvertisement): Advertisement {
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

function toApiAdvertisement(advertisement: Advertisement): ApiAdvertisement {
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

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function saveAdvertisement(advertisement: Advertisement) {
  await apiRequest<{ advertisement: ApiAdvertisement }>(`/advertisements/${advertisement.id}`, {
    method: "PUT",
    body: JSON.stringify(toApiAdvertisement(advertisement)),
  });
}

async function removeAdvertisement(id: string) {
  await apiRequest<{ deleted: string }>(`/advertisements/${id}`, { method: "DELETE" });
}

function loadStoredState(): StoredState {
  const fallback = emptyAd();

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { ads: [fallback], activeAdId: fallback.id };
    }

    const parsed = JSON.parse(raw) as StoredState;
    if (!Array.isArray(parsed.ads) || !parsed.ads.length || !parsed.activeAdId) {
      return { ads: [fallback], activeAdId: fallback.id };
    }

    const ads = parsed.ads.map((ad) => normalizeAd(ad));
    const activeAdId = ads.some((ad) => ad.id === parsed.activeAdId) ? parsed.activeAdId : ads[0].id;

    return { ads, activeAdId };
  } catch {
    return { ads: [fallback], activeAdId: fallback.id };
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatus(value: Status) {
  if (value === "draft") {
    return "saved";
  }

  return value;
}

function htmlToPlainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function composerContentFor(advertisement: Advertisement) {
  return advertisement.content || advertisement.imageCaption;
}

function normalizeTag(value: string) {
  return value.trim().replace(/^#/, "").replace(/\s+/g, " ");
}

function uniqueTags(values: string[]) {
  return Array.from(new Set(values.map(normalizeTag).filter(Boolean)));
}

function parseImportedTags(value: string) {
  return uniqueTags(
    value
      .replace(/^tags:\s*/gim, "")
      .split(/[\n,;]+/)
      .map((item) => item.replace(/^\[[ xX]?\]\s*/, "")),
  );
}

function normalizeSubmitUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (!url.hostname.endsWith("tumblr.com")) {
      return "";
    }

    url.protocol = "https:";
    url.pathname = "/submit";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function submitTargetFromUrl(value: string): TumblrSubmitTarget | null {
  const submitUrl = normalizeSubmitUrl(value);
  if (!submitUrl) {
    return null;
  }

  const hostname = new URL(submitUrl).hostname;
  const blogName = hostname.replace(/\.tumblr\.com$/i, "");
  const id = blogName.toLowerCase();

  return { id, name: blogName, submitUrl };
}

function fallbackTarget(id: string): TumblrSubmitTarget {
  const targetId = id.trim() || defaultSubmitTargets[0].id;
  return {
    id: targetId,
    name: targetId,
    submitUrl: `https://${targetId}.tumblr.com/submit`,
  };
}

function uniqueSubmitTargets(targets: TumblrSubmitTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (!target.id || seen.has(target.id)) {
      return false;
    }

    seen.add(target.id);
    return true;
  });
}

function loadSubmitTargets() {
  try {
    const raw = localStorage.getItem(submitTargetStorageKey);
    if (!raw) {
      return defaultSubmitTargets;
    }

    const parsed = JSON.parse(raw) as Partial<TumblrSubmitTarget>[];
    const imported = Array.isArray(parsed)
      ? parsed
          .map((target) => {
            const submitUrl = normalizeSubmitUrl(target.submitUrl ?? "");
            const id = (target.id ?? "").trim().toLowerCase();
            const name = (target.name ?? id).trim();
            return submitUrl && id ? { id, name: name || id, submitUrl } : null;
          })
          .filter((target): target is TumblrSubmitTarget => Boolean(target))
      : [];

    return uniqueSubmitTargets([...defaultSubmitTargets, ...imported]);
  } catch {
    return defaultSubmitTargets;
  }
}

function normalizeQueueItem(value: Partial<SubmissionQueueItem> | null | undefined): SubmissionQueueItem | null {
  if (!value?.id || !value.adId || !value.targetId || !value.submitUrl) {
    return null;
  }

  const status: SubmissionStatus =
    value.status === "submitting" ||
    value.status === "submitted" ||
    value.status === "manual-action" ||
    value.status === "failed"
      ? value.status
      : "queued";

  return {
    id: value.id,
    adId: value.adId,
    targetId: value.targetId,
    targetName: value.targetName || value.targetId,
    submitUrl: value.submitUrl,
    postType: value.postType === "text" || value.postType === "video" ? value.postType : "photo",
    status,
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || new Date().toISOString(),
    notes: value.notes || "",
    runnerPayload: value.runnerPayload || "",
  };
}

function loadSubmissionQueue() {
  try {
    const raw = localStorage.getItem(submissionQueueStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Partial<SubmissionQueueItem>[];
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeQueueItem(item)).filter((item): item is SubmissionQueueItem => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

function loadTagProfiles() {
  try {
    const raw = localStorage.getItem(tagProfileStorageKey);
    if (!raw) {
      return defaultTagProfiles;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profiles: Record<string, string[]> = { ...defaultTagProfiles };
    Object.entries(parsed).forEach(([blog, tags]) => {
      if (Array.isArray(tags)) {
        profiles[blog] = tags.length ? uniqueTags(tags as string[]) : (defaultTagProfiles[blog] ?? []);
      }
    });
    blogs.forEach((blog) => {
      profiles[blog] = profiles[blog] ?? defaultTagProfiles[blog];
    });
    return profiles;
  } catch {
    return defaultTagProfiles;
  }
}

function App() {
  const [stored, setStored] = useState<StoredState>(() => loadStoredState());
  const [submitTargets, setSubmitTargets] = useState<TumblrSubmitTarget[]>(() => loadSubmitTargets());
  const [submissionQueue, setSubmissionQueue] = useState<SubmissionQueueItem[]>(() => loadSubmissionQueue());
  const [tagProfiles, setTagProfiles] = useState<Record<string, string[]>>(() => loadTagProfiles());
  const [apiAvailable, setApiAvailable] = useState(false);
  const [customTag, setCustomTag] = useState("");
  const [newSubmitUrl, setNewSubmitUrl] = useState("");
  const [submitTargetStatus, setSubmitTargetStatus] = useState("");
  const [importText, setImportText] = useState("");
  const [importImageName, setImportImageName] = useState("");
  const [importImageDataUrl, setImportImageDataUrl] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [, setGeneratedPost] = useState("");
  const [queueStatus, setQueueStatus] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("editor");

  const activeAd = useMemo(
    () => stored.ads.find((ad) => ad.id === stored.activeAdId) ?? stored.ads[0],
    [stored],
  );
  const activeSubmitTarget = useMemo(
    () => submitTargets.find((target) => target.id === activeAd.destinationBlog) ?? fallbackTarget(activeAd.destinationBlog),
    [activeAd.destinationBlog, submitTargets],
  );
  const targetOptions = useMemo(
    () => uniqueSubmitTargets([...submitTargets, activeSubmitTarget]),
    [activeSubmitTarget, submitTargets],
  );

  const selectedTagCount = activeAd.tags.length;
  const readySubmissions = stored.ads.filter((ad) => ad.status === "ready").length;
  const activeQueue = submissionQueue.filter((item) => item.adId === activeAd.id);
  const activeBlogTags = tagProfiles[activeAd.destinationBlog] ?? defaultTagProfiles[activeAd.destinationBlog] ?? [];
  const checklistTags = uniqueTags([...activeBlogTags, ...activeAd.tags]);
  const parsedImportTags = parseImportedTags(importText);
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        LinkExtension.configure({
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
        }),
      ],
      content: composerContentFor(activeAd),
      editorProps: {
        attributes: {
          class: "tumblr-rich-editor",
          "aria-label": "Tumblr post content",
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        updateActiveAd({ content: currentEditor.getHTML(), imageCaption: "" });
      },
    },
    [activeAd.id],
  );

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(stored));
  }, [stored]);

  useEffect(() => {
    localStorage.setItem(submitTargetStorageKey, JSON.stringify(submitTargets));
  }, [submitTargets]);

  useEffect(() => {
    localStorage.setItem(submissionQueueStorageKey, JSON.stringify(submissionQueue));
  }, [submissionQueue]);

  useEffect(() => {
    localStorage.setItem(tagProfileStorageKey, JSON.stringify(tagProfiles));
  }, [tagProfiles]);

  useEffect(() => {
    const nextContent = composerContentFor(activeAd);

    if (!editor || editor.getHTML() === nextContent) {
      return;
    }

    editor.commands.setContent(nextContent, { emitUpdate: false });
  }, [activeAd.content, activeAd.imageCaption, editor]);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendState() {
      try {
        const advertisementResponse = await apiRequest<{ advertisements: ApiAdvertisement[] }>("/advertisements");

        if (cancelled) {
          return;
        }

        const backendAds = advertisementResponse.advertisements.map(fromApiAdvertisement);
        const nextAds = backendAds.length ? backendAds : stored.ads;
        const nextActiveAdId = nextAds.some((ad) => ad.id === stored.activeAdId)
          ? stored.activeAdId
          : nextAds[0].id;

        setStored({ ads: nextAds, activeAdId: nextActiveAdId });
        setApiAvailable(true);
      } catch {
        if (!cancelled) {
          setApiAvailable(false);
        }
      }
    }

    void loadBackendState();

    return () => {
      cancelled = true;
    };
  }, []);

  function syncAdvertisement(advertisement: Advertisement) {
    void saveAdvertisement(advertisement)
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
  }

  function updateActiveAd(patch: Partial<Advertisement>) {
    let nextActiveAd: Advertisement | null = null;

    setStored((current) => ({
      ...current,
      ads: current.ads.map((ad) =>
        ad.id === current.activeAdId
          ? (nextActiveAd = { ...ad, ...patch, updatedAt: new Date().toISOString() })
          : ad,
      ),
    }));

    if (nextActiveAd) {
      syncAdvertisement(nextActiveAd);
    }
  }

  function selectSubmitTarget(targetId: string) {
    const target = targetOptions.find((item) => item.id === targetId) ?? fallbackTarget(targetId);
    setSubmitTargetStatus(`Selected ${target.name}. Tumblr submit page: ${target.submitUrl}`);
    updateActiveAd({ destinationBlog: target.id });
  }

  function addSubmitTarget(event: FormEvent) {
    event.preventDefault();
    const target = submitTargetFromUrl(newSubmitUrl);

    if (!target) {
      setSubmitTargetStatus("Enter a Tumblr submit URL, like https://allthingsroleplay.tumblr.com/submit.");
      return;
    }

    setSubmitTargets((current) => uniqueSubmitTargets([...current, target]));
    setTagProfiles((current) => ({
      ...current,
      [target.id]: current[target.id] ?? [],
    }));
    updateActiveAd({ destinationBlog: target.id });
    setNewSubmitUrl("");
    setSubmitTargetStatus(`Added ${target.name}. Open ${target.submitUrl} when you are ready to paste the post into Tumblr.`);
  }

  function toggleTag(tag: string) {
    const exists = activeAd.tags.includes(tag);
    updateActiveAd({
      tags: exists ? activeAd.tags.filter((item) => item !== tag) : [...activeAd.tags, tag],
    });
  }

  function addCustomTag(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeTag(customTag);

    if (!normalized || activeAd.tags.includes(normalized)) {
      setCustomTag("");
      return;
    }

    updateActiveAd({ tags: [...activeAd.tags, normalized] });
    setTagProfiles((current) => ({
      ...current,
      [activeAd.destinationBlog]: uniqueTags([...(current[activeAd.destinationBlog] ?? []), normalized]),
    }));
    setCustomTag("");
  }

  function createDraft() {
    const next = emptyAd();
    setValidation([]);
    setGeneratedPost("");
    setTermsAccepted(false);
    setStored((current) => ({
      ads: [next, ...current.ads],
      activeAdId: next.id,
    }));
    syncAdvertisement(next);
  }

  function deleteDraft(id: string) {
    setStored((current) => {
      const remaining = current.ads.filter((ad) => ad.id !== id);
      if (!remaining.length) {
        const next = emptyAd();
        return { ads: [next], activeAdId: next.id };
      }

      return {
        ads: remaining,
        activeAdId: current.activeAdId === id ? remaining[0].id : current.activeAdId,
      };
    });
    void removeAdvertisement(id)
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
  }

  function saveDraft() {
    updateActiveAd({ status: "draft" });
    setValidation([]);
    setTermsAccepted(false);
  }

  function validateAd() {
    const bodyText = htmlToPlainText(composerContentFor(activeAd));
    const missing = [
      !activeAd.title.trim() ? "Add a saved submission name." : "",
      !activeAd.forumUrl.trim() ? "Add a forum URL." : "",
      !activeAd.destinationBlog.trim() ? "Choose a target Tumblr blog." : "",
      !bodyText ? "Add post content." : "",
      activeAd.postType === "photo" && !activeAd.imageDataUrl.trim() && !activeAd.imageName.trim()
        ? "Choose an image for the photo post."
        : "",
      activeAd.postType === "video" && !activeAd.videoUrl.trim() && !activeAd.videoName.trim()
        ? "Add a video URL or upload a video file."
        : "",
    ].filter(Boolean);

    setValidation(missing);
    return missing;
  }

  function buildPost() {
    const richBody = composerContentFor(activeAd).trim();
    const sharedLines = [
      "",
      `Forum: ${activeAd.forumUrl.trim()}`,
      activeAd.tags.length ? `Tags: ${activeAd.tags.join(" ")}` : "",
    ].filter(Boolean);

    return activeAd.postType === "text"
      ? ["Tumblr Text Post", richBody, ...sharedLines]
          .filter(Boolean)
          .join("\n")
      : activeAd.postType === "video"
        ? [
            "Tumblr Video Post",
            activeAd.videoUrl.trim() ? `Video URL: ${activeAd.videoUrl.trim()}` : "",
            activeAd.videoName.trim() ? `Video file: ${activeAd.videoName.trim()}` : "",
            "",
            richBody,
            ...sharedLines,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            "Tumblr Photo Post",
            activeAd.imageName.trim() ? `Image: ${activeAd.imageName.trim()}` : "",
            "",
            richBody,
            ...sharedLines,
          ]
            .filter(Boolean)
            .join("\n");
  }

  function generatePost() {
    const missing = validateAd();
    if (missing.length) {
      return;
    }

    const finalPost = buildPost();

    setGeneratedPost(finalPost);
    updateActiveAd({ status: "ready" });
  }

  function submitRecord() {
    const missing = validateAd();
    if (!termsAccepted) {
      missing.push("Accept the Terms of Submission.");
    }

    if (missing.length) {
      setValidation(missing);
      return;
    }

    setGeneratedPost(buildPost());
    updateActiveAd({ status: "submitted" });
  }

  function openSubmitPage() {
    const missing = validateAd();
    if (missing.length) {
      return;
    }

    setGeneratedPost(buildPost());
    window.open(activeSubmitTarget.submitUrl, "_blank", "noopener,noreferrer");
    setSubmitTargetStatus(
      `Opened ${activeSubmitTarget.name}. Choose ${activeAd.postType} on Tumblr, then paste the prepared submission package.`,
    );
  }

  function buildRunnerPayload(target: TumblrSubmitTarget) {
    const postPackage = buildPost();
    const composerContent = composerContentFor(activeAd);
    return JSON.stringify(
      {
        version: 1,
        workflow: "tumblr-public-submit-page",
        target,
        advertisement: {
          id: activeAd.id,
          savedOptionName: activeAd.title,
          postType: activeAd.postType,
          forumUrl: activeAd.forumUrl,
          tags: activeAd.tags,
          imageName: activeAd.imageName,
          imageDataUrl: activeAd.imageDataUrl,
          videoName: activeAd.videoName,
          videoUrl: activeAd.videoUrl,
        },
        fields: {
          body: composerContent,
          caption: composerContent,
          videoUrl: activeAd.videoUrl,
          imageDataUrl: activeAd.imageDataUrl,
          package: postPackage,
        },
        runnerNotes: [
          "Open submitUrl in a logged-in Tumblr browser session.",
          "Choose the matching text/photo/video form.",
          "Paste the prepared fields, upload local media when needed, accept required blog terms, and submit.",
          "If Tumblr shows login, captcha, or changed form markup, pause for manual action.",
        ],
      },
      null,
      2,
    );
  }

  function createQueueItem(target: TumblrSubmitTarget): SubmissionQueueItem {
    const timestamp = new Date().toISOString();
    return {
      id: `${activeAd.id}-${target.id}`,
      adId: activeAd.id,
      targetId: target.id,
      targetName: target.name,
      submitUrl: target.submitUrl,
      postType: activeAd.postType,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      notes: "Ready for local browser runner.",
      runnerPayload: buildRunnerPayload(target),
    };
  }

  function queueTargets(targets: TumblrSubmitTarget[]) {
    const missing = validateAd();
    if (missing.length) {
      return;
    }

    const nextItems = targets.map((target) => createQueueItem(target));
    setGeneratedPost(buildPost());
    setSubmissionQueue((current) => {
      const withoutExisting = current.filter(
        (item) => item.adId !== activeAd.id || !nextItems.some((next) => next.targetId === item.targetId),
      );
      return [...nextItems, ...withoutExisting];
    });
    setQueueStatus(`Queued ${nextItems.length} target${nextItems.length === 1 ? "" : "s"} for the local runner.`);
  }

  function updateQueueItem(id: string, status: SubmissionStatus, notes: string) {
    setSubmissionQueue((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              notes,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  }

  function clearCompletedQueueItems() {
    setSubmissionQueue((current) =>
      current.filter((item) => item.adId !== activeAd.id || !["submitted", "failed"].includes(item.status)),
    );
    setQueueStatus("Cleared submitted and failed entries for this saved submission.");
  }

  function copyRunnerPlan() {
    const plan = JSON.stringify(
      {
        version: 1,
        workflow: "tumblr-submission-queue",
        generatedAt: new Date().toISOString(),
        items: activeQueue,
      },
      null,
      2,
    );
    navigator.clipboard.writeText(plan);
    const blob = new Blob([plan], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tumblr-runner-plan.json";
    link.click();
    URL.revokeObjectURL(url);
    setQueueStatus(
      `Downloaded and copied runner plan for ${activeQueue.length} queued target${activeQueue.length === 1 ? "" : "s"}.`,
    );
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateActiveAd({
        imageName: file.name,
        imageDataUrl: String(reader.result),
      });
    };
    reader.readAsDataURL(file);
  }

  function handleVideoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    updateActiveAd({ videoName: file.name });
  }

  function handleTagScreenshotUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      setImportImageName(file.name);
      setImportImageDataUrl(dataUrl);
      setImportStatus("Screenshot loaded. Review or paste the tags before importing.");

      const textDetector = (window as typeof window & {
        TextDetector?: new () => { detect: (source: HTMLImageElement) => Promise<{ rawValue?: string }[]> };
      }).TextDetector;
      if (!textDetector) {
        return;
      }

      try {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const results = await new textDetector().detect(image);
        const detectedText = results.map((result) => result.rawValue ?? "").filter(Boolean).join("\n");
        if (detectedText) {
          setImportText(detectedText);
          setImportStatus("Text detected from screenshot. Review the tags before importing.");
        }
      } catch {
        setImportStatus("Screenshot loaded. Automatic text detection was not available for this image.");
      }
    };
    reader.readAsDataURL(file);
  }

  function updateActiveBlogTags(tags: string[]) {
    setTagProfiles((current) => ({
      ...current,
      [activeAd.destinationBlog]: uniqueTags(tags),
    }));
  }

  function replaceActiveBlogTags() {
    if (!parsedImportTags.length) {
      setImportStatus("Add or detect tags before replacing this blog profile.");
      return;
    }

    updateActiveBlogTags(parsedImportTags);
    setImportStatus(`Replaced ${activeAd.destinationBlog} with ${parsedImportTags.length} tags.`);
  }

  function mergeActiveBlogTags() {
    if (!parsedImportTags.length) {
      setImportStatus("Add or detect tags before merging into this blog profile.");
      return;
    }

    updateActiveBlogTags([...activeBlogTags, ...parsedImportTags]);
    setImportStatus(`Merged ${parsedImportTags.length} tags into ${activeAd.destinationBlog}.`);
  }

  const submissionComplete = activeAd.status === "submitted";
  const toolbarButtons = [
    {
      label: "Bold",
      icon: <Bold size={16} />,
      active: editor?.isActive("bold") ?? false,
      onClick: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: <Italic size={16} />,
      active: editor?.isActive("italic") ?? false,
      onClick: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "Strikethrough",
      icon: <Strikethrough size={16} />,
      active: editor?.isActive("strike") ?? false,
      onClick: () => editor?.chain().focus().toggleStrike().run(),
    },
    {
      label: "Link",
      icon: <Link2 size={16} />,
      active: editor?.isActive("link") ?? false,
      onClick: () => {
        const href = window.prompt("Link URL", editor?.getAttributes("link").href ?? "https://");
        if (!href) {
          return;
        }

        editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
      },
    },
    {
      label: "Unlink",
      icon: <Unlink size={16} />,
      active: false,
      onClick: () => editor?.chain().focus().unsetLink().run(),
    },
    {
      label: "Ordered list",
      icon: <ListOrdered size={16} />,
      active: editor?.isActive("orderedList") ?? false,
      onClick: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Bulleted list",
      icon: <List size={16} />,
      active: editor?.isActive("bulletList") ?? false,
      onClick: () => editor?.chain().focus().toggleBulletList().run(),
    },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">I</div>
          <div>
            <strong>Inwell</strong>
            <span>Tumblr Advertisement Assistant</span>
          </div>
        </div>

        <div className="account-strip">
          <span>Myrana Staff</span>
          <button className="icon-button" type="button" aria-label="Log out" title="Log out">
            <LogOut size={18} />
          </button>
        </div>

        <nav className="nav-list" aria-label="Workspace views">
          <button className={activeView === "editor" ? "active" : ""} type="button" onClick={() => setActiveView("editor")}>
            <FileText size={18} />
            Editor
          </button>
          <button className={activeView === "saved" ? "active" : ""} type="button" onClick={() => setActiveView("saved")}>
            <Archive size={18} />
            Saved Submissions
          </button>
          <button className={activeView === "queue" ? "active" : ""} type="button" onClick={() => setActiveView("queue")}>
            <Send size={18} />
            Queue
          </button>
        </nav>

        <section className="metric-panel" aria-label="Advertisement counts">
          <div>
            <span>{stored.ads.length}</span>
            <p>Saved</p>
          </div>
          <div>
            <span>{readySubmissions}</span>
            <p>Ready</p>
          </div>
          <div>
            <span>{selectedTagCount}</span>
            <p>Selected tags</p>
          </div>
          <div>
            <span>{apiAvailable ? "API" : "Local"}</span>
            <p>Storage</p>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Advertisement workspace</p>
            <h1>{activeAd.title || "Untitled saved submission"}</h1>
          </div>
          <div className="topbar-actions">
            <button className="secondary" type="button" onClick={createDraft}>
              <Plus size={18} />
              New
            </button>
            <button className="secondary" type="button" onClick={saveDraft}>
              <Save size={18} />
              Save
            </button>
            <button className="primary" type="button" onClick={generatePost}>
              <Sparkles size={18} />
              Prepare
            </button>
          </div>
        </header>

        {activeView === "editor" ? (
        <div className="workspace-grid editor-only">
          <section className="editor-surface" id="editor" aria-label="Advertisement editor">
            <div className="setup-panel">
              <div className="field-grid three">
              <label>
                Saved submission name
                <input
                  value={activeAd.title}
                  onChange={(event) => updateActiveAd({ title: event.target.value })}
                  placeholder="Open canons photo ad"
                />
                <span className="field-hint">Only used to find this saved submission again.</span>
              </label>

              <label>
                Target Tumblr blog
                <select
                  value={activeAd.destinationBlog}
                  onChange={(event) => selectSubmitTarget(event.target.value)}
                >
                  {targetOptions.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
                <span className="field-hint">{activeSubmitTarget.submitUrl}</span>
              </label>

              <label>
                Forum link
                <input
                  value={activeAd.forumUrl}
                  onChange={(event) => updateActiveAd({ forumUrl: event.target.value })}
                  placeholder="https://your-forum.jcink.net"
                />
                <span className="field-hint">Included in the queued Tumblr submission package.</span>
              </label>
              </div>
            </div>

            <form className="submit-target-manager" onSubmit={addSubmitTarget}>
              <label>
                Add Tumblr submit URL
                <input
                  value={newSubmitUrl}
                  onChange={(event) => setNewSubmitUrl(event.target.value)}
                  placeholder="https://allthingsroleplay.tumblr.com/submit"
                />
              </label>
              <button className="secondary" type="submit">
                <Plus size={18} />
                Add blog
              </button>
              <button className="secondary" type="button" onClick={openSubmitPage}>
                <Link2 size={18} />
                Open submit page
              </button>
              {submitTargetStatus ? <p>{submitTargetStatus}</p> : null}
            </form>

            {submissionComplete ? (
              <div className="tumblr-submit-shell">
                <div className="tumblr-thank-you" role="status">
                  <h2>Thank you!</h2>
                  <p>Your submission has been received and is awaiting moderator approval.</p>
                </div>
              </div>
            ) : (
              <div className="tumblr-submit-shell">
                <div className="tumblr-composer">
                  <div className="tumblr-composer-header">
                    <label>
                      <select
                        value={activeAd.postType}
                        onChange={(event) => updateActiveAd({ postType: event.target.value as PostType })}
                      >
                        {postTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="tumblr-blog-id">
                      <span>{activeSubmitTarget.name}</span>
                      <div className="tumblr-blog-avatar">I</div>
                    </div>
                  </div>

                  {activeAd.postType === "text" ? (
                    <input className="tumblr-title-input" placeholder="Title" aria-label="Optional Tumblr title" />
                  ) : null}

                  {activeAd.postType === "photo" ? (
                    <div className="tumblr-photo-stage">
                      <ImagePlus size={42} />
                      <strong>{activeAd.imageName || "Choose a photo"}</strong>
                      <label className="tumblr-file-button">
                        Upload image
                        <input type="file" accept="image/*" onChange={handleImageUpload} />
                      </label>
                    </div>
                  ) : null}

                  {activeAd.postType === "video" ? (
                    <div className="tumblr-photo-stage">
                      <Video size={42} />
                      <strong>{activeAd.videoName || "Choose a video"}</strong>
                      <input
                        value={activeAd.videoUrl}
                        onChange={(event) => updateActiveAd({ videoUrl: event.target.value })}
                        placeholder="Video URL"
                      />
                      <label className="tumblr-file-button">
                        Upload video
                        <input type="file" accept="video/*" onChange={handleVideoUpload} />
                      </label>
                    </div>
                  ) : null}

                  <div className="tumblr-editor-tools" aria-label="Editor tools">
                    {toolbarButtons.map((button) => (
                      <button
                        key={button.label}
                        className={button.active ? "active" : ""}
                        type="button"
                        title={button.label}
                        aria-label={button.label}
                        onClick={button.onClick}
                        disabled={!editor}
                      >
                        {button.icon}
                      </button>
                    ))}
                    <button type="button" title="Image" aria-label="Image" onClick={() => editor?.chain().focus().run()}>
                      <ImagePlus size={16} />
                    </button>
                    <button type="button" title="Queue current" aria-label="Queue current" onClick={() => queueTargets([activeSubmitTarget])}>
                      <Send size={16} />
                    </button>
                  </div>

                  <section className="tumblr-body-field" aria-label="Tumblr post content">
                    <EditorContent editor={editor} />
                  </section>
                </div>

                <div className="tumblr-tag-panel">
                  <div className="tag-toolbar">
                    <div>
                      <Tags size={18} />
                      <strong>Tags for {activeSubmitTarget.name}:</strong>
                    </div>
                    <form onSubmit={addCustomTag} className="custom-tag-form">
                      <input
                        value={customTag}
                        onChange={(event) => setCustomTag(event.target.value)}
                        placeholder="custom tag"
                      />
                      <button className="icon-button" type="submit" aria-label="Add custom tag" title="Add custom tag">
                        <Plus size={18} />
                      </button>
                    </form>
                  </div>

                  <div className="tag-import-panel">
                    <div className="tag-import-copy">
                      <strong>Import this blog's tags from a screenshot</strong>
                      <span>Upload the Tumblr tag form image, then review the detected or pasted tag text.</span>
                    </div>
                    <div className="tag-import-grid">
                      <label className="tumblr-file-button">
                        Upload tag screenshot
                        <input type="file" accept="image/*" onChange={handleTagScreenshotUpload} />
                      </label>
                      {importImageDataUrl ? (
                        <div className="tag-import-preview">
                          <img src={importImageDataUrl} alt="" />
                          <span>{importImageName}</span>
                        </div>
                      ) : null}
                      <label>
                        Tags found in screenshot
                        <textarea
                          value={importText}
                          onChange={(event) => setImportText(event.target.value)}
                          placeholder={"Paste one tag per line, or comma-separated tags, after uploading the screenshot."}
                        />
                      </label>
                    </div>
                    <div className="tag-import-actions">
                      <span>{parsedImportTags.length} tags ready</span>
                      <button className="secondary" type="button" onClick={mergeActiveBlogTags}>
                        Merge into blog
                      </button>
                      <button className="secondary" type="button" onClick={replaceActiveBlogTags}>
                        Replace blog tags
                      </button>
                    </div>
                    {importStatus ? <p className="tag-import-status">{importStatus}</p> : null}
                  </div>

                  <div className="tumblr-tag-grid">
                    {checklistTags.map((tag) => (
                      <label className="tumblr-tag-check" key={tag}>
                        <input
                          type="checkbox"
                          checked={activeAd.tags.includes(tag)}
                          onChange={() => toggleTag(tag)}
                        />
                        {tag}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="tumblr-submit-footer">
                  <label className="tumblr-terms">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                    />
                    I accept the <a href="#terms">Terms of Submission</a>
                  </label>
                  <button className="tumblr-submit-button" type="button" onClick={submitRecord}>
                    Submit
                  </button>
                  <button className="secondary" type="button" onClick={openSubmitPage}>
                    <Link2 size={18} />
                    Open Tumblr
                  </button>
                  <button className="secondary" type="button" onClick={() => queueTargets([activeSubmitTarget])}>
                    <Send size={18} />
                    Queue
                  </button>
                </div>
              </div>
            )}

            {validation.length ? (
              <div className="validation" role="alert">
                {validation.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : null}
          </section>

        </div>
        ) : null}

        {activeView === "queue" ? (
        <section className="submission-queue-panel queue-workspace" aria-label="Tumblr submission queue">
          <div className="panel-heading">
            <h2>Submission queue</h2>
            <Send size={18} />
          </div>
          <div className="queue-actions">
            <button className="secondary" type="button" onClick={() => queueTargets([activeSubmitTarget])}>
              <Plus size={18} />
              Queue current
            </button>
            <button className="secondary" type="button" onClick={() => queueTargets(targetOptions)}>
              <List size={18} />
              Queue all targets
            </button>
            <button className="secondary" type="button" onClick={copyRunnerPlan} disabled={!activeQueue.length}>
              <Copy size={18} />
              Export automation plan
            </button>
            <button className="secondary" type="button" onClick={clearCompletedQueueItems}>
              Clear completed
            </button>
          </div>
          {queueStatus ? <p className="queue-status">{queueStatus}</p> : null}
          <div className="queue-list">
            {activeQueue.length ? (
              activeQueue.map((item) => (
                <article className="queue-item" key={item.id}>
                  <div>
                    <strong>{item.targetName}</strong>
                  <span>{item.postType} - {item.status} - {formatDate(item.updatedAt)}</span>
                    <a href={item.submitUrl} target="_blank" rel="noreferrer">
                      {item.submitUrl}
                    </a>
                  </div>
                  <div className="queue-item-actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => updateQueueItem(item.id, "submitting", "Runner started this target.")}
                    >
                      Runner started
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        updateQueueItem(item.id, "manual-action", "Tumblr requires login, captcha, media upload, or form review.")
                      }
                    >
                      Needs action
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => updateQueueItem(item.id, "submitted", "Marked submitted after Tumblr accepted the form.")}
                    >
                      Submitted
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => updateQueueItem(item.id, "failed", "Marked failed for runner retry or review.")}
                    >
                      Failed
                    </button>
                  </div>
                  <p>{item.notes}</p>
                </article>
              ))
            ) : (
              <p className="queue-empty">Queue one or more Tumblr blogs, then run the automation step.</p>
            )}
          </div>
        </section>
        ) : null}

        {activeView === "saved" ? (
        <section className="draft-table" aria-label="Saved submissions">
          <div className="panel-heading">
            <h2>Saved submissions</h2>
            <Archive size={18} />
          </div>
          {stored.ads.map((ad) => (
            <article className={ad.id === activeAd.id ? "draft-row selected" : "draft-row"} key={ad.id}>
              <button
                type="button"
                onClick={() => {
                  setStored((current) => ({ ...current, activeAdId: ad.id }));
                  setActiveView("editor");
                }}
              >
                <strong>{ad.title || "Untitled saved submission"}</strong>
                <span>{ad.postType} - {formatStatus(ad.status)} - {formatDate(ad.updatedAt)}</span>
              </button>
              <a href={ad.forumUrl || "#"} aria-label="Forum URL">
                <Link size={18} />
              </a>
              <button
                className="icon-button"
                type="button"
                onClick={() => deleteDraft(ad.id)}
                aria-label="Delete saved submission"
                title="Delete saved submission"
              >
                <Trash2 size={18} />
              </button>
            </article>
          ))}
        </section>
        ) : null}
      </section>
    </main>
  );
}

export default App;

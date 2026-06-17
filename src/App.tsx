import {
  Archive,
  Bold,
  Copy,
  FileText,
  ImagePlus,
  Italic,
  Library,
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
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Status = "draft" | "ready" | "submitted";
type PostType = "text" | "photo" | "video";

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

type Template = {
  id: string;
  name: string;
  content: string;
  tags: string[];
  forumUrl: string;
};

type Snippet = {
  id: string;
  label: string;
  body: string;
};

type SuggestedTag = {
  tag: string;
};

const storageKey = "inwell-ad-assistant-state";
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

type ApiTemplate = {
  id: string;
  name: string;
  content: string;
  forum_url: string;
  tags: string[];
};

const suggestedTags: SuggestedTag[] = [
  { tag: "invisionfree/zifboards site" },
  { tag: "jcink site" },
  { tag: "premium jcink" },
  { tag: "site buzz" },
  { tag: "advertisement" },
  { tag: "character request" },
  { tag: "staff request" },
  { tag: "semi-private site" },
  { tag: "public site" },
  { tag: "short app" },
  { tag: "shipper app" },
  { tag: "profile app" },
  { tag: "band celeb rpg" },
  { tag: "city town rpg" },
  { tag: "historical rpg" },
  { tag: "school rpg" },
  { tag: "other real life rpg" },
  { tag: "futuristic postapoc rpg" },
  { tag: "harry potter rpg" },
  { tag: "supernatural rpg" },
  { tag: "other fantasy rpg" },
  { tag: "other scifi rpg" },
  { tag: "based on rpg" },
  { tag: "multi genre rpg" },
  { tag: "animal rpg" },
  { tag: "animated rpg" },
  { tag: "resource site" },
  { tag: "6 months" },
  { tag: "1 year" },
  { tag: "3 years" },
];

const blogs = ["inwell-ads", "jcink-directory", "roleplay-finder"];
const postTypes: { value: PostType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
];

const seedTemplates: Template[] = [
  {
    id: "template-plot-forward",
    name: "Plot-forward forum ad",
    forumUrl: "https://example-jcink-forum.test",
    tags: ["#jcink", "#jcink forum", "#forum rp", "#site advertisement"],
    content:
      "A character-driven Jcink forum with active plotting, seasonal events, and a welcoming staff team. New members can jump into open threads, browse wanted ads, and build long-form stories at their own pace.",
  },
  {
    id: "template-open-canons",
    name: "Open canons and wanted ads",
    forumUrl: "https://wanted-ads.example.test",
    tags: ["#jcink", "#forum roleplay", "#site advertisement"],
    content:
      "Open canons, wanted connections, and new-member prompts are ready for players who want an easy entry point. Browse the latest openings and bring a fresh character into the story.",
  },
];

const seedSnippets: Snippet[] = [
  {
    id: "snippet-stats",
    label: "Site statistics",
    body: "Established community, active staff, monthly prompts, and an accessible application process.",
  },
  {
    id: "snippet-plot",
    label: "Plot summary",
    body: "Ongoing story arcs leave room for new characters to affect factions, relationships, and site-wide events.",
  },
  {
    id: "snippet-links",
    label: "Useful links",
    body: "Quick links: guidebook, wanted ads, face claims, application template, and Discord information.",
  },
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
  tags: ["jcink site", "premium jcink", "semi-private site", "supernatural rpg", "1 year"],
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

function fromApiTemplate(value: ApiTemplate): Template {
  return {
    id: value.id,
    name: value.name,
    content: value.content,
    forumUrl: value.forum_url,
    tags: Array.isArray(value.tags) ? value.tags : [],
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

function App() {
  const [stored, setStored] = useState<StoredState>(() => loadStoredState());
  const [templates, setTemplates] = useState<Template[]>(seedTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(seedTemplates[0].id);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [customTag, setCustomTag] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [generatedPost, setGeneratedPost] = useState("");
  const [copyState, setCopyState] = useState("Copy");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const activeAd = useMemo(
    () => stored.ads.find((ad) => ad.id === stored.activeAdId) ?? stored.ads[0],
    [stored],
  );

  const selectedTagCount = activeAd.tags.length;
  const readyDrafts = stored.ads.filter((ad) => ad.status === "ready").length;

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(stored));
  }, [stored]);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendState() {
      try {
        const [advertisementResponse, templateResponse] = await Promise.all([
          apiRequest<{ advertisements: ApiAdvertisement[] }>("/advertisements"),
          apiRequest<{ templates: ApiTemplate[] }>("/templates"),
        ]);

        if (cancelled) {
          return;
        }

        const backendAds = advertisementResponse.advertisements.map(fromApiAdvertisement);
        const nextAds = backendAds.length ? backendAds : stored.ads;
        const nextActiveAdId = nextAds.some((ad) => ad.id === stored.activeAdId)
          ? stored.activeAdId
          : nextAds[0].id;
        const nextTemplates = templateResponse.templates.map(fromApiTemplate);

        setTemplates(nextTemplates.length ? nextTemplates : seedTemplates);
        setSelectedTemplateId((current) =>
          nextTemplates.some((template) => template.id === current)
            ? current
            : (nextTemplates[0]?.id ?? seedTemplates[0].id),
        );
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

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    setSelectedTemplateId(templateId);

    if (!template) {
      return;
    }

    updateActiveAd({
      content: template.content,
      forumUrl: template.forumUrl,
      tags: Array.from(new Set([...activeAd.tags, ...template.tags])),
    });
  }

  function toggleTag(tag: string) {
    const exists = activeAd.tags.includes(tag);
    updateActiveAd({
      tags: exists ? activeAd.tags.filter((item) => item !== tag) : [...activeAd.tags, tag],
    });
  }

  function addCustomTag(event: FormEvent) {
    event.preventDefault();
    const normalized = customTag.trim().startsWith("#")
      ? customTag.trim()
      : `#${customTag.trim()}`;

    if (normalized.length <= 1 || activeAd.tags.includes(normalized)) {
      setCustomTag("");
      return;
    }

    updateActiveAd({ tags: [...activeAd.tags, normalized] });
    setCustomTag("");
  }

  function addSnippet(snippet: Snippet) {
    const nextContent = activeAd.content
      ? `${activeAd.content}\n\n${snippet.body}`
      : snippet.body;
    updateActiveAd({ content: nextContent });
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
    const missing = [
      !activeAd.title.trim() ? "Add a title." : "",
      !activeAd.forumUrl.trim() ? "Add a forum URL." : "",
      !activeAd.destinationBlog.trim() ? "Choose a destination blog." : "",
      activeAd.postType === "text" && !activeAd.content.trim() ? "Add text post body copy." : "",
      activeAd.postType === "photo" && !activeAd.imageCaption.trim()
        ? "Add the picture post caption."
        : "",
      activeAd.postType === "photo" && !activeAd.imageDataUrl.trim() && !activeAd.imageName.trim()
        ? "Choose an image for the photo post."
        : "",
      activeAd.postType === "video" && !activeAd.imageCaption.trim()
        ? "Add the video caption or description."
        : "",
      activeAd.postType === "video" && !activeAd.videoUrl.trim() && !activeAd.videoName.trim()
        ? "Add a video URL or upload a video file."
        : "",
    ].filter(Boolean);

    setValidation(missing);
    return missing;
  }

  function buildPost() {
    const sharedLines = [
      "",
      `Forum: ${activeAd.forumUrl.trim()}`,
      activeAd.tags.length ? `Tags: ${activeAd.tags.join(" ")}` : "",
    ].filter(Boolean);

    return activeAd.postType === "text"
      ? ["Tumblr Text Post", activeAd.title.trim(), "", activeAd.content.trim(), ...sharedLines]
          .filter(Boolean)
          .join("\n")
      : activeAd.postType === "video"
        ? [
            "Tumblr Video Post",
            activeAd.title.trim(),
            activeAd.videoUrl.trim() ? `Video URL: ${activeAd.videoUrl.trim()}` : "",
            activeAd.videoName.trim() ? `Video file: ${activeAd.videoName.trim()}` : "",
            "",
            activeAd.imageCaption.trim(),
            activeAd.content.trim(),
            ...sharedLines,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            "Tumblr Photo Post",
            activeAd.title.trim(),
            activeAd.imageName.trim() ? `Image: ${activeAd.imageName.trim()}` : "",
            "",
            activeAd.imageCaption.trim(),
            activeAd.content.trim(),
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

  function copyPost() {
    if (!generatedPost) {
      return;
    }

    navigator.clipboard.writeText(generatedPost);
    setCopyState("Copied");
    window.setTimeout(() => setCopyState("Copy"), 1400);
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

  const contentLabel = activeAd.postType === "text" ? "Text post body" : "Optional advertisement copy";
  const contentPlaceholder =
    activeAd.postType === "text"
      ? "Write the Tumblr text post body."
      : "Add extra reusable copy below the caption if needed.";
  const previewPlaceholder = `Generate a ready-to-copy Tumblr ${activeAd.postType} post from the current draft.`;
  const submissionComplete = activeAd.status === "submitted";

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
          <a className="active" href="#editor">
            <FileText size={18} />
            Editor
          </a>
          <a href="#drafts">
            <Archive size={18} />
            Drafts
          </a>
          <a href="#library">
            <Library size={18} />
            Library
          </a>
        </nav>

        <section className="metric-panel" aria-label="Advertisement counts">
          <div>
            <span>{stored.ads.length}</span>
            <p>Drafts</p>
          </div>
          <div>
            <span>{readyDrafts}</span>
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
            <h1>{activeAd.title || "Untitled Tumblr forum advertisement"}</h1>
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
              Generate
            </button>
          </div>
        </header>

        <div className="workspace-grid">
          <section className="editor-surface" id="editor" aria-label="Advertisement editor">
            <div className="field-grid two">
              <label>
                Title
                <input
                  value={activeAd.title}
                  onChange={(event) => updateActiveAd({ title: event.target.value })}
                  placeholder="Open canons and active plots"
                />
              </label>

              <label>
                Destination blog
                <select
                  value={activeAd.destinationBlog}
                  onChange={(event) => updateActiveAd({ destinationBlog: event.target.value })}
                >
                  {blogs.map((blog) => (
                    <option key={blog} value={blog}>
                      {blog}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field-grid two">
              <label>
                Advertisement template
                <select value={selectedTemplateId} onChange={(event) => applyTemplate(event.target.value)}>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Forum URL
                <input
                  value={activeAd.forumUrl}
                  onChange={(event) => updateActiveAd({ forumUrl: event.target.value })}
                  placeholder="https://your-forum.jcink.net"
                />
              </label>
            </div>

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
                      <span>{activeAd.destinationBlog}</span>
                      <div className="tumblr-blog-avatar">I</div>
                    </div>
                  </div>

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
                    <Bold size={16} />
                    <Italic size={16} />
                    <Strikethrough size={16} />
                    <Link2 size={16} />
                    <Unlink size={16} />
                    <ListOrdered size={16} />
                    <List size={16} />
                    <ImagePlus size={16} />
                    <Send size={16} />
                  </div>

                  <label className="tumblr-body-field">
                    {contentLabel}
                    <textarea
                      value={activeAd.content}
                      onChange={(event) => updateActiveAd({ content: event.target.value })}
                      placeholder={contentPlaceholder}
                    />
                  </label>

                  {activeAd.postType !== "text" ? (
                    <label className="tumblr-caption-field">
                      {activeAd.postType === "photo" ? "Photo caption" : "Video caption"}
                      <input
                        value={activeAd.imageCaption}
                        onChange={(event) => updateActiveAd({ imageCaption: event.target.value })}
                        placeholder={
                          activeAd.postType === "photo"
                            ? "Write the caption Tumblr requires for this picture post."
                            : "Write the caption or description for the video post."
                        }
                      />
                    </label>
                  ) : null}
                </div>

                <div className="tumblr-tag-panel">
                  <div className="tag-toolbar">
                    <div>
                      <Tags size={18} />
                      <strong>Tags:</strong>
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

                  <div className="tumblr-tag-grid">
                    {suggestedTags.map((item) => (
                      <label className="tumblr-tag-check" key={item.tag}>
                        <input
                          type="checkbox"
                          checked={activeAd.tags.includes(item.tag)}
                          onChange={() => toggleTag(item.tag)}
                        />
                        {item.tag}
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

          <aside className="right-rail">
            <section className="preview-panel" aria-label="Generated post preview">
              <div className="panel-heading">
                <h2>Final post</h2>
                <button className="icon-button" type="button" onClick={copyPost} aria-label="Copy post" title="Copy post">
                  <Copy size={18} />
                </button>
              </div>
              <pre>{generatedPost || previewPlaceholder}</pre>
              <button className="primary full" type="button" onClick={submitRecord}>
                <Send size={18} />
                Mark submitted
              </button>
              <span className="copy-state">{copyState}</span>
            </section>

            <section className="library-panel" id="library" aria-label="Reusable content library">
              <div className="panel-heading">
                <h2>Content library</h2>
                <Library size={18} />
              </div>
              {seedSnippets.map((snippet) => (
                <button className="snippet" key={snippet.id} type="button" onClick={() => addSnippet(snippet)}>
                  <span>{snippet.label}</span>
                  <Plus size={16} />
                </button>
              ))}
            </section>
          </aside>
        </div>

        <section className="draft-table" id="drafts" aria-label="Saved drafts">
          <div className="panel-heading">
            <h2>Saved drafts</h2>
            <Archive size={18} />
          </div>
          {stored.ads.map((ad) => (
            <article className={ad.id === activeAd.id ? "draft-row selected" : "draft-row"} key={ad.id}>
              <button type="button" onClick={() => setStored((current) => ({ ...current, activeAdId: ad.id }))}>
                <strong>{ad.title || "Untitled advertisement"}</strong>
                <span>{ad.postType} - {ad.status} - {formatDate(ad.updatedAt)}</span>
              </button>
              <a href={ad.forumUrl || "#"} aria-label="Forum URL">
                <Link size={18} />
              </a>
              <button className="icon-button" type="button" onClick={() => deleteDraft(ad.id)} aria-label="Delete draft" title="Delete draft">
                <Trash2 size={18} />
              </button>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

export default App;

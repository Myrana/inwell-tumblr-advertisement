import "./linkSummary.css";

export function safeExternalUrl(value: string) {
  const candidate = value.trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

type LinkSummaryProps = {
  submitUrl: string;
  forumUrl: string;
  imageClickThroughUrl: string;
  compact?: boolean;
};

export function LinkSummary({ submitUrl, forumUrl, imageClickThroughUrl, compact = false }: LinkSummaryProps) {
  const rows = [
    { label: "Tumblr submission page", value: submitUrl },
    { label: "Forum link", value: forumUrl },
    { label: "Image click-through URL", value: imageClickThroughUrl },
  ];

  return (
    <dl className={compact ? "link-summary compact" : "link-summary"} aria-label="Link summary">
      {rows.map((row) => {
        const safeUrl = safeExternalUrl(row.value);
        return (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              {safeUrl ? (
                <a href={safeUrl} target="_blank" rel="noreferrer">{row.value}</a>
              ) : (
                <span>{row.value.trim() ? "Invalid or unsafe URL" : "Not set"}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

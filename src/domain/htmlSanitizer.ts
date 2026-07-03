const allowedTags = new Set(["A", "B", "BR", "EM", "I", "LI", "OL", "P", "STRONG", "UL"]);
const allowedSchemes = new Set(["http:", "https:", "mailto:"]);
const droppedContentTags = new Set(["EMBED", "IFRAME", "OBJECT", "SCRIPT", "STYLE", "TEMPLATE"]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return allowedSchemes.has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function cleanNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  if (droppedContentTags.has(element.tagName)) {
    return null;
  }

  if (!allowedTags.has(element.tagName)) {
    const fragment = document.createDocumentFragment();
    element.childNodes.forEach((child) => {
      const cleaned = cleanNode(child);
      if (cleaned) fragment.appendChild(cleaned);
    });
    return fragment;
  }

  const cleanedElement = document.createElement(element.tagName.toLowerCase());
  if (element.tagName === "A") {
    const href = safeHref(element.getAttribute("href") || "");
    if (href) {
      cleanedElement.setAttribute("href", href);
      cleanedElement.setAttribute("rel", "noopener noreferrer");
      cleanedElement.setAttribute("target", "_blank");
    }
  }

  element.childNodes.forEach((child) => {
    const cleaned = cleanNode(child);
    if (cleaned) cleanedElement.appendChild(cleaned);
  });
  return cleanedElement;
}

export function sanitizeHtml(value: string) {
  if (!value) {
    return "";
  }

  if (typeof document === "undefined" || typeof DOMParser === "undefined") {
    return escapeHtml(value);
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(value, "text/html");
  const fragment = document.createDocumentFragment();
  parsed.body.childNodes.forEach((node) => {
    const cleaned = cleanNode(node);
    if (cleaned) fragment.appendChild(cleaned);
  });

  const container = document.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

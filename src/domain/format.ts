import { Status, SubmissionStatus } from "./types";

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatStatus(value: Status) {
  if (value === "draft") {
    return "saved";
  }

  return value;
}

export function formatSubmissionStatus(value: SubmissionStatus) {
  if (value === "needs-review") return "Needs review";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatEasternDate(value: string) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function isoToDateTimeLocal(value: string) {
  if (!value) return "";
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function dateTimeLocalToIso(value: string) {
  return value ? new Date(value).toISOString() : "";
}

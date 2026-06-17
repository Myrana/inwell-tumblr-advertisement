import { Status } from "./types";

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

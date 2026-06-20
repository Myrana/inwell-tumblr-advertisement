import { QueueSchedulePreference } from "./types";

const easternTimeZone = "America/New_York";

export function normalizeDailyTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value) ? value : "09:00";
}

export function nextDailyRunAt(settings: QueueSchedulePreference, now = new Date()) {
  const dailyTime = normalizeDailyTime(settings.dailyTime);
  const [hour, minute] = dailyTime.split(":").map((part) => Number(part));
  const easternParts = easternDateParts(now);
  const todayCandidate = zonedDateTimeToUtc(easternParts.year, easternParts.month, easternParts.day, hour, minute);

  if (todayCandidate.getTime() > now.getTime()) {
    return todayCandidate.toISOString();
  }

  const tomorrow = new Date(Date.UTC(easternParts.year, easternParts.month - 1, easternParts.day + 1));
  const tomorrowParts = easternDateParts(tomorrow);
  return zonedDateTimeToUtc(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, hour, minute).toISOString();
}

export function scheduleSummary(settings: QueueSchedulePreference, now = new Date()) {
  if (!settings.enabled) {
    return "Daily automation is off.";
  }

  return `Daily automation is on. Next run: ${formatEasternRun(nextDailyRunAt(settings, now))}.`;
}

export function formatEasternRun(value: string) {
  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: easternTimeZone,
  }).format(new Date(value));
}

function easternDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: easternTimeZone,
    year: "numeric",
  }).formatToParts(date);

  return {
    day: Number(parts.find((part) => part.type === "day")?.value ?? "1"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "1"),
    year: Number(parts.find((part) => part.type === "year")?.value ?? "1970"),
  };
}

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMs = timeZoneOffsetMs(guess);
  return new Date(guess.getTime() - offsetMs);
}

function timeZoneOffsetMs(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: easternTimeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return asUtc - date.getTime();
}

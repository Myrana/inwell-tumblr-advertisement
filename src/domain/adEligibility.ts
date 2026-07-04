import { validateAdvertisement } from "./post";
import { Advertisement } from "./types";

export function queueEligibilityBlockers(advertisement: Advertisement) {
  return [
    advertisement.archived ? "Restore this archived ad before queueing." : "",
    ...validateAdvertisement(advertisement),
  ].filter(Boolean);
}

export function isQueueableAdvertisement(advertisement: Advertisement) {
  return queueEligibilityBlockers(advertisement).length === 0;
}

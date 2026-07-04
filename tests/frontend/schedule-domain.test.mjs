import assert from "node:assert/strict";
import test from "node:test";
import { formatEasternRun, nextDailyRunAt, scheduleSummary } from "../../src/domain/schedule.ts";

const dailyNine = {
  enabled: true,
  dailyTime: "09:00",
  timezone: "America/New_York",
  perQueue: {},
};

test("daily queue schedule rolls to tomorrow after today's Eastern run time", () => {
  const beforeRun = nextDailyRunAt(dailyNine, new Date("2026-07-04T12:59:00.000Z"));
  const atRun = nextDailyRunAt(dailyNine, new Date("2026-07-04T13:00:00.000Z"));
  const afterRun = nextDailyRunAt(dailyNine, new Date("2026-07-04T15:00:00.000Z"));

  assert.equal(formatEasternRun(beforeRun), "Jul 4, 2026, 9:00 AM");
  assert.equal(formatEasternRun(atRun), "Jul 5, 2026, 9:00 AM");
  assert.equal(formatEasternRun(afterRun), "Jul 5, 2026, 9:00 AM");
  assert.equal(
    scheduleSummary(dailyNine, new Date("2026-07-04T15:00:00.000Z")),
    "Daily automation is on. Next run: Jul 5, 2026, 9:00 AM.",
  );
});

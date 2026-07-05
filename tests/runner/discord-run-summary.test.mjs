import assert from "node:assert/strict";
import test from "node:test";
import {
  discordRunSummaryPayload,
  isDiscordWebhookUrl,
  normalizeDiscordTargetStatus,
  postDiscordRunSummary,
  truncateDiscordContent,
} from "../../scripts/discord-run-summary.mjs";

const plan = {
  items: [
    { id: "queue-item-1", targetName: "allthingsroleplay" },
    { id: "queue-item-2", targetName: "rpadverts" },
  ],
};

test("Discord summary payload includes queue targets and suppresses mentions", () => {
  const payload = discordRunSummaryPayload(
    { queueName: "Daily queue", submit: true },
    plan,
    {
      exitCode: 0,
      runnerResult: {
        targetResults: [
          { id: "queue-item-1", targetName: "allthingsroleplay", status: "submitted" },
          { id: "queue-item-2", targetName: "rpadverts", status: "completed" },
        ],
      },
    },
  );

  assert.match(payload.content, /Tumblr queue run completed/);
  assert.match(payload.content, /Queue: Daily queue/);
  assert.match(payload.content, /Mode: Live posting/);
  assert.match(payload.content, /Targets attempted: 2/);
  assert.match(payload.content, /Targets hit: 2/);
  assert.match(payload.content, /allthingsroleplay \(submitted\), rpadverts \(completed\)/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test("unknown Discord target statuses are needs-attention and not hits", () => {
  assert.equal(normalizeDiscordTargetStatus("surprise-status"), "unknown");
  const payload = discordRunSummaryPayload(
    { queueName: "Daily queue", submit: true },
    plan,
    {
      exitCode: 0,
      runnerResult: {
        targetResults: [
          { id: "queue-item-1", targetName: "allthingsroleplay", status: "submitted" },
          { id: "queue-item-2", targetName: "rpadverts", status: "surprise-status" },
        ],
      },
    },
  );

  assert.match(payload.content, /Tumblr queue run needs attention/);
  assert.match(payload.content, /Targets hit: 1/);
  assert.match(payload.content, /Unknown: 1/);
  assert.match(payload.content, /rpadverts \(unknown\)/);
});

test("Discord webhook URL validation accepts Discord and rejects lookalikes", () => {
  assert.equal(isDiscordWebhookUrl("https://discord.com/api/webhooks/123/token"), true);
  assert.equal(isDiscordWebhookUrl("https://discordapp.com/api/webhooks/123/token"), true);
  assert.equal(isDiscordWebhookUrl("https://discord.example.com/api/webhooks/123/token"), false);
  assert.equal(isDiscordWebhookUrl("http://discord.com/api/webhooks/123/token"), false);
  assert.equal(isDiscordWebhookUrl("http://127.0.0.1:9999/api/webhooks/test", { allowLocal: true }), true);
});

test("Discord summary truncates content at the delivery limit", () => {
  const longValue = "x".repeat(2000);
  const truncated = truncateDiscordContent(longValue);
  assert.equal(truncated.length, 1900);
  assert.match(truncated, /\.\.\.$/);
});

test("Discord summary skips prep runs and logs invalid configured URLs without failing", async () => {
  const requests = [];
  const logs = [];
  const skippedPrep = await postDiscordRunSummary(
    { queueName: "Daily queue", submit: false, discordWebhookUrl: "https://discord.com/api/webhooks/123/token" },
    plan,
    { exitCode: 0, runnerResult: { targetResults: [] } },
    {
      fetchImpl: async () => {
        requests.push("prep");
        return { ok: true, status: 204 };
      },
    },
  );
  assert.deepEqual(skippedPrep, { sent: false, reason: "not-live-run" });
  assert.deepEqual(requests, []);

  const invalid = await postDiscordRunSummary(
    { queueName: "Daily queue", submit: true, discordWebhookUrl: "not-a-webhook" },
    plan,
    { exitCode: 0, runnerResult: { targetResults: [] } },
    {
      fetchImpl: async () => {
        requests.push("invalid");
        return { ok: true, status: 204 };
      },
      log: (message) => logs.push(message),
    },
  );
  assert.deepEqual(invalid, { sent: false, reason: "invalid-url" });
  assert.deepEqual(requests, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /not a valid Discord webhook URL/);
  assert.doesNotMatch(logs[0], /not-a-webhook/);
});

const DISCORD_CONTENT_LIMIT = 1900;
const DISCORD_WEBHOOK_TIMEOUT_MS = 5000;

export async function postDiscordRunSummary(options, plan, result, settings = {}) {
  if (!options?.submit) {
    return { sent: false, reason: "not-live-run" };
  }
  if (!plan?.items?.length) {
    return { sent: false, reason: "empty-plan" };
  }

  const webhookUrl = String(options.discordWebhookUrl || "").trim();
  if (!webhookUrl) {
    return { sent: false, reason: "not-configured" };
  }
  if (!isDiscordWebhookUrl(webhookUrl, settings)) {
    settings.log?.("[local-runner] Discord webhook is configured but is not a valid Discord webhook URL; summary was skipped.");
    return { sent: false, reason: "invalid-url" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCORD_WEBHOOK_TIMEOUT_MS);
  const fetchImpl = settings.fetchImpl || fetch;
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify(discordRunSummaryPayload(options, plan, result)),
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error(`Discord webhook returned ${response.status}`);
  }
  return { sent: true, reason: "sent" };
}

export function discordDeliveryFailureSummary(error) {
  return {
    status: "failed",
    reason: "delivery-failed",
    message: "Discord summary failed. Check the local runner log for details.",
    logMessage: sanitizeDiscordFailureMessage(error instanceof Error ? error.message : String(error)),
  };
}

export function sanitizeDiscordFailureMessage(message) {
  return String(message || "Unknown Discord delivery error").replace(
    /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"'<>]+/gi,
    "[discord-webhook-url]",
  );
}

export function discordRunSummaryPayload(options, plan, result) {
  return {
    content: discordRunSummaryContent(options, plan, result),
    allowed_mentions: { parse: [] },
  };
}

export function isDiscordWebhookUrl(value, settings = {}) {
  try {
    const url = new URL(value);
    const allowLocal = settings.allowLocal ?? process.env.INWELL_DISCORD_WEBHOOK_ALLOW_LOCAL === "1";
    if (allowLocal && url.protocol === "http:" && /^127\.0\.0\.1$|^localhost$/i.test(url.hostname)) {
      return true;
    }
    return url.protocol === "https:" && ["discord.com", "discordapp.com"].includes(url.hostname) && url.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

export function discordRunSummaryContent(options, plan, result) {
  const targetResults = discordTargetResults(plan, result);
  const attemptedCount = targetResults.length;
  const hitCount = targetResults.filter((target) => target.status === "submitted" || target.status === "completed").length;
  const reviewCount = targetResults.filter((target) => target.status === "needs-review").length;
  const failedCount = targetResults.filter((target) => target.status === "failed").length;
  const unknownCount = targetResults.filter((target) => target.status === "unknown").length;
  const statusLine = result.exitCode || reviewCount || failedCount || unknownCount ? "Needs attention" : "Completed";
  const lines = [
    `Tumblr queue run ${statusLine.toLowerCase()}.`,
    "",
    `Queue: ${options.queueName}`,
    "Mode: Live posting",
    `Targets attempted: ${attemptedCount}`,
    `Targets hit: ${hitCount}`,
    `Needs review: ${reviewCount}`,
    `Failed: ${failedCount}`,
    `Unknown: ${unknownCount}`,
    `Targets: ${formatDiscordTargets(targetResults)}`,
  ];
  if (result.exitCode) {
    lines.push(`Exit code: ${result.exitCode}`);
  }
  return truncateDiscordContent(lines.join("\n"));
}

export function discordTargetResults(plan, result) {
  const resultTargets = Array.isArray(result?.runnerResult?.targetResults) ? result.runnerResult.targetResults : [];
  if (resultTargets.length) {
    return resultTargets.map((target) => ({
      name: String(target?.targetName || target?.id || "Tumblr target"),
      status: normalizeDiscordTargetStatus(target?.status),
    }));
  }
  const fallbackStatus = result?.exitCode ? "failed" : "unknown";
  return (Array.isArray(plan.items) ? plan.items : []).map((item) => ({
    name: String(item.targetName || item.targetId || item.id || "Tumblr target"),
    status: fallbackStatus,
  }));
}

export function normalizeDiscordTargetStatus(status) {
  return ["submitted", "completed", "needs-review", "failed"].includes(status) ? status : "unknown";
}

export function formatDiscordTargets(targets) {
  const uniqueTargets = Array.from(new Map(targets.map((target) => [target.name.trim(), target])).values()).filter((target) => target.name);
  if (!uniqueTargets.length) {
    return "None";
  }
  const displayed = uniqueTargets.slice(0, 12);
  const suffix = uniqueTargets.length > displayed.length ? `, +${uniqueTargets.length - displayed.length} more` : "";
  return `${displayed.map((target) => `${target.name} (${target.status})`).join(", ")}${suffix}`;
}

export function truncateDiscordContent(value) {
  return value.length <= DISCORD_CONTENT_LIMIT ? value : `${value.slice(0, DISCORD_CONTENT_LIMIT - 3)}...`;
}

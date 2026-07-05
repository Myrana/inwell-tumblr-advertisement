const originalFetch = globalThis.fetch;

globalThis.fetch = async function discordFetchFailureHook(input, init) {
  const url = String(input?.url || input || "");
  if (/^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\//i.test(url)) {
    throw new Error(`request failed for ${url}`);
  }
  return originalFetch(input, init);
};

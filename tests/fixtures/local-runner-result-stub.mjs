#!/usr/bin/env node
import fs from "node:fs";

const resultPathIndex = process.argv.indexOf("--result-path");
const resultPath = resultPathIndex >= 0 ? process.argv[resultPathIndex + 1] : "";
const result = process.env.INWELL_LOCAL_RUNNER_RESULT_JSON
  ? JSON.parse(process.env.INWELL_LOCAL_RUNNER_RESULT_JSON)
  : { status: "success", blockerCode: "", failureKind: "", message: "", targetResults: [] };

if (resultPath && process.env.INWELL_LOCAL_RUNNER_SKIP_RESULT_WRITE !== "1") {
  const content = process.env.INWELL_LOCAL_RUNNER_MALFORMED_RESULT === "1"
    ? "{malformed-result-json"
    : JSON.stringify(result, null, 2);
  fs.writeFileSync(resultPath, content, "utf8");
}

process.exit(Number(process.env.INWELL_LOCAL_RUNNER_EXIT_CODE || "0") || 0);

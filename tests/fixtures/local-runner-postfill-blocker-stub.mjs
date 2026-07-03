#!/usr/bin/env node
import fs from "node:fs";

const resultPath = process.argv[process.argv.indexOf("--result-path") + 1];
if (resultPath) {
  fs.writeFileSync(resultPath, JSON.stringify({
    status: "error",
    blockerCode: "headless_manual_review_required",
    failureKind: "headless_blocker",
    message: "Page requires review before submit.",
  }), "utf8");
}
process.exit(1);

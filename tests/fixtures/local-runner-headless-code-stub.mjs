#!/usr/bin/env node
import fs from "node:fs";

const resultPath = process.argv[process.argv.indexOf("--result-path") + 1];
if (resultPath) {
  fs.writeFileSync(resultPath, JSON.stringify({
    status: "error",
    blockerCode: "headless_login_required",
    failureKind: "headless_blocker",
    message: "Tumblr asked for login before the submit form was available.",
  }), "utf8");
}
process.exit(1);

#!/usr/bin/env node
import fs from "node:fs";

const outputPath = process.env.INWELL_LOCAL_RUNNER_ARGS_PATH;
if (outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify(process.argv.slice(2), null, 2), "utf8");
}

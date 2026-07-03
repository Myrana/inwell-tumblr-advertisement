#!/usr/bin/env node
import fs from "node:fs";

const outputPath = process.env.INWELL_LOCAL_LOGIN_RECORD_PATH;
if (outputPath) {
  fs.writeFileSync(outputPath, "launched", "utf8");
}

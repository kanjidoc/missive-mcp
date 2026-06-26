// scripts/extract-changelog.mjs — print the CHANGELOG.md section for a version.
// Zero-dependency ESM so the release workflow needs no `npm install`.
//
// Usage:  node scripts/extract-changelog.mjs <version>
// Prints the section body (the heading line itself excluded) to stdout.
// Exits non-zero with a stderr message if the version arg is missing, the
// CHANGELOG file is missing, or the section is absent or empty.
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("extract-changelog: usage: node scripts/extract-changelog.mjs <version>");
  process.exit(1);
}

let lines;
try {
  lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split(/\r?\n/);
} catch {
  console.error("extract-changelog: cannot read CHANGELOG.md");
  process.exit(1);
}

// Match a heading line that, after trimming, starts with `## [<version>]`.
// The `]` terminator means `0.1.1` never matches `## [0.1.10]`.
const headingPrefix = `## [${version}]`;
const start = lines.findIndex((line) => line.trim().startsWith(headingPrefix));
if (start === -1) {
  console.error(`extract-changelog: no '${headingPrefix}' section in CHANGELOG.md`);
  process.exit(1);
}

// The section ends at the next `## [` heading, or end of file.
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i].trim().startsWith("## [")) {
    end = i;
    break;
  }
}

const body = lines.slice(start + 1, end).join("\n").trim();
if (body === "") {
  console.error(`extract-changelog: section '${headingPrefix}' is empty`);
  process.exit(1);
}
console.log(body);

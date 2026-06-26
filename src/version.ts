// src/version.ts — the ONLY place package.json's version is read.
// `require` (not a JSON `import`) keeps this immune to how tsc's `rootDir` /
// `resolveJsonModule` settings treat a package.json outside src/ (behaviour
// varies by tsc version). From dist/version.js, `../package.json` resolves to
// the package root.
let version = "unknown";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkg = require("../package.json") as { version?: string };
  if (typeof pkg.version === "string" && pkg.version) version = pkg.version;
} catch {
  // package.json unreadable (an unsupported install layout) — keep "unknown"
  // rather than throwing at module load and preventing the server starting.
}

/** The server's version, from package.json (the single source of truth). */
export function getVersion(): string {
  return version;
}

// Suspicious-file detection for the release preflight (#466, EPIC #465).
//
// Any packed file whose path matches one of these rules must NEVER ship in the
// published `plotlink-ows` package. The package.json `files` allowlist already
// excludes them (negation patterns); this is the preflight's belt-and-suspenders
// detection so a regression is caught before publish. Keep the two in sync.

export const SUSPICIOUS_RULES = [
  { re: /(^|\/)node_modules\//, label: "bundled node_modules" },
  { re: /\.(test|spec)\.[cm]?[jt]sx?$/, label: "test/spec file" },
  { re: /(^|\/)(__fixtures__|fixtures)\/|\.fixture\./, label: "test fixture" },
  { re: /\.snap$/, label: "test snapshot" },
  { re: /(^|\/)e2e[-/]/, label: "e2e/test tooling" },
  { re: /\.tgz$/, label: "packed tarball" },
  { re: /(^|\/)(\.next\/cache|\.turbo|\.vite|\.cache|coverage|\.nyc_output)\//, label: "build/coverage cache" },
  { re: /(^|\/)screenshots?\/|(^|\/)screenshot-/, label: "screenshot/marketing image" },
  { re: /(^|\/)(tmp|temp)\/|\.(log|tmp|bak|swp)$/, label: "temp/log file" },
  { re: /(^|\/)\.env(\..+)?$|\.(pem|key)$/, label: "possible secret/credential file" },
];

// The runtime files the published package MUST contain. A `files`-allowlist
// change that drops one of these fails the preflight (#468). `app/web/dist` is
// required because the CLI serves the prebuilt web UI from it.
export const REQUIRED_PACK_FILES = [
  "package.json",
  "README.md",
  "LICENSE",
  "bin/plotlink-ows.js",
  // The bin requires this in-package helper at runtime (start-path boundary
  // planner); `files` ships all of `bin/`, but listing it here fails preflight
  // if a future exclusion drops it (#470).
  "bin/startup-plan.cjs",
  "app/server.ts",
  // Imported by app/server.ts at boot to apply the local SQLite schema without
  // the native Prisma schema-engine (#484).
  "app/lib/apply-schema.ts",
  // The committed DDL apply-schema reads at startup — the installed app applies
  // this instead of running `prisma db push` (#484).
  "app/prisma/schema.sql",
  "app/prisma/schema.prisma",
  "app/web/dist/index.html",
  // Root-lib file the server runtime imports at boot (publish route →
  // `../../lib/genres`); `files` packs only `lib/ows/`, so it must be listed
  // explicitly or the published CLI fails to start (#469).
  "lib/genres.ts",
];

// The published OWS CLI runtime install path (`dependencies`). EPIC #465 keeps
// this set MINIMAL — only packages the CLI actually loads at runtime (the server
// in `app/`, the `bin/` wizard, and the runtime helpers in `lib/`). Web-app
// (`src/`), build-time, and direct-upload-only packages belong in
// `devDependencies` (see DEPENDENCIES.md): React/Vite/etc. (#469) and
// `@aws-sdk/client-s3` (#471 — OWS uploads go through the PlotLink API, so the
// S3/Filebase client is web-app-only). A new entry here must be a genuine OWS
// runtime import; add it consciously (and document it) rather than by accident.
export const ALLOWED_RUNTIME_DEPS = [
  "@hono/node-server",
  "@open-wallet-standard/core",
  "@prisma/client",
  "@supabase/supabase-js",
  "dotenv",
  "hono",
  "node-pty",
  "prisma",
  "tsx",
  "viem",
  "ws",
];

/**
 * Runtime `dependencies` that are NOT in the OWS runtime allowlist — i.e. a
 * web-app/build-time/upload-only package that leaked into the published install
 * path (#471, EPIC #465). An empty array means the install path is clean.
 */
export function findRuntimeDepLeaks(pkg) {
  const allowed = new Set(ALLOWED_RUNTIME_DEPS);
  return Object.keys(pkg.dependencies ?? {}).filter((d) => !allowed.has(d));
}

/** Return the REQUIRED_PACK_FILES that are NOT in the packed path list. */
export function findMissingRequired(paths) {
  const set = new Set(paths);
  return REQUIRED_PACK_FILES.filter((req) => !set.has(req));
}

/**
 * Return `[{ label, path }]` for every path matching a suspicious rule (first
 * match wins per path). An empty array means the file list is clean.
 */
export function findSuspicious(paths) {
  const out = [];
  for (const path of paths) {
    for (const rule of SUSPICIOUS_RULES) {
      if (rule.re.test(path)) { out.push({ label: rule.label, path }); break; }
    }
  }
  return out;
}

/**
 * The files a freshly-installed package MUST contain to function: the bin(s),
 * the app entrypoints, AND every file the install LIFECYCLE references — notably
 * the `--schema <path>` the `postinstall` runs `prisma generate` against (#466,
 * re1). The smoke test asserts these are present, so a `files`-allowlist
 * regression that drops a postinstall prerequisite fails the preflight instead
 * of silently breaking a real `npm install` of the published tarball.
 */
export function requiredInstalledFiles(pkg) {
  const required = ["package.json", "app/server.ts", "app/web/dist/index.html"];
  const binPaths = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
  for (const b of binPaths) if (b) required.push(String(b).replace(/^\.?\//, ""));
  // Every `--schema <path>` referenced by the postinstall lifecycle.
  const postinstall = pkg.scripts?.postinstall ?? "";
  for (const m of postinstall.matchAll(/--schema[= ]+(\S+)/g)) required.push(m[1]);
  return [...new Set(required)];
}

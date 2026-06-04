// Suspicious-file detection for the release preflight (#466, EPIC #465).
//
// Any packed file whose path matches one of these rules must NEVER ship in the
// published `plotlink-ows` package. The package.json `files` allowlist already
// excludes them (negation patterns); this is the preflight's belt-and-suspenders
// detection so a regression is caught before publish. Keep the two in sync.

export const SUSPICIOUS_RULES = [
  { re: /(^|\/)node_modules\//, label: "bundled node_modules" },
  { re: /\.(test|spec)\.[cm]?[jt]sx?$/, label: "test/spec file" },
  { re: /\.tgz$/, label: "packed tarball" },
  { re: /(^|\/)(\.next\/cache|\.turbo|\.vite|\.cache)\//, label: "build cache" },
  { re: /(^|\/)\.env(\..+)?$|\.(pem|key)$/, label: "possible secret/credential file" },
];

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

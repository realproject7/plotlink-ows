import { describe, it, expect } from "vitest";
import { findSuspicious, SUSPICIOUS_RULES, requiredInstalledFiles, findMissingRequired, REQUIRED_PACK_FILES } from "./package-hygiene.mjs";

// #466: the release preflight must flag generated/local artifacts that must
// never ship in the published package, and leave legitimate runtime files alone.
describe("package hygiene suspicious-file detection (#466)", () => {
  it("flags bundled node_modules, test/spec files, tarballs, build caches, and secrets", () => {
    const flagged = findSuspicious([
      "packages/cli/node_modules/commander/index.js",
      "app/lib/cartoon-coach.test.ts",
      "app/web/components/PreviewPanel.test.tsx",
      "app/lib/foo.spec.tsx",
      "plotlink-ows-1.2.84.tgz",
      "app/web/.vite/deps/x.js",
      "app/.next/cache/bundle.js",
      ".env",
      "app/.env.local",
      "lib/ows/wallet.key",
      "lib/ows/cert.pem",
    ]);
    const byPath = Object.fromEntries(flagged.map((f) => [f.path, f.label]));
    expect(byPath["packages/cli/node_modules/commander/index.js"]).toBe("bundled node_modules");
    expect(byPath["app/lib/cartoon-coach.test.ts"]).toBe("test/spec file");
    expect(byPath["app/web/components/PreviewPanel.test.tsx"]).toBe("test/spec file");
    expect(byPath["app/lib/foo.spec.tsx"]).toBe("test/spec file");
    expect(byPath["plotlink-ows-1.2.84.tgz"]).toBe("packed tarball");
    expect(byPath["app/web/.vite/deps/x.js"]).toBe("build/coverage cache");
    expect(byPath["app/.next/cache/bundle.js"]).toBe("build/coverage cache");
    expect(byPath[".env"]).toBe("possible secret/credential file");
    expect(byPath["app/.env.local"]).toBe("possible secret/credential file");
    expect(byPath["lib/ows/wallet.key"]).toBe("possible secret/credential file");
    expect(byPath["lib/ows/cert.pem"]).toBe("possible secret/credential file");
    // Every seeded path was flagged.
    expect(flagged).toHaveLength(11);
  });

  // #468: extended denylist — fixtures, snapshots, e2e tooling, coverage,
  // screenshots, and temp/log files must also be flagged.
  it("flags fixtures, snapshots, e2e tooling, coverage, screenshots, and temp/log files (#468)", () => {
    const flagged = findSuspicious([
      "app/lib/__fixtures__/sample.json",
      "app/lib/data.fixture.ts",
      "app/web/components/__snapshots__/x.snap",
      "scripts/e2e-verify.ts",
      "coverage/lcov.info",
      "app/.nyc_output/out.json",
      "public/screenshot-1.png",
      "public/screenshots/feature.png",
      "tmp/scratch.txt",
      "app/server.log",
      "x.bak",
    ]);
    const byPath = Object.fromEntries(flagged.map((f) => [f.path, f.label]));
    expect(byPath["app/lib/__fixtures__/sample.json"]).toBe("test fixture");
    expect(byPath["app/lib/data.fixture.ts"]).toBe("test fixture");
    expect(byPath["app/web/components/__snapshots__/x.snap"]).toBe("test snapshot");
    expect(byPath["scripts/e2e-verify.ts"]).toBe("e2e/test tooling");
    expect(byPath["coverage/lcov.info"]).toBe("build/coverage cache");
    expect(byPath["app/.nyc_output/out.json"]).toBe("build/coverage cache");
    expect(byPath["public/screenshot-1.png"]).toBe("screenshot/marketing image");
    expect(byPath["public/screenshots/feature.png"]).toBe("screenshot/marketing image");
    expect(byPath["tmp/scratch.txt"]).toBe("temp/log file");
    expect(byPath["app/server.log"]).toBe("temp/log file");
    expect(byPath["x.bak"]).toBe("temp/log file");
    expect(flagged).toHaveLength(11);
  });

  it("does NOT flag legitimate runtime files (incl. the kept public web assets)", () => {
    const flagged = findSuspicious([
      "package.json",
      "bin/plotlink-ows.js",
      "app/server.ts",
      "app/web/dist/index.html",
      "app/lib/cartoon-readiness.ts",
      "app/prisma/schema.prisma",
      "packages/cli/dist/index.js",
      "public/favicon.png",
      "public/og-image.png",
      "public/splash.png",
      "public/wide-banner.png",
      "scripts/ows-smoke-test.ts",
      "README.md",
      "LICENSE",
    ]);
    expect(flagged).toEqual([]);
  });

  // #468: the preflight also enforces that required runtime contents are present.
  it("detects missing required runtime files", () => {
    expect(findMissingRequired(REQUIRED_PACK_FILES)).toEqual([]);
    expect(findMissingRequired(["package.json", "bin/plotlink-ows.js"])).toContain("README.md");
    expect(findMissingRequired(["package.json", "bin/plotlink-ows.js"])).toContain("app/web/dist/index.html");
    expect(REQUIRED_PACK_FILES).toContain("LICENSE");
    expect(REQUIRED_PACK_FILES).toContain("app/prisma/schema.prisma");
    // #469: the root-lib file the server imports at boot must be packed.
    expect(REQUIRED_PACK_FILES).toContain("lib/genres.ts");
  });

  it("exposes a stable, non-empty rule set", () => {
    expect(SUSPICIOUS_RULES.length).toBeGreaterThanOrEqual(5);
    for (const r of SUSPICIOUS_RULES) expect(r.re).toBeInstanceOf(RegExp);
  });

  // #466 (re1): the smoke test must also require the postinstall prerequisites
  // (the Prisma schema), derived from the actual postinstall command, so a
  // files[] regression that drops them is caught — even with --ignore-scripts.
  it("derives required install files incl. the bin and the postinstall Prisma schema", () => {
    const required = requiredInstalledFiles({
      bin: { "plotlink-ows": "./bin/plotlink-ows.js" },
      scripts: { postinstall: "prisma generate --schema app/prisma/schema.prisma" },
    });
    expect(required).toContain("package.json");
    expect(required).toContain("bin/plotlink-ows.js"); // leading ./ stripped
    expect(required).toContain("app/server.ts");
    expect(required).toContain("app/web/dist/index.html");
    expect(required).toContain("app/prisma/schema.prisma"); // the postinstall prerequisite
  });

  it("handles a string bin, an = schema form, and no postinstall", () => {
    expect(requiredInstalledFiles({ bin: "bin/x.js" })).toContain("bin/x.js");
    expect(requiredInstalledFiles({ scripts: { postinstall: "prisma generate --schema=db/schema.prisma" } }))
      .toContain("db/schema.prisma");
    // No postinstall → no schema requirement, but still the runtime entrypoints.
    expect(requiredInstalledFiles({})).toEqual(["package.json", "app/server.ts", "app/web/dist/index.html"]);
  });
});

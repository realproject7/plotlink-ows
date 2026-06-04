import { describe, it, expect } from "vitest";
import { findSuspicious, SUSPICIOUS_RULES, requiredInstalledFiles } from "./package-hygiene.mjs";

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
    expect(byPath["app/web/.vite/deps/x.js"]).toBe("build cache");
    expect(byPath["app/.next/cache/bundle.js"]).toBe("build cache");
    expect(byPath[".env"]).toBe("possible secret/credential file");
    expect(byPath["app/.env.local"]).toBe("possible secret/credential file");
    expect(byPath["lib/ows/wallet.key"]).toBe("possible secret/credential file");
    expect(byPath["lib/ows/cert.pem"]).toBe("possible secret/credential file");
    // Every seeded path was flagged.
    expect(flagged).toHaveLength(11);
  });

  it("does NOT flag legitimate runtime files", () => {
    const flagged = findSuspicious([
      "package.json",
      "bin/plotlink-ows.js",
      "app/server.ts",
      "app/web/dist/index.html",
      "app/lib/cartoon-readiness.ts",
      "app/prisma/schema.prisma",
      "packages/cli/dist/index.js",
      "public/favicon.ico",
      "scripts/ows-smoke-test.ts",
    ]);
    expect(flagged).toEqual([]);
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

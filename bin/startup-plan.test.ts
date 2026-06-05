import { describe, it, expect } from "vitest";
import { planStartup } from "./startup-plan.cjs";

// #470 (EPIC #465): the CLI start path must enforce the runtime/build-time
// boundary. An installed package (no source checkout) ships only runtime deps +
// prebuilt assets, so it must NEVER run `npm install` or a web build — the build
// toolchain isn't present and triggering one would fetch it from the network
// (an unexpected rebuild). Missing assets there are a FATAL broken-install
// condition, not a trigger to rebuild. Only a source checkout may (re)build.
describe("startup boundary planner (#470)", () => {
  describe("installed package (no src/, no build tooling)", () => {
    it("assets present → just start (no install, no build, no error)", () => {
      expect(planStartup({ isSourceCheckout: false, depsInstalled: true, distBuilt: true }))
        .toEqual({ install: false, build: false, error: null });
    });

    it("missing deps → fatal, NEVER runs npm install", () => {
      expect(planStartup({ isSourceCheckout: false, depsInstalled: false, distBuilt: true }))
        .toEqual({ install: false, build: false, error: "deps" });
    });

    it("missing prebuilt dist → fatal, NEVER invokes build tooling", () => {
      expect(planStartup({ isSourceCheckout: false, depsInstalled: true, distBuilt: false }))
        .toEqual({ install: false, build: false, error: "dist" });
    });

    it("missing both → reports the deps failure first", () => {
      expect(planStartup({ isSourceCheckout: false, depsInstalled: false, distBuilt: false }))
        .toEqual({ install: false, build: false, error: "deps" });
    });
  });

  describe("source checkout (has src/ + build tooling) — dev convenience", () => {
    it("fully built → just start", () => {
      expect(planStartup({ isSourceCheckout: true, depsInstalled: true, distBuilt: true }))
        .toEqual({ install: false, build: false, error: null });
    });

    it("missing deps and dist → install + build", () => {
      expect(planStartup({ isSourceCheckout: true, depsInstalled: false, distBuilt: false }))
        .toEqual({ install: true, build: true, error: null });
    });

    it("missing only dist → build but no install", () => {
      expect(planStartup({ isSourceCheckout: true, depsInstalled: true, distBuilt: false }))
        .toEqual({ install: false, build: true, error: null });
    });
  });
});

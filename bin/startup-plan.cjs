// Runtime/build-time boundary planner for the PlotLink OWS CLI (#470, EPIC #465).
//
// The published `plotlink-ows` package ships PREBUILT runtime assets
// (`app/web/dist`) and installs only runtime `dependencies`. All build tooling
// (vite, tailwind, react, …) lives in `devDependencies` (see #469) and is
// therefore ABSENT from an installed package. Consequence: the `start` path must
// NEVER run a web build or `npm install` on a user's machine — doing so would
// fetch the build toolchain from the network (an unexpected rebuild). Missing
// prebuilt assets in an installed package mean a CORRUPTED install, which we
// surface loudly instead of silently trying to rebuild.
//
// A *source checkout* (the repo) is the only place a (re)build is allowed. It is
// detected by the presence of `src/` (the Next.js web app), which is NOT part of
// the published `files` allowlist and so never exists in an installed package.
//
// This module is intentionally PURE (no fs/process access) so the boundary
// policy is unit-tested in isolation; `bin/plotlink-ows.js` probes the
// environment and feeds the facts in.

/**
 * Decide what the `start` command must do before launching the server.
 *
 * @param {object} env
 * @param {boolean} env.isSourceCheckout  running from the repo (has `src/`)
 * @param {boolean} env.depsInstalled     runtime deps resolvable
 * @param {boolean} env.distBuilt         prebuilt web UI present (app/web/dist/index.html)
 * @returns {{ install: boolean, build: boolean, error: null | "deps" | "dist" }}
 *   install/build are only ever `true` in a source checkout (dev convenience).
 *   `error` is a fatal broken-install condition for an installed package.
 */
function planStartup({ isSourceCheckout, depsInstalled, distBuilt }) {
  if (isSourceCheckout) {
    // Dev convenience: bring a fresh checkout up without manual build steps.
    return { install: !depsInstalled, build: !distBuilt, error: null };
  }
  // Installed package: never pull build tooling. Missing assets ⇒ broken install.
  if (!depsInstalled) return { install: false, build: false, error: "deps" };
  if (!distBuilt) return { install: false, build: false, error: "dist" };
  return { install: false, build: false, error: null };
}

module.exports = { planStartup };

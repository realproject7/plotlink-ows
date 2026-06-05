#!/usr/bin/env node
// Prod-only packed-tarball START smoke (#479, EPIC #465).
//
// The pack/install smoke in preflight only checks FILE presence with
// `--ignore-scripts`; it cannot catch a *startup* regression. This smoke does a
// real bring-up:
//   1. `npm pack` the real tarball.
//   2. `npm install --omit=dev` it (scripts ON — postinstall `prisma generate`
//      and native builds run, exactly like a user install).
//   3. Assert the web-app/build deps removed in #469/#471 are ABSENT.
//   4. Start the CLI via its real bin with a FRESH HOME + minimal config, then
//      assert the HTTP server actually serves `/api/auth/status` and `/`.
//
// This is the check that catches the #479 failure (the server exiting during
// `prisma db push` in a packed prod-only install). Exits non-zero on any
// failure and prints the captured server output so a real failure is diagnosable.
//
// Heavier than the pack smoke (installs from the registry + boots the server +
// builds native deps), so it is a publish-gate check run by preflight. Set
// PREFLIGHT_SKIP_START_SMOKE=1 to skip during local iteration (preflight warns
// loudly when skipped — a skipped run is NOT publish-safe).

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const PORT = Number(process.env.SMOKE_PORT) || 7787;
const REMOVED_DEPS = ["@aws-sdk/client-s3", "react", "vite"]; // moved to devDeps in #469/#471
const BOOT_TIMEOUT_MS = 60_000;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), "plotlink-start-smoke-"));
const home = join(tmp, "home");
mkdirSync(home, { recursive: true });
let child;
let serverOut = "";

try {
  // 1) Pack the real tarball into the temp dir (no stray .tgz in the repo).
  const tgz = JSON.parse(sh("npm", ["pack", "--pack-destination", tmp, "--json"], { cwd: root }))[0].filename;

  // 2) Throwaway consumer; install prod-only WITH scripts (real user install).
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "start-smoke", private: true, version: "0.0.0" }) + "\n");
  sh("npm", ["install", join(tmp, tgz), "--omit=dev", "--no-audit", "--no-fund", "--no-save"], { cwd: tmp, stdio: "inherit" });
  const installed = join(tmp, "node_modules", pkg.name);
  if (!existsSync(installed)) throw new Error("package did not install into the consumer project");
  ok("tarball installed prod-only (--omit=dev, scripts on)");

  // 3) The web-app/build deps removed in #469/#471 must be absent (hoisted or nested).
  const leaked = REMOVED_DEPS.filter(
    (d) => existsSync(join(tmp, "node_modules", d)) || existsSync(join(installed, "node_modules", d)),
  );
  if (leaked.length) fail(`removed web-app/build deps present in prod install: ${leaked.join(", ")}`);
  else ok(`removed deps absent from prod install (${REMOVED_DEPS.join(", ")})`);

  // 4) Fresh HOME + minimal config so the bin starts the server (skips the wizard).
  const cfgDir = join(home, ".plotlink-ows");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(
    join(cfgDir, "config.json"),
    JSON.stringify({ port: PORT, passphrase_hash: "smoke", wallet_name: "plotlink-writer", created_at: "2026-01-01T00:00:00Z" }) + "\n",
  );

  // 5) Start via the real bin (exercises cmdStart → server → prisma db push).
  const binPath = join(installed, "bin", "plotlink-ows.js");
  child = spawn(process.execPath, [binPath], {
    cwd: installed,
    // PLOTLINK_OWS_NO_OPEN=1 stops the bin auto-opening a browser during this
    // non-interactive release check (#481); normal `npx plotlink-ows` is unaffected.
    env: { ...process.env, HOME: home, USERPROFILE: home, APP_PORT: String(PORT), PLOTLINK_OWS_NO_OPEN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so we can kill the bin AND its server child
  });
  child.stdout.on("data", (d) => (serverOut += d));
  child.stderr.on("data", (d) => (serverOut += d));

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let statusOk = false;
  let rootOk = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break; // bin exited (e.g. db push failed)
    try {
      const r = await fetch(`http://localhost:${PORT}/api/auth/status`);
      if (r.ok) {
        statusOk = true;
        const rootRes = await fetch(`http://localhost:${PORT}/`);
        rootOk = rootRes.ok && /<!doctype html|<html/i.test(await rootRes.text());
        break;
      }
    } catch {
      /* not listening yet */
    }
    await sleep(1000);
  }

  if (statusOk) ok("server serves GET /api/auth/status");
  else fail(`server did not serve /api/auth/status within ${BOOT_TIMEOUT_MS / 1000}s (bin exitCode=${child.exitCode})`);
  if (rootOk) ok("server serves GET / (prebuilt web UI)");
  else fail("server did not serve the prebuilt web UI at /");

  if (failures > 0 && serverOut.trim()) {
    console.log("\n  --- captured server output ---");
    for (const line of serverOut.trimEnd().split("\n")) console.log(`  | ${line}`);
  }
} catch (e) {
  fail(`start smoke errored: ${e?.message || e}`);
  if (serverOut.trim()) {
    console.log("\n  --- captured server output ---");
    for (const line of serverOut.trimEnd().split("\n")) console.log(`  | ${line}`);
  }
} finally {
  if (child && child.pid && child.exitCode === null) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* group gone */ }
    try { child.kill("SIGKILL"); } catch { /* already dead */ }
  }
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(failures > 0 ? 1 : 0);

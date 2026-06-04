#!/usr/bin/env node
// PlotLink OWS — release preflight & package-hygiene check (#466, EPIC #465).
//
// Run before a manual `npm publish` (the operator gate, #472) with:
//
//     npm run preflight
//
// It is READ-ONLY and safe: it never runs `npm audit fix`, never publishes,
// never needs `npm login`, and never prints secrets/passphrases/wallet data.
//
// It reports + checks four things, and exits non-zero on any blocking issue:
//   1. Expected Node/npm toolchain (from package.json engines / packageManager).
//   2. A production `npm audit --omit=dev` summary (reported; high/critical warn).
//   3. The packed-package contents (`npm pack --dry-run`), FAILING on any
//      generated/local artifact that must never ship: bundled node_modules,
//      *.test.* / *.spec.* files, stray *.tgz tarballs, build caches, or obvious
//      secret files (.env/.pem/.key).
//   4. A packed-tarball install smoke test in a throwaway temp dir (no scripts),
//      verifying the bin + runtime entrypoints land and the bin parses.
//
// Keep the SUSPICIOUS rules below in sync with the `files` exclusions in
// package.json — they are two sides of the same hygiene contract.

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findSuspicious } from "./package-hygiene.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const failures = [];
const warnings = [];
const section = (t) => console.log(`\n=== ${t} ===`);
const fail = (m) => { failures.push(m); console.log(`  ✗ ${m}`); };
const warn = (m) => { warnings.push(m); console.log(`  ! ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

/** Run a command, returning { code, stdout } without throwing (audit/pack exit non-zero on findings). */
function run(cmd, args, opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, ...opts });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "" };
  }
}

// ---------------------------------------------------------------------------
// 1) Expected toolchain
// ---------------------------------------------------------------------------
section("Expected toolchain");
console.log(`  engines.node:    ${pkg.engines?.node ?? "(unset)"}`);
console.log(`  engines.npm:     ${pkg.engines?.npm ?? "(unset)"}`);
console.log(`  packageManager:  ${pkg.packageManager ?? "(unset)"}`);
const haveNode = process.version;
const haveNpm = run("npm", ["-v"]).stdout.trim() || "?";
console.log(`  running node ${haveNode} / npm ${haveNpm}`);
if (!/^v20\./.test(haveNode)) warn(`Node ${haveNode} is not 20.x — publish should run on Node 20.x (engines.node).`);
if (!/^10\./.test(haveNpm)) warn(`npm ${haveNpm} is not 10.x — publish should run on npm 10.x (engines.npm / packageManager).`);
if (warnings.length === 0) ok("running on the expected Node 20.x / npm 10.x toolchain");

// ---------------------------------------------------------------------------
// 2) Production audit summary (reported; never auto-fixed)
// ---------------------------------------------------------------------------
section("Production audit (npm audit --omit=dev)");
const audit = run("npm", ["audit", "--omit=dev", "--json"]);
try {
  const vulns = JSON.parse(audit.stdout).metadata?.vulnerabilities ?? {};
  console.log(`  ${JSON.stringify(vulns)}`);
  const severe = (vulns.high ?? 0) + (vulns.critical ?? 0);
  if (severe > 0) warn(`${severe} high/critical production vulnerabilit${severe === 1 ? "y" : "ies"} — review before publishing (do NOT run 'npm audit fix --force').`);
  else ok("no high/critical production vulnerabilities");
} catch {
  warn("could not parse `npm audit` output (offline, or registry unreachable) — re-run with network access before publishing.");
}

// ---------------------------------------------------------------------------
// 3) Packed contents + suspicious-file detection
// ---------------------------------------------------------------------------
section("Packed package contents (npm pack --dry-run)");
const dry = run("npm", ["pack", "--dry-run", "--json"]);
let manifest = null;
try { manifest = JSON.parse(dry.stdout)[0]; } catch { fail("`npm pack --dry-run --json` did not return a parseable manifest."); }
if (manifest) {
  console.log(`  entries: ${manifest.entryCount}   unpacked: ${(manifest.unpackedSize / 1024).toFixed(0)}KB   tarball: ${(manifest.size / 1024).toFixed(0)}KB`);
  const bad = findSuspicious(manifest.files.map((f) => f.path));
  if (bad.length) {
    fail(`${bad.length} suspicious file(s) in the packed package (fix the package.json 'files' exclusions):`);
    bad.slice(0, 40).forEach((b) => console.log(`      - ${b.label}: ${b.path}`));
    if (bad.length > 40) console.log(`      … and ${bad.length - 40} more`);
  } else {
    ok("clean: no node_modules / test / tarball / cache / secret files in the package");
  }
}

// ---------------------------------------------------------------------------
// 4) Packed-tarball install smoke test (temp dir, no install scripts)
// ---------------------------------------------------------------------------
section("Tarball install smoke test");
let tmp;
try {
  tmp = mkdtempSync(join(tmpdir(), "plotlink-preflight-"));
  // Pack the real tarball INTO the temp dir, so no stray .tgz is left in the repo.
  const packed = run("npm", ["pack", "--pack-destination", tmp, "--json"]);
  const tgz = JSON.parse(packed.stdout)[0]?.filename;
  if (!tgz) throw new Error("npm pack did not report a tarball filename");
  const tgzPath = join(tmp, tgz);
  // A throwaway consumer project that installs the tarball.
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "preflight-smoke", private: true, version: "0.0.0" }) + "\n");
  // --ignore-scripts: don't run the package's postinstall (prisma generate) — this
  // is a packaging smoke test, not a full runtime bring-up (that's the operator gate).
  const install = run("npm", ["install", tgzPath, "--ignore-scripts", "--no-audit", "--no-fund", "--no-save"], { cwd: tmp });
  if (install.code !== 0) throw new Error("`npm install <tarball>` failed in the temp project");
  const installed = join(tmp, "node_modules", pkg.name);
  const required = ["package.json", "bin/plotlink-ows.js", "app/server.ts", "app/web/dist/index.html"];
  const missing = required.filter((f) => !existsSync(join(installed, f)));
  if (missing.length) fail(`installed tarball is missing required runtime file(s): ${missing.join(", ")}`);
  else ok("tarball installs cleanly; bin + runtime entrypoints are present");
  const check = run(process.execPath, ["--check", join(installed, "bin/plotlink-ows.js")]);
  if (check.code !== 0) fail("bin/plotlink-ows.js failed `node --check` (syntax error)");
  else ok("bin/plotlink-ows.js passes node --check");
} catch (e) {
  fail(`tarball install smoke test failed: ${e.message || e}`);
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
section("Preflight summary");
console.log(`  warnings: ${warnings.length}   failures: ${failures.length}`);
if (failures.length) {
  console.log(`\n✗ Preflight FAILED — ${failures.length} blocking issue(s). Do not publish.`);
  process.exit(1);
}
console.log(`\n✓ Preflight passed${warnings.length ? ` (with ${warnings.length} warning(s) to review)` : ""}.`);

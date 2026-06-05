#!/usr/bin/env node
// Regenerate app/prisma/schema.sql from app/prisma/schema.prisma (#484).
//
// The installed app applies this committed DDL at startup via the Prisma client
// (app/lib/apply-schema.ts) instead of running `prisma db push`, so the native
// Prisma schema-engine is never needed at runtime. Run this (and commit the
// result) after ANY change to schema.prisma:  npm run prisma:sql
//
// This uses the schema-engine via `prisma migrate diff` — that's fine here
// because it runs at DEV/build time on a developer machine, not at user runtime.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "app", "prisma", "schema.prisma");
const outPath = join(root, "app", "prisma", "schema.sql");

// Resolve the local Prisma CLI (same robust resolution the runtime once used).
const requireFrom = createRequire(join(root, "__resolver__.js"));
const prismaPkg = requireFrom.resolve("prisma/package.json");
const pkg = JSON.parse(readFileSync(prismaPkg, "utf8"));
const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
const prismaCli = join(dirname(prismaPkg), binRel);

const ddl = execFileSync(
  process.execPath,
  [prismaCli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaPath, "--script"],
  { encoding: "utf8" },
).trim();

const header = [
  "-- Canonical SQLite DDL for the local writer database.",
  "-- GENERATED from app/prisma/schema.prisma — do not edit by hand.",
  "-- Regenerate after any schema change:  npm run prisma:sql",
  "--",
  "-- Applied idempotently at startup via the Prisma client's library query engine",
  "-- (app/lib/apply-schema.ts) so the installed package never invokes the native",
  "-- Prisma schema-engine (`prisma db push`), which fails to spawn in some packed",
  "-- prod-only environments (#484, EPIC #465).",
  "",
  "",
].join("\n");

writeFileSync(outPath, header + ddl + "\n");
console.log(`Wrote ${outPath}`);

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseSqlStatements, makeIdempotent, loadSchemaStatements } from "./apply-schema";

// #484 (EPIC #465): the installed app applies app/prisma/schema.sql at startup
// through the Prisma client's library query engine instead of running
// `prisma db push` (whose native schema-engine fails to spawn in some packed
// prod-only installs). These guard the parse/idempotency logic and keep the
// committed DDL in sync with the Prisma schema.
const SCHEMA_SQL = path.join(process.cwd(), "app", "prisma", "schema.sql");
const SCHEMA_PRISMA = path.join(process.cwd(), "app", "prisma", "schema.prisma");

describe("parseSqlStatements (#484)", () => {
  it("splits statements and strips comment/blank lines", () => {
    const sql = [
      "-- a comment",
      'CREATE TABLE "A" (',
      '    "id" TEXT NOT NULL PRIMARY KEY',
      ");",
      "",
      "-- another",
      'CREATE TABLE "B" ("k" TEXT NOT NULL PRIMARY KEY);',
    ].join("\n");
    const out = parseSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('CREATE TABLE "A"');
    expect(out[0]).not.toContain("-- a comment");
    expect(out[1]).toContain('CREATE TABLE "B"');
  });

  it("ignores a trailing empty statement after the last semicolon", () => {
    expect(parseSqlStatements('CREATE TABLE "A" ("k" TEXT);\n')).toHaveLength(1);
  });
});

describe("makeIdempotent (#484)", () => {
  it("adds IF NOT EXISTS to CREATE TABLE", () => {
    expect(makeIdempotent('CREATE TABLE "Session" ("id" TEXT)')).toBe(
      'CREATE TABLE IF NOT EXISTS "Session" ("id" TEXT)',
    );
  });

  it("adds IF NOT EXISTS to CREATE UNIQUE INDEX (preserving UNIQUE)", () => {
    expect(makeIdempotent('CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token")')).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token")',
    );
  });

  it("adds IF NOT EXISTS to a plain CREATE INDEX", () => {
    expect(makeIdempotent('CREATE INDEX "i" ON "A"("c")')).toBe(
      'CREATE INDEX IF NOT EXISTS "i" ON "A"("c")',
    );
  });

  it("is a no-op when IF NOT EXISTS is already present", () => {
    const stmt = 'CREATE TABLE IF NOT EXISTS "A" ("k" TEXT)';
    expect(makeIdempotent(stmt)).toBe(stmt);
  });
});

describe("loadSchemaStatements over the committed schema.sql (#484)", () => {
  it("returns only idempotent CREATE statements", () => {
    const statements = loadSchemaStatements(SCHEMA_SQL);
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      expect(stmt).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS/i);
    }
  });

  it("covers every model in schema.prisma (committed DDL is in sync)", () => {
    // Catches a schema change that forgot `npm run prisma:sql`.
    const prisma = fs.readFileSync(SCHEMA_PRISMA, "utf8");
    const models = [...prisma.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
    expect(models.length).toBeGreaterThan(0);
    const sql = fs.readFileSync(SCHEMA_SQL, "utf8");
    for (const model of models) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE "${model}"`));
    }
  });
});

describe("server startup avoids the native Prisma schema-engine (#484)", () => {
  it("applies schema.sql at boot and never runs `prisma db push`", () => {
    // Locks the fix: the Linux start smoke passes either way (its schema-engine
    // works), so this source contract is what stops a regression back to the
    // schema-engine path that fails on the operator's macOS arm64.
    const src = fs.readFileSync(path.join(process.cwd(), "app", "server.ts"), "utf8");
    // Ignore comment lines (which legitimately *mention* `prisma db push`).
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(code).toContain("loadSchemaStatements");
    expect(code).not.toMatch(/db\s+push/);
    expect(code).not.toMatch(/execFileSync|execSync/); // no child-process shell-out for DB setup
  });
});

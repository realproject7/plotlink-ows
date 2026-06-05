import fs from "fs";

/**
 * Local SQLite schema setup WITHOUT the native Prisma schema-engine (#484).
 *
 * The installed `plotlink-ows` package must bring its SQLite schema up at
 * startup, but `prisma db push` spawns a platform-specific schema-engine binary
 * that fails to start in some packed prod-only installs (an empty
 * "Schema engine error:" on macOS arm64). The Prisma *client* the app already
 * uses runs on the library query engine — a different, reliably-present engine —
 * and can execute the DDL directly via `$executeRawUnsafe`.
 *
 * So we ship the canonical DDL as `app/prisma/schema.sql` (generated from
 * `schema.prisma` with `npm run prisma:sql`) and apply it through the client.
 */

/**
 * Split a committed `.sql` file into individual executable statements, dropping
 * `-- ...` comment lines and blanks. Our DDL is a small, controlled grammar
 * (CREATE TABLE / CREATE [UNIQUE] INDEX) with no semicolons inside values, so a
 * `;`-split is safe here.
 */
export function parseSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((stmt) => stmt.length > 0);
}

/**
 * Rewrite a CREATE statement to be idempotent so applying the schema on an
 * already-initialized database is a no-op (the app applies it on every startup).
 * Only the CREATE TABLE / CREATE [UNIQUE] INDEX forms our schema emits are
 * rewritten; anything else is returned unchanged.
 */
export function makeIdempotent(statement: string): string {
  return statement
    .replace(/^CREATE TABLE\s+(?!IF NOT EXISTS)/i, "CREATE TABLE IF NOT EXISTS ")
    .replace(
      /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/i,
      (_match, unique) => `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS `,
    );
}

/** Read the committed schema DDL and return idempotent, ready-to-execute statements. */
export function loadSchemaStatements(schemaSqlPath: string): string[] {
  const sql = fs.readFileSync(schemaSqlPath, "utf8");
  return parseSqlStatements(sql).map(makeIdempotent);
}

-- Canonical SQLite DDL for the local writer database.
-- GENERATED from app/prisma/schema.prisma — do not edit by hand.
-- Regenerate after any schema change:  npm run prisma:sql
--
-- Applied idempotently at startup via the Prisma client's library query engine
-- (app/lib/apply-schema.ts) so the installed package never invokes the native
-- Prisma schema-engine (`prisma db push`), which fails to spawn in some packed
-- prod-only environments (#484, EPIC #465).

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

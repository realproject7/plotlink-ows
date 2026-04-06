#!/usr/bin/env npx tsx
/**
 * One-off migration: verify published files are actually indexed on plotlink.xyz.
 * Marks unindexed files as "published-not-indexed" with an error message.
 *
 * Usage: npx tsx scripts/fix-index-status.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORIES_DIR = path.join(__dirname, "..", "stories");
const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";

interface FileStatus {
  file: string;
  status: string;
  txHash?: string;
  storylineId?: number;
  contentCid?: string;
  publishedAt?: string;
  gasCost?: string;
  indexError?: string;
}

async function checkIndexed(storylineId: number): Promise<boolean> {
  try {
    const res = await fetch(`${PLOTLINK_URL}/api/storylines/${storylineId}`);
    if (!res.ok) return false;
    const data = await res.json() as { id?: number };
    return !!data.id;
  } catch {
    return false;
  }
}

async function main() {
  if (!fs.existsSync(STORIES_DIR)) {
    console.log("No stories directory found.");
    return;
  }

  const dirs = fs.readdirSync(STORIES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."));

  let fixed = 0;

  for (const dir of dirs) {
    const statusFile = path.join(STORIES_DIR, dir.name, ".publish-status.json");
    if (!fs.existsSync(statusFile)) continue;

    const status: Record<string, FileStatus> = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    let changed = false;

    for (const [file, entry] of Object.entries(status)) {
      if (entry.status !== "published") continue;
      if (!entry.storylineId) continue;

      console.log(`Checking ${dir.name}/${file} (storyline #${entry.storylineId})...`);
      const indexed = await checkIndexed(entry.storylineId);

      if (!indexed) {
        console.log(`  → NOT INDEXED. Marking as published-not-indexed.`);
        entry.status = "published-not-indexed";
        entry.indexError = "Not found on plotlink.xyz (pre-#64 publish)";
        changed = true;
        fixed++;
      } else {
        console.log(`  → OK (indexed)`);
      }
    }

    if (changed) {
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2) + "\n");
    }
  }

  console.log(`\nDone. Fixed ${fixed} file(s).`);
}

main().catch(console.error);

#!/usr/bin/env npx tsx
/**
 * One-off fix: mark specific published files as "published-not-indexed".
 * For files published before #64's index failure tracking.
 *
 * Usage: npx tsx scripts/fix-index-status.ts <story-name> <file-name> [error-message]
 * Example: npx tsx scripts/fix-index-status.ts new-employee plot-01.md "Content hash mismatch"
 *
 * Without arguments: lists all published files for review.
 */
import fs from "fs";
import path from "path";
import { STORIES_DIR } from "../app/lib/paths";

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

function listPublished() {
  if (!fs.existsSync(STORIES_DIR)) {
    console.log("No stories directory found.");
    return;
  }

  const dirs = fs.readdirSync(STORIES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."));

  for (const dir of dirs) {
    const statusFile = path.join(STORIES_DIR, dir.name, ".publish-status.json");
    if (!fs.existsSync(statusFile)) continue;

    const status: Record<string, FileStatus> = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    for (const [file, entry] of Object.entries(status)) {
      const icon = entry.status === "published" ? "\u2713" : entry.status === "published-not-indexed" ? "\u26A0" : "\u23F3";
      console.log(`  ${icon} ${dir.name}/${file} — ${entry.status}${entry.indexError ? ` (${entry.indexError})` : ""}`);
    }
  }
}

function markNotIndexed(storyName: string, fileName: string, errorMessage: string) {
  const statusFile = path.join(STORIES_DIR, storyName, ".publish-status.json");
  if (!fs.existsSync(statusFile)) {
    console.error(`No .publish-status.json found for story "${storyName}"`);
    process.exit(1);
  }

  const status: Record<string, FileStatus> = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  const entry = status[fileName];

  if (!entry) {
    console.error(`File "${fileName}" not found in ${storyName}/.publish-status.json`);
    process.exit(1);
  }

  if (entry.status !== "published" && entry.status !== "published-not-indexed") {
    console.error(`File "${fileName}" is not published (status: ${entry.status})`);
    process.exit(1);
  }

  if (entry.status === "published-not-indexed") {
    console.log(`Already marked as published-not-indexed.`);
    return;
  }

  entry.status = "published-not-indexed";
  entry.indexError = errorMessage;
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2) + "\n");
  console.log(`Marked ${storyName}/${fileName} as published-not-indexed: ${errorMessage}`);
}

const [storyName, fileName, ...rest] = process.argv.slice(2);

if (!storyName) {
  console.log("Published files:\n");
  listPublished();
  console.log("\nTo fix: npx tsx scripts/fix-index-status.ts <story> <file> [error-message]");
} else if (!fileName) {
  console.error("Usage: npx tsx scripts/fix-index-status.ts <story-name> <file-name> [error-message]");
  process.exit(1);
} else {
  const errorMessage = rest.join(" ") || "Not indexed on plotlink.xyz (pre-#64 publish)";
  markNotIndexed(storyName, fileName, errorMessage);
}

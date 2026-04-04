#!/usr/bin/env node
/**
 * Score DropCast users for PlotLink Writer/Reader targeting.
 * Input:  archive/dropcast-user-table-20260330.csv
 * Output: archive/dropcast-users-scored-20260330.csv
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const INPUT = resolve(ROOT, "archive/dropcast-user-table-20260330.csv");
const OUTPUT = resolve(ROOT, "archive/dropcast-users-scored-20260330.csv");

// ---------------------------------------------------------------------------
// CSV parsing (handles quoted fields with commas/newlines)
// ---------------------------------------------------------------------------

function parseCSV(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        i++; // skip opening quote
        let val = "";
        while (i < text.length) {
          if (text[i] === '"' && text[i + 1] === '"') { val += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else { val += text[i]; i++; }
        }
        row.push(val);
        if (text[i] === ",") i++;
        else if (text[i] === "\n" || text[i] === "\r") { if (text[i] === "\r") i++; i++; break; }
        else if (i >= text.length) break;
      } else {
        let val = "";
        while (i < text.length && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          val += text[i]; i++;
        }
        row.push(val);
        if (text[i] === ",") i++;
        else { if (text[i] === "\r") i++; if (text[i] === "\n") i++; break; }
      }
    }
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
  }
  return rows;
}

function escapeCSV(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function logScale(val, max) {
  if (val <= 0) return 0;
  return Math.min(1, Math.log10(val + 1) / Math.log10(max + 1));
}

function scoreUser(row, headers) {
  const get = (col) => row[headers.indexOf(col)] ?? "";
  const num = (col) => { const v = parseFloat(get(col)); return isNaN(v) ? 0 : v; };
  const bool = (col) => get(col) === "true" || get(col) === "t";
  const has = (col) => get(col).trim().length > 0;

  // Instant disqualify
  if (bool("is_blacklisted")) return { score: 0, tag: "None" };

  // spam_label: 1 = spam, 2 = verified non-spammer, 0/blank = unknown
  const spamLabel = parseInt(get("spam_label"), 10);
  if (spamLabel === 1) return { score: 0, tag: "None" };

  const followers = num("follower_count");
  const following = num("following_count");

  // Zero-engagement accounts = inactive/bot
  if (followers === 0 && following === 0) {
    return { score: 0, tag: "None" };
  }

  // No profile data at all = None
  if (!has("bio") && !has("pfp_url") && !has("twitter")) {
    return { score: 0, tag: "None" };
  }

  // --- Social Reach (40%) ---
  const fcReach = logScale(followers, 100000); // FC followers, log-scaled to 100k
  const xReach = logScale(num("x_followers_count"), 500000); // X followers
  const xVerified = bool("x_verified") ? 1 : 0;
  const socialScore = (fcReach * 0.55 + xReach * 0.35 + xVerified * 0.1) * 40;

  // --- Reputation (30%) ---
  const neynarScore = Math.min(1, num("neynar_score"));
  const quotientScore = Math.min(1, num("quotient_score"));
  const powerBadge = bool("power_badge") ? 1 : 0;
  const proBadge = bool("is_pro_subscriber") ? 1 : 0;
  const repScore = (neynarScore * 0.4 + quotientScore * 0.3 + powerBadge * 0.2 + proBadge * 0.1) * 30;

  // --- Profile Completeness (15%) ---
  const hasBio = has("bio") ? 1 : 0;
  const hasTwitter = has("twitter") ? 1 : 0;
  const hasUrl = has("url") ? 1 : 0;
  const hasPfp = has("pfp_url") ? 1 : 0;
  const profileScore = ((hasBio + hasTwitter + hasUrl + hasPfp) / 4) * 15;

  // spam_label=0/blank (unknown) applies a small penalty; spam_label=2 (verified) gets a bonus
  const spamPenalty = spamLabel === 2 ? 2 : (isNaN(spamLabel) || spamLabel === 0) ? -3 : 0;

  const raw = socialScore + repScore + profileScore + spamPenalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // --- Tagging ---
  if (score < 10) return { score, tag: "None" };

  // Writer signals: creator pattern (followers >> following), has bio, has url/github
  const ratio = following > 0 ? followers / following : followers;
  const bio = get("bio").toLowerCase();
  const writerKeywords = ["writ", "author", "fiction", "story", "novel", "poet", "creat", "artist", "journal"];
  const hasWriterKeyword = writerKeywords.some((kw) => bio.includes(kw));

  const writerSignals =
    (ratio > 2 ? 1 : 0) +
    (has("github") ? 1 : 0) +
    (has("url") ? 1 : 0) +
    (hasBio && get("bio").length > 50 ? 1 : 0) +
    (hasWriterKeyword ? 1.5 : 0) +
    (neynarScore >= 0.7 ? 1 : 0);

  if (writerSignals >= 3) return { score, tag: "Writer" };
  return { score, tag: "Reader" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const raw = readFileSync(INPUT, "utf-8");
const rows = parseCSV(raw);
const headers = rows[0];
const data = rows.slice(1);

console.log(`Input: ${data.length} users, ${headers.length} columns`);

const scored = data.map((row) => {
  const { score, tag } = scoreUser(row, headers);
  return { row, score, tag };
});

// Sort by score descending
scored.sort((a, b) => b.score - a.score);

// Build output
const outHeaders = [...headers, "plotlink_score", "plotlink_tag"];
const outRows = scored.map(({ row, score, tag }) =>
  [...row, score, tag].map(escapeCSV).join(","),
);
const output = [outHeaders.map(escapeCSV).join(","), ...outRows].join("\n") + "\n";
writeFileSync(OUTPUT, output);

// --- Summary stats ---
const tagCounts = { Writer: 0, Reader: 0, None: 0 };
const buckets = { "80-100": 0, "60-79": 0, "40-59": 0, "20-39": 0, "0-19": 0 };

for (const { score, tag } of scored) {
  tagCounts[tag]++;
  if (score >= 80) buckets["80-100"]++;
  else if (score >= 60) buckets["60-79"]++;
  else if (score >= 40) buckets["40-59"]++;
  else if (score >= 20) buckets["20-39"]++;
  else buckets["0-19"]++;
}

console.log("\n=== Summary ===");
console.log(`Writers: ${tagCounts.Writer} | Readers: ${tagCounts.Reader} | None: ${tagCounts.None}`);
console.log(`\nScore Distribution:`);
for (const [range, count] of Object.entries(buckets)) {
  console.log(`  ${range}: ${count}`);
}

console.log(`\nTop 20 Users:`);
console.log("Rank | Username | Score | Tag | Followers | Bio");
console.log("-----|----------|-------|-----|-----------|----");
for (let i = 0; i < Math.min(20, scored.length); i++) {
  const { row, score, tag } = scored[i];
  const username = row[headers.indexOf("username")] || "?";
  const followers = row[headers.indexOf("follower_count")] || "0";
  const bio = (row[headers.indexOf("bio")] || "").slice(0, 60).replace(/\n/g, " ");
  console.log(`${i + 1}. ${username} | ${score} | ${tag} | ${followers} | ${bio}`);
}

console.log(`\nOutput: ${OUTPUT}`);

import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { STORIES_DIR } from "../lib/paths";
import { writeStoryInstructions } from "../lib/generate-story-instructions";
import { readCutsFile, writeCutsFile, validateCutsFile } from "../lib/cuts";
import { mergeCartoonMarkdown } from "../lib/cartoon-markdown";
import { syncCleanImages, cleanImageCandidates, sniffImageType, cleanImageBytesMatchMime, type SniffedType } from "../lib/clean-image-sync";

const stories = new Hono();

/** Sanitize path params to prevent directory traversal */
function safeName(name: string): string | null {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    return null;
  }
  return name;
}

interface FileStatus {
  file: string;
  status: "published" | "published-not-indexed" | "pending" | "draft";
  txHash?: string;
  storylineId?: number;
  plotIndex?: number;
  contentCid?: string;
  publishedAt?: string;
  gasCost?: string;
  indexError?: string;
  authorAddress?: string;
}

interface StoryInfo {
  name: string;
  title: string | null;
  files: FileStatus[];
  hasStructure: boolean;
  hasGenesis: boolean;
  plotCount: number;
  publishedCount: number;
  contentType: "fiction" | "cartoon";
  language: string;
  // Optional. Absent ⇒ no provider recorded (legacy story ⇒ defaults to Claude
  // at launch). Surfaced read-only so the client can offer a scoped repair.
  agentProvider?: AgentProvider;
}

function readPublishStatus(storyDir: string): Record<string, FileStatus> {
  const statusFile = path.join(storyDir, ".publish-status.json");
  try {
    if (fs.existsSync(statusFile)) {
      return JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function writePublishStatus(storyDir: string, status: Record<string, FileStatus>) {
  const statusFile = path.join(storyDir, ".publish-status.json");
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2) + "\n");
}

export type AgentProvider = "claude" | "codex";

interface StoryMeta {
  contentType: "fiction" | "cartoon";
  language?: string;
  agentMode?: "normal" | "bypass";
  // Optional. Absent ⇒ Claude (no migration). "claude" | "codex".
  agentProvider?: AgentProvider;
}

function readStoryMeta(storyDir: string): StoryMeta {
  const metaFile = path.join(storyDir, ".story.json");
  try {
    if (fs.existsSync(metaFile)) {
      const raw = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
      if (raw.contentType === "fiction" || raw.contentType === "cartoon") {
        return {
          contentType: raw.contentType,
          ...(typeof raw.language === "string" ? { language: raw.language } : {}),
          ...(raw.agentMode === "bypass" || raw.agentMode === "normal" ? { agentMode: raw.agentMode } : {}),
          ...(raw.agentProvider === "claude" || raw.agentProvider === "codex" ? { agentProvider: raw.agentProvider } : {}),
        };
      }
    }
  } catch { /* ignore */ }
  return { contentType: "fiction" };
}

function writeStoryMeta(storyDir: string, meta: StoryMeta) {
  const metaFile = path.join(storyDir, ".story.json");
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");
}

function parseLanguageMetadata(content: string): string | null {
  const match = content.match(/^(?:\*\*)?Language(?:\*\*)?:\s*(?:\*\*)?([^*\n]+)/im);
  if (match) return match[1].trim();
  return null;
}

function detectLanguageFromScript(text: string): string | null {
  if (/[가-힯]/.test(text)) return "Korean";
  if (/[぀-ゟ゠-ヿ]/.test(text)) return "Japanese";
  if (/[一-鿿]/.test(text)) return "Chinese";
  if (/[ऀ-ॿ]/.test(text)) return "Hindi";
  if (/[؀-ۿ]/.test(text)) return "Arabic";
  return null;
}

function scanStory(storyDir: string, name: string): StoryInfo {
  const publishStatus = readPublishStatus(storyDir);
  const storyMeta = readStoryMeta(storyDir);
  const entries = fs.readdirSync(storyDir).filter((f) => f.endsWith(".md"));

  const files: FileStatus[] = entries.map((file) => {
    const existing = publishStatus[file];
    if (existing?.status === "published" || existing?.status === "published-not-indexed") {
      return existing;
    }
    return { file, status: "pending" as const };
  });

  const hasStructure = entries.includes("structure.md");
  const hasGenesis = entries.includes("genesis.md");
  const plotCount = entries.filter((f) => f.match(/^plot-\d+\.md$/)).length;
  const publishedCount = files.filter((f) => f.status === "published" || f.status === "published-not-indexed").length;

  // Extract title and language hints from structure.md or genesis.md
  let title: string | null = null;
  let structContent: string | null = null;
  try {
    const structPath = path.join(storyDir, "structure.md");
    const genesisPath = path.join(storyDir, "genesis.md");
    if (fs.existsSync(structPath)) {
      structContent = fs.readFileSync(structPath, "utf-8");
      const match = structContent.match(/^#\s+(.+)$/m);
      if (match) title = match[1];
    } else if (fs.existsSync(genesisPath)) {
      const content = fs.readFileSync(genesisPath, "utf-8");
      const match = content.match(/^#\s+(.+)$/m);
      if (match) title = match[1];
    }
  } catch { /* best effort */ }

  let language = storyMeta.language || "English";
  if (!storyMeta.language) {
    const fromMetadata = structContent ? parseLanguageMetadata(structContent) : null;
    const fromScript = title ? detectLanguageFromScript(title) : null;
    if (fromMetadata) language = fromMetadata;
    else if (fromScript) language = fromScript;
  }

  return {
    name,
    title,
    files,
    hasStructure,
    hasGenesis,
    plotCount,
    publishedCount,
    contentType: storyMeta.contentType,
    language,
    // Read-only passthrough. Absent when the story has no provider recorded
    // (legacy), so a legacy cartoon shows no provider and the client can offer
    // the explicit repair affordance. Never written/migrated here.
    ...(storyMeta.agentProvider ? { agentProvider: storyMeta.agentProvider } : {}),
  };
}

/** GET /api/stories — list all stories */
stories.get("/", (c) => {
  if (!fs.existsSync(STORIES_DIR)) {
    return c.json({ stories: [] });
  }

  const dirs = fs.readdirSync(STORIES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  const result = dirs.map((name) => scanStory(path.join(STORIES_DIR, name), name));
  return c.json({ stories: result });
});

const ARCHIVED_DIR = path.join(STORIES_DIR, ".archived");

/** GET /api/stories/archived — list archived stories */
stories.get("/archived", (c) => {
  if (!fs.existsSync(ARCHIVED_DIR)) {
    return c.json({ stories: [] });
  }

  const dirs = fs.readdirSync(ARCHIVED_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  const result = dirs.map((name) => scanStory(path.join(ARCHIVED_DIR, name), name));
  return c.json({ stories: result });
});

/** POST /api/stories/archive — move story to .archived/ */
stories.post("/archive", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = safeName(body.name);
  if (!name) return c.json({ error: "Invalid story name" }, 400);

  const src = path.join(STORIES_DIR, name);
  if (!fs.existsSync(src)) return c.json({ error: "Story not found" }, 404);
  if (!fs.existsSync(path.join(src, "structure.md"))) {
    return c.json({ error: "Only stories with structure.md can be archived" }, 400);
  }

  fs.mkdirSync(ARCHIVED_DIR, { recursive: true });
  const dest = path.join(ARCHIVED_DIR, name);
  if (fs.existsSync(dest)) return c.json({ error: "Already archived" }, 409);

  fs.renameSync(src, dest);
  return c.json({ ok: true });
});

/** POST /api/stories/restore — move story back from .archived/ */
stories.post("/restore", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = safeName(body.name);
  if (!name) return c.json({ error: "Invalid story name" }, 400);

  const src = path.join(ARCHIVED_DIR, name);
  if (!fs.existsSync(src)) return c.json({ error: "Archived story not found" }, 404);

  const dest = path.join(STORIES_DIR, name);
  if (fs.existsSync(dest)) return c.json({ error: "Story already exists" }, 409);

  fs.renameSync(src, dest);
  return c.json({ ok: true });
});

/** GET /api/stories/:name — single story detail */
stories.get("/:name", (c) => {
  const name = safeName(c.req.param("name"));
  if (!name) return c.json({ error: "Invalid story name" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  const info = scanStory(storyDir, name);

  // Include file contents
  const filesWithContent = info.files.map((f) => {
    const filePath = path.join(storyDir, f.file);
    const content = fs.readFileSync(filePath, "utf-8");
    return { ...f, content };
  });

  return c.json({ ...info, files: filesWithContent });
});

/** POST /api/stories/:name/metadata — write/update .story.json */
stories.post("/:name/metadata", async (c) => {
  const name = safeName(c.req.param("name"));
  if (!name) return c.json({ error: "Invalid story name" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  const body = await c.req.json<{ contentType?: string; language?: string; agentMode?: string; agentProvider?: string }>();
  if (body.contentType !== "fiction" && body.contentType !== "cartoon") {
    return c.json({ error: "contentType must be 'fiction' or 'cartoon'" }, 400);
  }

  const existing = readStoryMeta(storyDir);
  const meta: StoryMeta = {
    ...existing,
    contentType: body.contentType,
    ...(typeof body.language === "string" ? { language: body.language } : {}),
    ...(body.agentMode === "bypass" || body.agentMode === "normal" ? { agentMode: body.agentMode } : {}),
    ...(body.agentProvider === "claude" || body.agentProvider === "codex" ? { agentProvider: body.agentProvider } : {}),
  };
  writeStoryMeta(storyDir, meta);
  // Provider-aware so a legacy-cartoon repair (agentProvider → codex) rewrites
  // CLAUDE.md with the Codex file-creation contract; absent ⇒ Claude/manual.
  writeStoryInstructions(storyDir, meta.contentType, meta.agentProvider);

  return c.json({ ok: true });
});

/** GET /api/stories/:name/cuts/:plotFile — read cuts.json for a plot */
stories.get("/:name/cuts/:plotFile", (c) => {
  const name = safeName(c.req.param("name"));
  const plotFile = safeName(c.req.param("plotFile"));
  if (!name || !plotFile) return c.json({ error: "Invalid path" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  try {
    const cutsFile = readCutsFile(storyDir, plotFile);
    if (!cutsFile) return c.json({ error: "Cuts file not found" }, 404);
    return c.json(cutsFile);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

/** PUT /api/stories/:name/cuts/:plotFile — update cuts.json */
stories.put("/:name/cuts/:plotFile", async (c) => {
  const name = safeName(c.req.param("name"));
  const plotFile = safeName(c.req.param("plotFile"));
  if (!name || !plotFile) return c.json({ error: "Invalid path" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  const body = await c.req.json();
  const validation = validateCutsFile(body);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  writeCutsFile(storyDir, plotFile, body);
  return c.json({ ok: true });
});

/** POST /api/stories/:name/cuts/:plotFile/upload-clean/:cutId — upload clean image for a cut */
stories.post("/:name/cuts/:plotFile/upload-clean/:cutId", async (c) => {
  const name = safeName(c.req.param("name"));
  const plotFile = safeName(c.req.param("plotFile"));
  const cutIdStr = c.req.param("cutId");
  if (!name || !plotFile || !cutIdStr) return c.json({ error: "Invalid path" }, 400);

  const cutId = parseInt(cutIdStr, 10);
  if (isNaN(cutId) || cutId < 1) return c.json({ error: "Invalid cut ID" }, 400);

  const storyDir = path.join(STORIES_DIR, name);
  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  const cutsFile = readCutsFile(storyDir, plotFile);
  if (!cutsFile) return c.json({ error: "Cuts file not found" }, 404);

  const cut = cutsFile.cuts.find((c) => c.id === cutId);
  if (!cut) return c.json({ error: `Cut ${cutId} not found` }, 404);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "No file provided" }, 400);
  }
  const file = formData.get("file") as File | Blob | null;
  if (!file || (typeof file === "string")) {
    return c.json({ error: "No file provided" }, 400);
  }

  if (file.size > 1024 * 1024) {
    return c.json({ error: "File must be under 1MB" }, 400);
  }

  const mime = file.type;
  if (mime !== "image/webp" && mime !== "image/jpeg") {
    return c.json({ error: "Only WebP and JPEG images are supported" }, 400);
  }

  // Validate by actual file bytes, not just the (spoofable) MIME label, so a
  // renamed text/PNG file claiming image/webp cannot be recorded as a clean
  // image. Mirrors the magic-byte check used by sync-clean-images (#256/#266).
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!cleanImageBytesMatchMime(buffer, mime)) {
    return c.json(
      { error: "File content is not a valid WebP/JPEG image (bytes do not match the image type)" },
      400,
    );
  }

  const ext = mime === "image/webp" ? "webp" : "jpg";
  const padded = String(cutId).padStart(2, "0");
  const assetDir = path.join(storyDir, "assets", plotFile);
  fs.mkdirSync(assetDir, { recursive: true });

  const fileName = `cut-${padded}-clean.${ext}`;
  const filePath = path.join(assetDir, fileName);
  fs.writeFileSync(filePath, buffer);

  const cleanImagePath = `assets/${plotFile}/cut-${padded}-clean.${ext}`;
  cut.cleanImagePath = cleanImagePath;
  writeCutsFile(storyDir, plotFile, cutsFile);

  return c.json({ ok: true, cleanImagePath });
});

function saveExportedCut(
  storyDir: string,
  plotFile: string,
  cutId: number,
  buffer: Buffer,
  mime: string,
): { finalImagePath: string } {
  const ext = mime === "image/webp" ? "webp" : "jpg";
  const padded = String(cutId).padStart(2, "0");
  const assetDir = path.join(storyDir, "assets", plotFile);
  fs.mkdirSync(assetDir, { recursive: true });

  const fileName = `cut-${padded}-final.${ext}`;
  fs.writeFileSync(path.join(assetDir, fileName), buffer);

  const finalImagePath = `assets/${plotFile}/cut-${padded}-final.${ext}`;

  const cutsFile = readCutsFile(storyDir, plotFile)!;
  const cut = cutsFile.cuts.find((c) => c.id === cutId)!;
  cut.finalImagePath = finalImagePath;
  cut.exportedAt = new Date().toISOString();
  writeCutsFile(storyDir, plotFile, cutsFile);

  return { finalImagePath };
}

/** POST /api/stories/:name/cuts/:plotFile/export-final/:cutId — save exported final image */
stories.post("/:name/cuts/:plotFile/export-final/:cutId", async (c) => {
  const name = safeName(c.req.param("name"));
  const plotFile = safeName(c.req.param("plotFile"));
  const cutIdStr = c.req.param("cutId");
  if (!name || !plotFile || !cutIdStr) return c.json({ error: "Invalid path" }, 400);

  const cutId = parseInt(cutIdStr, 10);
  if (isNaN(cutId) || cutId < 1) return c.json({ error: "Invalid cut ID" }, 400);

  const storyDir = path.join(STORIES_DIR, name);
  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  const cutsFile = readCutsFile(storyDir, plotFile);
  if (!cutsFile) return c.json({ error: "Cuts file not found" }, 404);

  const cut = cutsFile.cuts.find((ct) => ct.id === cutId);
  if (!cut) return c.json({ error: `Cut ${cutId} not found` }, 404);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "No file provided" }, 400);
  }
  const file = formData.get("file") as File | Blob | null;
  if (!file || (typeof file === "string")) {
    return c.json({ error: "No file provided" }, 400);
  }

  if (file.size > 1024 * 1024) {
    return c.json({ error: "File must be under 1MB" }, 400);
  }

  const mime = file.type;
  if (mime !== "image/webp" && mime !== "image/jpeg") {
    return c.json({ error: "Only WebP and JPEG images are supported" }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = saveExportedCut(storyDir, plotFile, cutId, buffer, mime);

  return c.json({ ok: true, finalImagePath: result.finalImagePath });
});

/** POST /api/stories/:name/cuts/:plotFile/set-uploaded/:cutId — record upload CID/URL for a cut */
stories.post("/:name/cuts/:plotFile/set-uploaded/:cutId", async (c) => {
  const name = safeName(c.req.param("name"));
  const plotFile = safeName(c.req.param("plotFile"));
  const cutIdStr = c.req.param("cutId");
  if (!name || !plotFile || !cutIdStr) return c.json({ error: "Invalid path" }, 400);

  const cutId = parseInt(cutIdStr, 10);
  if (isNaN(cutId) || cutId < 1) return c.json({ error: "Invalid cut ID" }, 400);

  const storyDir = path.join(STORIES_DIR, name);
  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  const cutsFile = readCutsFile(storyDir, plotFile);
  if (!cutsFile) return c.json({ error: "Cuts file not found" }, 404);

  const cut = cutsFile.cuts.find((ct) => ct.id === cutId);
  if (!cut) return c.json({ error: `Cut ${cutId} not found` }, 404);

  const body = await c.req.json<{ cid: string; url: string }>();
  if (!body.cid || !body.url) return c.json({ error: "cid and url required" }, 400);

  cut.uploadedCid = body.cid;
  cut.uploadedUrl = body.url;
  writeCutsFile(storyDir, plotFile, cutsFile);

  return c.json({ ok: true });
});

/** POST /api/stories/:name/cuts/:plotFile/generate-markdown — generate/update plot markdown from cuts */
stories.post("/:name/cuts/:plotFile/generate-markdown", async (c) => {
  const name = safeName(c.req.param("name"));
  const plotFile = safeName(c.req.param("plotFile"));
  if (!name || !plotFile) return c.json({ error: "Invalid path" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  const cutsFile = readCutsFile(storyDir, plotFile);
  if (!cutsFile) return c.json({ error: "Cuts file not found" }, 404);

  const mdFile = path.join(storyDir, `${plotFile}.md`);
  const existingMd = fs.existsSync(mdFile) ? fs.readFileSync(mdFile, "utf-8") : "";

  const { markdown, warnings } = mergeCartoonMarkdown(existingMd, cutsFile.cuts);
  fs.writeFileSync(mdFile, markdown, "utf-8");

  return c.json({ ok: true, warnings });
});

const CLEAN_IMAGE_MAX_BYTES = 1024 * 1024;
const CLEAN_IMAGE_VALID_EXT = new Set(["webp", "jpg", "jpeg"]);

/** Map an allowed file extension to the image type its content must match. */
const CLEAN_IMAGE_EXT_TO_TYPE: Record<string, Exclude<SniffedType, "unknown">> = {
  webp: "webp",
  jpg: "jpeg",
  jpeg: "jpeg",
};

/**
 * POST /api/stories/:name/cuts/:plotFile/sync-clean-images — detect clean image
 * files that exist on disk and record their path on the matching cut. Only
 * records a path when a real, valid file exists (size ≤ 1MB, allowed extension);
 * invalid/oversized files are reported as `rejected` and never recorded.
 */
stories.post("/:name/cuts/:plotFile/sync-clean-images", (c) => {
  const name = safeName(c.req.param("name"));
  const plotFile = safeName(c.req.param("plotFile"));
  if (!name || !plotFile) return c.json({ error: "Invalid path" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  let cutsFile;
  try {
    cutsFile = readCutsFile(storyDir, plotFile);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  if (!cutsFile) return c.json({ error: "Cuts file not found" }, 404);

  const rejectedMap = new Map<string, { cutId: number; reason: string }>();

  // Validate a candidate relative path against the real filesystem. Returns true
  // ONLY when the file exists, has an allowed extension, and is ≤ 1MB. Oversized
  // or wrong-extension files are recorded in `rejected` (deduped by path) and
  // treated as missing so they are never written to cuts.json.
  const fileExists = (relPath: string): boolean => {
    const abs = path.join(storyDir, relPath);
    if (!fs.existsSync(abs)) return false;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;

    const cutMatch = relPath.match(/cut-(\d+)-clean\./);
    const cutId = cutMatch ? parseInt(cutMatch[1], 10) : 0;
    const ext = path.extname(relPath).slice(1).toLowerCase();

    if (!CLEAN_IMAGE_VALID_EXT.has(ext)) {
      rejectedMap.set(relPath, { cutId, reason: `Unsupported extension .${ext}` });
      return false;
    }
    if (stat.size > CLEAN_IMAGE_MAX_BYTES) {
      rejectedMap.set(relPath, { cutId, reason: "File must be under 1MB" });
      return false;
    }

    // Sniff the real content so a text file (or a renamed/mismatched image)
    // named `.webp`/`.jpg` cannot pass on extension alone.
    let sniffed: SniffedType;
    try {
      const fd = fs.openSync(abs, "r");
      try {
        const head = Buffer.alloc(16);
        const read = fs.readSync(fd, head, 0, 16, 0);
        sniffed = sniffImageType(head.subarray(0, read));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }

    if (sniffed === "unknown") {
      rejectedMap.set(relPath, {
        cutId,
        reason: "not a valid image (content does not match WebP/JPEG/PNG)",
      });
      return false;
    }
    if (sniffed !== CLEAN_IMAGE_EXT_TO_TYPE[ext]) {
      rejectedMap.set(relPath, { cutId, reason: `content does not match .${ext} extension` });
      return false;
    }
    return true;
  };

  // Touch every canonical candidate so oversized/invalid files surface as
  // rejections even when a valid one is also present for the same cut.
  for (const cut of cutsFile.cuts) {
    for (const rel of cleanImageCandidates(plotFile, cut.id)) {
      fileExists(rel);
    }
  }

  // Surface any on-disk clean image with a disallowed extension (e.g. .txt) so
  // the writer learns why it was not recorded — these never become candidates.
  const assetDir = path.join(storyDir, "assets", plotFile);
  if (fs.existsSync(assetDir)) {
    const knownCutIds = new Set(cutsFile.cuts.map((cut) => cut.id));
    for (const entry of fs.readdirSync(assetDir)) {
      const m = entry.match(/^cut-(\d+)-clean\.([A-Za-z0-9]+)$/);
      if (!m) continue;
      const ext = m[2].toLowerCase();
      const cutId = parseInt(m[1], 10);
      if (!knownCutIds.has(cutId)) continue;
      const rel = `assets/${plotFile}/${entry}`;
      if (!CLEAN_IMAGE_VALID_EXT.has(ext) && !rejectedMap.has(rel)) {
        rejectedMap.set(rel, { cutId, reason: `Unsupported extension .${ext}` });
      }
    }
  }

  const result = syncCleanImages(cutsFile.cuts, plotFile, fileExists);
  const rejected = Array.from(rejectedMap.values());
  if (result.changed) {
    writeCutsFile(storyDir, plotFile, { ...cutsFile, cuts: result.cuts });
  }

  return c.json({ ok: true, changed: result.changed, synced: result.synced, rejected });
});

/**
 * GET /api/stories/:name/cuts/:plotFile/detect-clean-images — dry-run detection.
 * Reports the cut ids that have a valid local clean image on disk (exists, ≤ 1MB,
 * magic-byte-valid, extension matches content) AND whose cut currently has
 * `cleanImagePath === null`. This mirrors the sync route's validation but NEVER
 * writes cuts.json — it is read-only so the client can show a per-cut affordance.
 */
stories.get("/:name/cuts/:plotFile/detect-clean-images", (c) => {
  const name = safeName(c.req.param("name"));
  const plotFile = safeName(c.req.param("plotFile"));
  if (!name || !plotFile) return c.json({ error: "Invalid path" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
    return c.json({ error: "Story not found" }, 404);
  }

  let cutsFile;
  try {
    cutsFile = readCutsFile(storyDir, plotFile);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  if (!cutsFile) return c.json({ error: "Cuts file not found" }, 404);

  // Validate a candidate relative path exactly like the sync route's `fileExists`
  // (exists + allowed extension + ≤ 1MB + magic-byte content match). Read-only:
  // never records rejections, never mutates cuts.json.
  const isValidCleanImage = (relPath: string): boolean => {
    const abs = path.join(storyDir, relPath);
    if (!fs.existsSync(abs)) return false;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;

    const ext = path.extname(relPath).slice(1).toLowerCase();
    if (!CLEAN_IMAGE_VALID_EXT.has(ext)) return false;
    if (stat.size > CLEAN_IMAGE_MAX_BYTES) return false;

    let sniffed: SniffedType;
    try {
      const fd = fs.openSync(abs, "r");
      try {
        const head = Buffer.alloc(16);
        const read = fs.readSync(fd, head, 0, 16, 0);
        sniffed = sniffImageType(head.subarray(0, read));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }

    if (sniffed === "unknown") return false;
    if (sniffed !== CLEAN_IMAGE_EXT_TO_TYPE[ext]) return false;
    return true;
  };

  const detected: number[] = [];
  for (const cut of cutsFile.cuts) {
    if (cut.cleanImagePath !== null) continue;
    const hasValid = cleanImageCandidates(plotFile, cut.id).some((rel) => isValidCleanImage(rel));
    if (hasValid) detected.push(cut.id);
  }

  return c.json({ detected });
});


const COVER_MAX_BYTES = 1024 * 1024;
// Candidate agent-created cover files, in preference order (#296). The agent
// writes a single cover under assets/; we never guess plot/cut images here.
const COVER_CANDIDATES = [
  { rel: "assets/cover.webp", type: "image/webp", sniff: "webp" as const },
  { rel: "assets/cover.jpg", type: "image/jpeg", sniff: "jpeg" as const },
  { rel: "assets/cover.jpeg", type: "image/jpeg", sniff: "jpeg" as const },
];

/**
 * GET /api/stories/:name/cover-asset — detect an agent-created cover image so the
 * genesis pre-publish UI can offer it as the default cover without a manual file
 * pick (#296). Returns the FIRST candidate that exists, with a byte-validated
 * `valid` flag (so an oversize or spoofed cover is surfaced as a warning and not
 * offered/uploaded). `{ found: false }` when no candidate exists.
 */
stories.get("/:name/cover-asset", (c) => {
  const name = safeName(c.req.param("name"));
  if (!name) return c.json({ error: "Invalid story name" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  for (const cand of COVER_CANDIDATES) {
    const full = path.join(storyDir, cand.rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;

    const size = fs.statSync(full).size;
    let sniffed: SniffedType = "unknown";
    try {
      const fd = fs.openSync(full, "r");
      try {
        const head = Buffer.alloc(16);
        const read = fs.readSync(fd, head, 0, 16, 0);
        sniffed = sniffImageType(head.subarray(0, read));
      } finally {
        fs.closeSync(fd);
      }
    } catch { /* treat as unreadable → invalid below */ }

    if (size > COVER_MAX_BYTES) {
      return c.json({ found: true, valid: false, path: cand.rel, type: cand.type, size, error: `${cand.rel} is ${(size / 1024).toFixed(0)}KB, exceeds the 1MB cover limit` });
    }
    if (sniffed !== cand.sniff) {
      return c.json({ found: true, valid: false, path: cand.rel, type: cand.type, size, error: `${cand.rel} is not a valid ${cand.sniff.toUpperCase()} image (file contents do not match)` });
    }
    return c.json({ found: true, valid: true, path: cand.rel, type: cand.type, size });
  }

  return c.json({ found: false });
});

/** GET /api/stories/:name/asset/:assetPath — serve story asset file (supports nested paths) */
// NOTE: uses a regex splat param (`{.+}`) rather than a bare `*` wildcard.
// Hono v4 does not populate `c.req.param("*")` for a mixed named/wildcard route
// like `/:name/asset/*`, so the handler always saw an empty assetPath and
// returned 400 — which surfaced as "Image not available" in the UI once the
// clean-image loaders actually started sending the auth header (#278). The
// regex param captures the remaining path, including slashes, and is readable
// back by name.
stories.get("/:name/asset/:assetPath{.+}", (c) => {
  const name = safeName(c.req.param("name"));
  if (!name) return c.json({ error: "Invalid story name" }, 400);

  const assetPath = c.req.param("assetPath");
  if (!assetPath) return c.json({ error: "Invalid asset path" }, 400);

  if (assetPath.includes("..") || assetPath.startsWith("/")) {
    return c.json({ error: "Invalid asset path" }, 400);
  }

  const fullPath = path.join(STORIES_DIR, name, "assets", assetPath);
  const resolved = path.resolve(fullPath);
  const assetsRoot = path.resolve(path.join(STORIES_DIR, name, "assets"));
  if (!resolved.startsWith(assetsRoot + path.sep) && resolved !== assetsRoot) {
    return c.json({ error: "Invalid asset path" }, 400);
  }

  if (!fs.existsSync(resolved)) {
    return c.json({ error: "Asset not found" }, 404);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  const ct = mimeTypes[ext] || "application/octet-stream";

  const data = fs.readFileSync(resolved);
  return new Response(data, {
    headers: { "Content-Type": ct, "Cache-Control": "no-cache" },
  });
});

/** GET /api/stories/:name/:file — single file content */
stories.get("/:name/:file", (c) => {
  const name = safeName(c.req.param("name"));
  const file = safeName(c.req.param("file"));
  if (!name || !file) return c.json({ error: "Invalid path" }, 400);
  const filePath = path.join(STORIES_DIR, name, file);

  if (!fs.existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const publishStatus = readPublishStatus(path.join(STORIES_DIR, name));
  const status = publishStatus[file] || { file, status: "pending" };

  return c.json({ ...status, content });
});

/** PUT /api/stories/:name/:file — update file content */
stories.put("/:name/:file", async (c) => {
  const name = safeName(c.req.param("name"));
  const file = safeName(c.req.param("file"));
  if (!name || !file) return c.json({ error: "Invalid path" }, 400);
  if (!file.endsWith(".md")) return c.json({ error: "Only .md files can be edited" }, 400);

  const filePath = path.join(STORIES_DIR, name, file);
  if (!fs.existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const body = await c.req.json<{ content: string }>();
  if (typeof body.content !== "string") {
    return c.json({ error: "Content must be a string" }, 400);
  }

  // Only write and reset status if content actually changed
  const existingContent = fs.readFileSync(filePath, "utf-8");
  if (body.content === existingContent) {
    return c.json({ ok: true, unchanged: true });
  }

  fs.writeFileSync(filePath, body.content, "utf-8");

  // Reset publish status to pending if file was previously published
  const storyDir = path.join(STORIES_DIR, name);
  const status = readPublishStatus(storyDir);
  if (status[file] && (status[file].status === "published" || status[file].status === "published-not-indexed")) {
    status[file].status = "pending";
    writePublishStatus(storyDir, status);
  }

  return c.json({ ok: true });
});

/** POST /api/stories/:name/:file/publish-status — update publish status after publishing */
stories.post("/:name/:file/publish-status", async (c) => {
  const name = safeName(c.req.param("name"));
  const file = safeName(c.req.param("file"));
  if (!name || !file) return c.json({ error: "Invalid path" }, 400);
  const storyDir = path.join(STORIES_DIR, name);
  const body = await c.req.json<{
    txHash: string;
    storylineId?: number;
    plotIndex?: number;
    contentCid: string;
    gasCost?: string;
    indexError?: string;
    authorAddress?: string;
  }>();

  const status = readPublishStatus(storyDir);
  const existing = status[file];
  status[file] = {
    file,
    status: body.indexError ? "published-not-indexed" : "published",
    txHash: body.txHash || existing?.txHash,
    storylineId: body.storylineId ?? existing?.storylineId,
    plotIndex: body.plotIndex ?? existing?.plotIndex,
    contentCid: body.contentCid || existing?.contentCid,
    gasCost: body.gasCost || existing?.gasCost,
    authorAddress: body.authorAddress || existing?.authorAddress,
    publishedAt: new Date().toISOString(),
    ...(body.indexError ? { indexError: body.indexError } : {}),
  };
  writePublishStatus(storyDir, status);

  return c.json({ ok: true });
});

/** POST /api/stories/:name/:file/mark-not-indexed — manually mark as not indexed */
stories.post("/:name/:file/mark-not-indexed", async (c) => {
  const name = safeName(c.req.param("name"));
  const file = safeName(c.req.param("file"));
  if (!name || !file) return c.json({ error: "Invalid path" }, 400);
  const storyDir = path.join(STORIES_DIR, name);

  const status = readPublishStatus(storyDir);
  const existing = status[file];
  if (!existing || (existing.status !== "published" && existing.status !== "published-not-indexed")) {
    return c.json({ error: "File is not published" }, 400);
  }

  const body = await c.req.json<{ indexError?: string }>().catch(() => ({}));
  status[file] = {
    ...existing,
    status: "published-not-indexed",
    indexError: body.indexError || "Manually marked as not indexed",
  };
  writePublishStatus(storyDir, status);

  return c.json({ ok: true });
});

export { stories as storiesRoutes, readPublishStatus, readStoryMeta, writeStoryMeta, saveExportedCut, STORIES_DIR };

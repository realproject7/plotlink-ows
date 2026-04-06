import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORIES_DIR = path.join(__dirname, "..", "..", "stories");

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
  contentCid?: string;
  publishedAt?: string;
  gasCost?: string;
  indexError?: string;
}

interface StoryInfo {
  name: string;
  files: FileStatus[];
  hasStructure: boolean;
  hasGenesis: boolean;
  plotCount: number;
  publishedCount: number;
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

function scanStory(storyDir: string, name: string): StoryInfo {
  const publishStatus = readPublishStatus(storyDir);
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

  return { name, files, hasStructure, hasGenesis, plotCount, publishedCount };
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

  fs.writeFileSync(filePath, body.content, "utf-8");

  // Reset publish status to pending if file was previously published
  // (edited content differs from on-chain content)
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
    contentCid: string;
    gasCost?: string;
    indexError?: string;
  }>();

  const status = readPublishStatus(storyDir);
  const existing = status[file];
  status[file] = {
    file,
    status: body.indexError ? "published-not-indexed" : "published",
    txHash: body.txHash || existing?.txHash,
    storylineId: body.storylineId ?? existing?.storylineId,
    contentCid: body.contentCid || existing?.contentCid,
    gasCost: body.gasCost || existing?.gasCost,
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

export { stories as storiesRoutes, readPublishStatus, STORIES_DIR };

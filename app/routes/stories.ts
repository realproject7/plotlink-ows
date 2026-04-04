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
  status: "published" | "pending" | "draft";
  txHash?: string;
  storylineId?: number;
  contentCid?: string;
  publishedAt?: string;
  gasCost?: string;
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
    if (existing?.status === "published") {
      return existing;
    }
    return { file, status: "pending" as const };
  });

  const hasStructure = entries.includes("structure.md");
  const hasGenesis = entries.includes("genesis.md");
  const plotCount = entries.filter((f) => f.match(/^plot-\d+\.md$/)).length;
  const publishedCount = files.filter((f) => f.status === "published").length;

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
  }>();

  const status = readPublishStatus(storyDir);
  status[file] = {
    file,
    status: "published",
    txHash: body.txHash,
    storylineId: body.storylineId,
    contentCid: body.contentCid,
    gasCost: body.gasCost,
    publishedAt: new Date().toISOString(),
  };
  writePublishStatus(storyDir, status);

  return c.json({ ok: true });
});

export { stories as storiesRoutes, readPublishStatus, STORIES_DIR };

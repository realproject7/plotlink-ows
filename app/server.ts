import dotenv from "dotenv";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { ENV_FILE, DATA_DIR, STORIES_DIR, DATABASE_URL } from "./lib/paths";

// Set DATABASE_URL before any Prisma imports
process.env.DATABASE_URL = DATABASE_URL;

// Load .env from ~/.plotlink-ows/ before anything else
const __dirnamePre = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: ENV_FILE });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { authRoutes, requireAuth } from "./routes/auth";
import { walletRoutes } from "./routes/wallet";
import { publishRoutes } from "./routes/publish";
import { dashboardRoutes } from "./routes/dashboard";
import { terminalRoutes, attachTerminalWs } from "./routes/terminal";
import { storiesRoutes } from "./routes/stories";
import { settingsRoutes } from "./routes/settings";
import { initDb } from "./db";
import { execSync } from "child_process";
import fs from "fs";

const __dirname = __dirnamePre;

const app = new Hono();
// CORS for local dev
app.use("/*", cors({ origin: "http://localhost:5173", credentials: true }));

// API routes
app.route("/api/auth", authRoutes);
// Protected routes
app.use("/api/wallet/*", requireAuth);
app.route("/api/wallet", walletRoutes);
app.use("/api/publish/*", requireAuth);
app.route("/api/publish", publishRoutes);
app.use("/api/dashboard/*", requireAuth);
app.route("/api/dashboard", dashboardRoutes);
app.use("/api/terminal/*", requireAuth);
app.route("/api/terminal", terminalRoutes);
app.use("/api/stories/*", requireAuth);
app.route("/api/stories", storiesRoutes);
app.use("/api/settings/*", requireAuth);
app.route("/api/settings", settingsRoutes);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }));

// In production, serve the built frontend
const distPath = path.join(__dirname, "web", "dist");
if (fs.existsSync(distPath)) {
  app.use("/*", serveStatic({ root: "./app/web/dist" }));
  app.get("*", (c) => {
    const html = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
    return c.html(html);
  });
}

/** Copy story directories from a source dir into STORIES_DIR, skipping duplicates */
function migrateStoriesFrom(srcDir: string, label: string) {
  if (!fs.existsSync(srcDir) || srcDir === STORIES_DIR) return;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_example");
  for (const entry of entries) {
    const dest = path.join(STORIES_DIR, entry.name);
    if (fs.existsSync(dest)) continue;
    try {
      fs.renameSync(path.join(srcDir, entry.name), dest);
    } catch {
      fs.cpSync(path.join(srcDir, entry.name), dest, { recursive: true });
    }
    console.log(`  Migrated story "${entry.name}" from ${label}`);
  }
}

/** Copy a single file if source exists and destination doesn't */
function migrateFileFrom(src: string, dest: string, label: string) {
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    console.log(`  Migrated ${label} → ${path.dirname(dest)}`);
  }
}

/** Migrate stories/data from old locations to ~/.plotlink-ows/ */
function migrateOldData() {
  // 1. Scan all previous npx cache directories
  const npxBase = path.join(os.homedir(), ".npm", "_npx");
  if (fs.existsSync(npxBase)) {
    try {
      // Only migrate stories from npx caches — db/sessions are singletons and
      // picking from a random cache entry could restore stale state
      for (const hash of fs.readdirSync(npxBase)) {
        const pkgRoot = path.join(npxBase, hash, "node_modules", "plotlink-ows");
        migrateStoriesFrom(path.join(pkgRoot, "stories"), `npx cache (${hash.slice(0, 8)})`);
      }
    } catch { /* npx cache scan best-effort */ }
  }

  // 2. Current package-relative path (dev → npx transition)
  const oldStoriesDir = path.join(__dirname, "..", "stories");
  const oldDataDir = path.join(__dirname, "..", "data");
  migrateStoriesFrom(oldStoriesDir, "package directory");
  migrateFileFrom(path.join(oldDataDir, "local.db"), path.join(DATA_DIR, "local.db"), "database");
  migrateFileFrom(
    path.join(oldDataDir, "terminal-sessions.json"),
    path.join(DATA_DIR, "terminal-sessions.json"),
    "terminal sessions",
  );
}

async function start() {
  // Auto-migrate from old package-relative paths
  migrateOldData();

  // Run Prisma db push to ensure schema is up to date
  const schemaPath = path.join(__dirname, "prisma", "schema.prisma");
  execSync(`npx prisma db push --schema ${schemaPath} --skip-generate`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  });

  // Initialize database connection
  await initDb();

  const port = Number(process.env.APP_PORT) || 7777;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`\n  PlotLink OWS running at http://localhost:${info.port}\n`);
  });

  // Terminal WebSocket: raw WS on /ws/terminal (bypasses Hono for raw PTY relay)
  const { WebSocketServer } = await import("ws");
  const wss = new WebSocketServer({ noServer: true });
  // server from serve() IS an http.Server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).on("upgrade", (req: any, socket: any, head: any) => {
    const url = new URL(req.url || "", `http://localhost:${port}`);
    if (url.pathname === "/ws/terminal") {
      // Auth check: verify token from query params
      const wsToken = url.searchParams.get("token");
      if (!wsToken) { socket.destroy(); return; }
      import("./db").then(async ({ db }) => {
        const session = await db.session.findUnique({ where: { token: wsToken } });
        if (!session || session.expiresAt < new Date()) { socket.destroy(); return; }
        const story = url.searchParams.get("story") || undefined;
        const resume = url.searchParams.get("resume") === "true";
        wss.handleUpgrade(req, socket, head, (ws) => {
          attachTerminalWs(ws as unknown as WebSocket, story, resume);
        });
      }).catch(() => socket.destroy());
    }
  });
}

start().catch(console.error);

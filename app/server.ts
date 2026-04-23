import dotenv from "dotenv";
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

/** Migrate stories/data from old package-relative paths to ~/.plotlink-ows/ */
function migrateOldData() {
  const oldStoriesDir = path.join(__dirname, "..", "stories");
  const oldDataDir = path.join(__dirname, "..", "data");

  // Migrate stories
  if (fs.existsSync(oldStoriesDir) && oldStoriesDir !== STORIES_DIR) {
    const oldEntries = fs.readdirSync(oldStoriesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_example");
    for (const entry of oldEntries) {
      const dest = path.join(STORIES_DIR, entry.name);
      if (!fs.existsSync(dest)) {
        fs.renameSync(path.join(oldStoriesDir, entry.name), dest);
        console.log(`  Migrated story "${entry.name}" → ${STORIES_DIR}`);
      }
    }
  }

  // Migrate database
  const oldDb = path.join(oldDataDir, "local.db");
  const newDb = path.join(DATA_DIR, "local.db");
  if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
    fs.copyFileSync(oldDb, newDb);
    console.log(`  Migrated database → ${DATA_DIR}`);
  }

  // Migrate terminal sessions
  const oldSessions = path.join(oldDataDir, "terminal-sessions.json");
  const newSessions = path.join(DATA_DIR, "terminal-sessions.json");
  if (fs.existsSync(oldSessions) && !fs.existsSync(newSessions)) {
    fs.copyFileSync(oldSessions, newSessions);
    console.log(`  Migrated terminal sessions → ${DATA_DIR}`);
  }
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

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env before anything else
const __dirnamePre = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirnamePre, "..", ".env") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { authRoutes, requireAuth } from "./routes/auth";
import { configRoutes } from "./routes/config";
import { walletRoutes } from "./routes/wallet";
import { oauthRoutes } from "./routes/oauth";
import { initDb } from "./db";
import { execSync } from "child_process";
import fs from "fs";

const __dirname = __dirnamePre;

const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

// CORS for local dev
app.use("/*", cors({ origin: "http://localhost:5173", credentials: true }));

// API routes
app.route("/api/auth", authRoutes);
// Protected routes
app.use("/api/config/*", requireAuth);
app.use("/api/wallet/*", requireAuth);
// OAuth: protect start/status but NOT callback (provider redirects without auth)
app.use("/api/oauth/:provider/start", requireAuth);
app.use("/api/oauth/:provider/status", requireAuth);
app.route("/api/config", configRoutes);
app.route("/api/wallet", walletRoutes);
app.route("/api/oauth", oauthRoutes);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }));

// WebSocket endpoint (placeholder for future chat streaming)
app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`);
    },
  })),
);

// In production, serve the built frontend
const distPath = path.join(__dirname, "web", "dist");
if (fs.existsSync(distPath)) {
  app.use("/*", serveStatic({ root: "./app/web/dist" }));
  app.get("*", (c) => {
    const html = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
    return c.html(html);
  });
}

async function start() {
  // Ensure data directory exists
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Run Prisma db push to ensure schema is up to date
  const schemaPath = path.join(__dirname, "prisma", "schema.prisma");
  execSync(`npx prisma db push --schema ${schemaPath} --skip-generate`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `file:${path.join(dataDir, "local.db")}` },
  });

  // Initialize database connection
  await initDb();

  const port = Number(process.env.APP_PORT) || 7777;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`\n  PlotLink OWS running at http://localhost:${info.port}\n`);
  });

  injectWebSocket(server);
}

start().catch(console.error);

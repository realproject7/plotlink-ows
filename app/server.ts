import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { ENV_FILE } from "./lib/paths";

// Load .env from ~/.plotlink-ows/ before anything else
const __dirnamePre = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: ENV_FILE });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { authRoutes, requireAuth } from "./routes/auth";
import { configRoutes } from "./routes/config";
import { walletRoutes } from "./routes/wallet";
import { oauthRoutes } from "./routes/oauth";
import { chatRoutes } from "./routes/chat";
import { publishRoutes } from "./routes/publish";
import { dashboardRoutes } from "./routes/dashboard";
import { terminalRoutes, attachTerminalWs } from "./routes/terminal";
import { storiesRoutes } from "./routes/stories";
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
app.use("/api/chat/*", requireAuth);
app.use("/api/publish/*", requireAuth);
app.route("/api/chat", chatRoutes);
app.route("/api/publish", publishRoutes);
app.use("/api/dashboard/*", requireAuth);
app.route("/api/dashboard", dashboardRoutes);
app.use("/api/terminal/*", requireAuth);
app.route("/api/terminal", terminalRoutes);
app.use("/api/stories/*", requireAuth);
app.route("/api/stories", storiesRoutes);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }));

// WebSocket chat endpoint (auth via query param since WS can't send headers)
app.get(
  "/ws/chat",
  upgradeWebSocket((c) => {
    const wsToken = new URL(c.req.url).searchParams.get("token");
    let authenticated = false;

    return {
    async onOpen(_event, ws) {
      if (!wsToken) { ws.close(4001, "Missing token"); return; }
      const { db } = await import("./db");
      const session = await db.session.findUnique({ where: { token: wsToken } });
      if (!session || session.expiresAt < new Date()) { ws.close(4001, "Invalid token"); return; }
      authenticated = true;
    },
    async onMessage(event, ws) {
      if (!authenticated) { ws.close(4001, "Not authenticated"); return; }
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === "message" && data.sessionId && data.content) {
          const { db } = await import("./db");
          const { streamChat } = await import("./lib/llm-client");
          const { WRITER_SYSTEM_PROMPT } = await import("./lib/writer-prompt");

          // Save user message
          await db.message.create({
            data: { sessionId: data.sessionId, role: "user", content: data.content },
          });

          // Build context
          const messages = await db.message.findMany({
            where: { sessionId: data.sessionId },
            orderBy: { createdAt: "asc" },
          });

          const chatMessages = [
            { role: "system" as const, content: WRITER_SYSTEM_PROMPT },
            ...messages.map((m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            })),
          ];

          // Stream response
          let fullResponse = "";
          for await (const chunk of streamChat(chatMessages)) {
            fullResponse += chunk;
            ws.send(JSON.stringify({ type: "chunk", content: chunk }));
          }

          // Save assistant message
          await db.message.create({
            data: { sessionId: data.sessionId, role: "assistant", content: fullResponse },
          });

          ws.send(JSON.stringify({ type: "done" }));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "WebSocket error";
        ws.send(JSON.stringify({ type: "error", message }));
      }
    },
  };
  }),
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

  // Ensure stories directory exists
  const storiesDir = path.join(__dirname, "..", "stories");
  if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });

  const port = Number(process.env.APP_PORT) || 7777;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`\n  PlotLink OWS running at http://localhost:${info.port}\n`);
  });

  injectWebSocket(server);

  // Terminal WebSocket: raw WS on /ws/terminal (bypasses Hono for raw PTY relay)
  const { WebSocketServer } = await import("ws");
  const wss = new WebSocketServer({ noServer: true });
  (server as import("http").Server).on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", `http://localhost:${port}`);
    if (url.pathname === "/ws/terminal") {
      // Auth check: verify token from query params
      const wsToken = url.searchParams.get("token");
      if (!wsToken) { socket.destroy(); return; }
      import("./db").then(async ({ db }) => {
        const session = await db.session.findUnique({ where: { token: wsToken } });
        if (!session || session.expiresAt < new Date()) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => {
          attachTerminalWs(ws as unknown as WebSocket);
        });
      }).catch(() => socket.destroy());
    }
  });
}

start().catch(console.error);

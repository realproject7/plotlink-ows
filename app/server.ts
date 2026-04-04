import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { authRoutes } from "./routes/auth";
import path from "path";
import fs from "fs";

const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

// CORS for local dev
app.use("/*", cors({ origin: "http://localhost:5173", credentials: true }));

// API routes
app.route("/api/auth", authRoutes);

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
const distPath = path.join(import.meta.dirname, "web", "dist");
if (fs.existsSync(distPath)) {
  app.use("/*", serveStatic({ root: "./app/web/dist" }));
  app.get("*", (c) => {
    const html = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
    return c.html(html);
  });
}

const port = Number(process.env.APP_PORT) || 7777;
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n  PlotLink OWS running at http://localhost:${info.port}\n`);
});

injectWebSocket(server);

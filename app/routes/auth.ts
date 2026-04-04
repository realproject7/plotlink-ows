import { Hono } from "hono";
import { createHmac, randomBytes } from "crypto";

const auth = new Hono();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const sessions = new Map<string, { expiresAt: number }>();

function hashPassphrase(passphrase: string): string {
  return createHmac("sha256", "plotlink-ows").update(passphrase).digest("hex");
}

function getStoredHash(): string | null {
  return process.env.OWS_PASSPHRASE ? hashPassphrase(process.env.OWS_PASSPHRASE) : null;
}

/** POST /api/auth/login — validate passphrase, return session token */
auth.post("/login", async (c) => {
  const body = await c.req.json<{ passphrase: string }>();
  if (!body.passphrase) {
    return c.json({ error: "Passphrase required" }, 400);
  }

  const storedHash = getStoredHash();
  if (!storedHash) {
    return c.json({ error: "Passphrase not configured. Set OWS_PASSPHRASE in .env" }, 500);
  }

  const inputHash = hashPassphrase(body.passphrase);
  if (inputHash !== storedHash) {
    return c.json({ error: "Invalid passphrase" }, 401);
  }

  const token = randomBytes(32).toString("hex");
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });

  return c.json({ token });
});

/** GET /api/auth/verify — check token validity */
auth.get("/verify", (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ valid: false }, 401);

  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    return c.json({ valid: false }, 401);
  }

  return c.json({ valid: true });
});

/** Auth middleware for protected routes */
export function requireAuth(c: any, next: any) {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    return c.json({ error: "Session expired" }, 401);
  }

  return next();
}

export { auth as authRoutes };

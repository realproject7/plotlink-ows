import { Hono } from "hono";
import { createHmac, randomBytes } from "crypto";
import { db } from "../db";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", "..", ".env");

const auth = new Hono();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashPassphrase(passphrase: string): string {
  return createHmac("sha256", "plotlink-ows").update(passphrase).digest("hex");
}

function readEnvPassphrase(): string | null {
  // Check process.env first
  if (process.env.OWS_PASSPHRASE) return process.env.OWS_PASSPHRASE;
  // Then read from .env file directly
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(/^OWS_PASSPHRASE=(.+)$/m);
      if (match) return match[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

async function getStoredHash(): Promise<string | null> {
  const passphrase = readEnvPassphrase();
  if (passphrase) return hashPassphrase(passphrase);
  // Fallback to DB setting
  const setting = await db.setting.findUnique({ where: { key: "passphrase_hash" } });
  return setting?.value ?? null;
}

/** GET /api/auth/status — check if passphrase is configured (first-run detection) */
auth.get("/status", async (c) => {
  const hash = await getStoredHash();
  return c.json({ configured: !!hash });
});

/** POST /api/auth/setup — first-run passphrase setup */
auth.post("/setup", async (c) => {
  const existing = await getStoredHash();
  if (existing) {
    return c.json({ error: "Passphrase already configured" }, 409);
  }

  const body = await c.req.json<{ passphrase: string }>();
  if (!body.passphrase || body.passphrase.length < 4) {
    return c.json({ error: "Passphrase must be at least 4 characters" }, 400);
  }

  // Persist passphrase to .env file
  const envLine = `OWS_PASSPHRASE=${body.passphrase}`;
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    if (content.includes("OWS_PASSPHRASE=")) {
      fs.writeFileSync(envPath, content.replace(/^OWS_PASSPHRASE=.*$/m, envLine));
    } else {
      fs.appendFileSync(envPath, `\n${envLine}\n`);
    }
  } else {
    fs.writeFileSync(envPath, `${envLine}\n`);
  }
  // Also set in process.env for immediate use
  process.env.OWS_PASSPHRASE = body.passphrase;

  // Auto-login after setup
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      token,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return c.json({ token });
});

/** POST /api/auth/login — validate passphrase, return session token */
auth.post("/login", async (c) => {
  const body = await c.req.json<{ passphrase: string }>();
  if (!body.passphrase) {
    return c.json({ error: "Passphrase required" }, 400);
  }

  const storedHash = await getStoredHash();
  if (!storedHash) {
    return c.json({ error: "Passphrase not configured. Complete first-run setup." }, 500);
  }

  const inputHash = hashPassphrase(body.passphrase);
  if (inputHash !== storedHash) {
    return c.json({ error: "Invalid passphrase" }, 401);
  }

  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      token,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return c.json({ token });
});

/** GET /api/auth/verify — check token validity */
auth.get("/verify", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ valid: false }, 401);

  const session = await db.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await db.session.delete({ where: { token } });
    return c.json({ valid: false }, 401);
  }

  return c.json({ valid: true });
});

export { auth as authRoutes };

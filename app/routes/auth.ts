import { Hono } from "hono";
import { createHmac, randomBytes } from "crypto";
import { db } from "../db";

const auth = new Hono();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashPassphrase(passphrase: string): string {
  return createHmac("sha256", "plotlink-ows").update(passphrase).digest("hex");
}

async function getStoredHash(): Promise<string | null> {
  // Check env first, then DB setting
  if (process.env.OWS_PASSPHRASE) {
    return hashPassphrase(process.env.OWS_PASSPHRASE);
  }
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

  const hash = hashPassphrase(body.passphrase);
  await db.setting.upsert({
    where: { key: "passphrase_hash" },
    update: { value: hash },
    create: { key: "passphrase_hash", value: hash },
  });

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

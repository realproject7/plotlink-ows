import { Hono } from "hono";
import { randomBytes, createHash } from "crypto";
import fs from "fs";
import { ENV_FILE } from "../lib/paths";

const envPath = ENV_FILE;

const oauth = new Hono();

// OAuth state store (in-memory, keyed by state param)
const pendingFlows = new Map<string, { provider: string; codeVerifier: string; status: "pending" | "complete"; token?: string }>();

const OAUTH_CONFIGS: Record<string, { authUrl: string; tokenUrl: string; clientId: string; envKey: string }> = {
  anthropic: {
    authUrl: "https://console.anthropic.com/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/oauth/token",
    clientId: "plotlink-ows-local",
    envKey: "ANTHROPIC_OAUTH_TOKEN",
  },
  openai: {
    authUrl: "https://platform.openai.com/oauth/authorize",
    tokenUrl: "https://platform.openai.com/oauth/token",
    clientId: "plotlink-ows-local",
    envKey: "OPENAI_OAUTH_TOKEN",
  },
};

function writeEnvVar(key: string, value: string) {
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      fs.writeFileSync(envPath, content.replace(regex, `${key}=${value}`));
    } else {
      fs.appendFileSync(envPath, `\n${key}=${value}\n`);
    }
  } else {
    fs.writeFileSync(envPath, `${key}=${value}\n`);
  }
  process.env[key] = value;
}

/** GET /api/oauth/:provider/start — initiate OAuth PKCE flow */
oauth.get("/:provider/start", (c) => {
  const provider = c.req.param("provider");
  const config = OAUTH_CONFIGS[provider];
  if (!config) return c.json({ error: "Unsupported OAuth provider" }, 400);

  const state = randomBytes(16).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");

  pendingFlows.set(state, { provider, codeVerifier, status: "pending" });

  // Compute S256 code_challenge from verifier
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  // Build authorization URL with PKCE
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: "http://localhost:7777/api/oauth/callback",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: "api",
  });

  const authUrl = `${config.authUrl}?${params}`;

  return c.json({ authUrl, state });
});

/** GET /api/oauth/callback — OAuth redirect handler */
oauth.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.html(`<html><body><h2>OAuth Error</h2><p>${error}</p><script>window.close()</script></body></html>`);
  }

  if (!code || !state) {
    return c.html(`<html><body><h2>Missing parameters</h2><script>window.close()</script></body></html>`);
  }

  const flow = pendingFlows.get(state);
  if (!flow) {
    return c.html(`<html><body><h2>Invalid state</h2><script>window.close()</script></body></html>`);
  }

  const config = OAUTH_CONFIGS[flow.provider];
  if (!config) {
    return c.html(`<html><body><h2>Unknown provider</h2><script>window.close()</script></body></html>`);
  }

  try {
    // Exchange code for token
    const res = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://localhost:7777/api/oauth/callback",
        client_id: config.clientId,
        code_verifier: flow.codeVerifier,
      }),
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      throw new Error((data.error_description || data.error || "Token exchange failed") as string);
    }

    const accessToken = data.access_token as string;
    writeEnvVar(config.envKey, accessToken);
    flow.status = "complete";
    flow.token = accessToken;

    return c.html(`<html><body><h2>Connected!</h2><p>You can close this window.</p><script>window.close()</script></body></html>`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return c.html(`<html><body><h2>Error</h2><p>${message}</p><script>window.close()</script></body></html>`);
  }
});

/** GET /api/oauth/:provider/status — poll for OAuth completion */
oauth.get("/:provider/status", (c) => {
  const provider = c.req.param("provider");
  const config = OAUTH_CONFIGS[provider];
  if (!config) return c.json({ error: "Unsupported provider" }, 400);

  // Check if token is already in env
  if (process.env[config.envKey]) {
    return c.json({ complete: true });
  }

  // Check pending flows
  for (const [, flow] of pendingFlows) {
    if (flow.provider === provider && flow.status === "complete") {
      return c.json({ complete: true });
    }
  }

  return c.json({ complete: false });
});

export { oauth as oauthRoutes };

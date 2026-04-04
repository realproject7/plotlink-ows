import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { ENV_FILE } from "../lib/paths";

const oauth = new Hono();

const OAUTH_TOKEN_KEY_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_OAUTH_TOKEN",
  openai: "OPENAI_OAUTH_TOKEN",
  gemini: "GEMINI_OAUTH_TOKEN",
};

// Track active OAuth flows
const activeOAuthFlows = new Map<string, { resolve: (creds: unknown) => void; reject: (err: Error) => void }>();

function writeEnvVar(key: string, value: string) {
  const dir = path.dirname(ENV_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(ENV_FILE)) {
    const content = fs.readFileSync(ENV_FILE, "utf-8");
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      fs.writeFileSync(ENV_FILE, content.replace(regex, `${key}=${value}`));
    } else {
      fs.appendFileSync(ENV_FILE, `\n${key}=${value}\n`);
    }
  } else {
    fs.writeFileSync(ENV_FILE, `${key}=${value}\n`);
  }
  process.env[key] = value;
}

async function waitForAuthUrl(getUrl: () => string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!getUrl() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** GET /api/oauth/:provider/start — initiate OAuth via pi-ai */
oauth.get("/:provider/start", async (c) => {
  const provider = c.req.param("provider");
  const envKey = OAUTH_TOKEN_KEY_MAP[provider];
  if (!envKey) return c.json({ error: `OAuth not supported for ${provider}` }, 400);

  // Cancel any existing flow for this provider
  if (activeOAuthFlows.has(provider)) {
    activeOAuthFlows.get(provider)!.reject(new Error("New flow started"));
    activeOAuthFlows.delete(provider);
  }

  let authUrl = "";

  const onAuth = (info: { url: string }) => {
    authUrl = info.url;
  };

  // Start the pi-ai OAuth flow in background
  const credentialsPromise = (async () => {
    const piOAuth = await import("@mariozechner/pi-ai/oauth");

    switch (provider) {
      case "anthropic":
        return piOAuth.loginAnthropic({
          onAuth,
          onPrompt: async () => "",
          onProgress: () => {},
        });
      case "openai":
        return piOAuth.loginOpenAICodex({
          onAuth,
          onPrompt: async () => "",
          onProgress: () => {},
        });
      case "gemini":
        return piOAuth.loginGeminiCli(
          onAuth,
          () => {},
        );
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  })();

  // Persist token when flow completes (background, doesn't block response)
  credentialsPromise
    .then(async (creds: Record<string, unknown>) => {
      const piOAuth = await import("@mariozechner/pi-ai/oauth");
      let apiKey: string;

      // Extract API key from credentials using provider interface
      if (provider === "anthropic") {
        apiKey = piOAuth.anthropicOAuthProvider.getApiKey(creds) ?? String(creds.access ?? "");
      } else if (provider === "openai") {
        apiKey = piOAuth.openaiCodexOAuthProvider.getApiKey(creds) ?? String(creds.access ?? "");
      } else if (provider === "gemini") {
        apiKey = piOAuth.geminiCliOAuthProvider.getApiKey(creds) ?? String(creds.access ?? "");
      } else {
        apiKey = String(creds.access ?? "");
      }

      writeEnvVar(envKey, apiKey);
      console.log(`OAuth: ${provider} credentials saved`);
    })
    .catch((err: Error) => {
      console.error(`OAuth flow failed for ${provider}:`, err.message);
    });

  // Wait for pi-ai to generate the auth URL
  await waitForAuthUrl(() => authUrl);

  if (!authUrl) {
    return c.json({ error: "Failed to get authorization URL" }, 500);
  }

  return c.json({ url: authUrl, method: "popup_redirect" });
});

/** GET /api/oauth/:provider/status — poll for OAuth completion */
oauth.get("/:provider/status", (c) => {
  const provider = c.req.param("provider");
  const envKey = OAUTH_TOKEN_KEY_MAP[provider];
  if (!envKey) return c.json({ done: false });

  const token = process.env[envKey];
  return c.json({ done: !!token });
});

export { oauth as oauthRoutes };

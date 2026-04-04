import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "..", "agent.config.json");
const envPath = path.join(__dirname, "..", "..", ".env");

const config = new Hono();

/** Provider catalog with metadata */
const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", envKeys: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"], models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6"], tag: "recommended" },
  { id: "openai", name: "OpenAI", envKeys: ["OPENAI_API_KEY", "OPENAI_OAUTH_TOKEN"], models: ["gpt-4.1", "gpt-4.1-mini", "o3-mini"], tag: null },
  { id: "gemini", name: "Google Gemini", envKeys: ["GEMINI_API_KEY"], models: ["gemini-2.5-flash", "gemini-2.5-pro"], tag: null },
  { id: "local", name: "Local (Ollama/LM Studio)", envKeys: [], models: [], tag: "free" },
];

/** Check if any env key for a provider is set */
function isProviderConfigured(p: typeof PROVIDERS[number]): boolean {
  return p.envKeys.some((k) => !!process.env[k]);
}

/** Get the active credential for a provider */
function getProviderCredential(p: typeof PROVIDERS[number]): string | null {
  for (const k of p.envKeys) {
    if (process.env[k]) return process.env[k]!;
  }
  return null;
}

function readConfig(): Record<string, unknown> {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function writeConfig(cfg: Record<string, unknown>) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
}

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

/** GET /api/config/llm — current LLM config */
config.get("/llm", (c) => {
  const cfg = readConfig() as { llm?: Record<string, unknown> };
  const llm = cfg.llm || {};

  // Check which providers are configured
  const configured = PROVIDERS.filter((p) => {
    if (p.id === "local") return !!(llm as Record<string, unknown>).local;
    return isProviderConfigured(p);
  }).map((p) => p.id);

  return c.json({ llm, configured });
});

/** GET /api/config/llm/providers — provider catalog */
config.get("/llm/providers", (c) => {
  return c.json(
    PROVIDERS.map((p) => ({
      ...p,
      configured: isProviderConfigured(p),
    })),
  );
});

/** POST /api/config/llm — save LLM config */
config.post("/llm", async (c) => {
  const body = await c.req.json<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    apiType?: string;
    spendCap?: number;
  }>();

  if (!body.provider || !body.model) {
    return c.json({ error: "provider and model required" }, 400);
  }

  const provider = PROVIDERS.find((p) => p.id === body.provider);
  if (!provider) return c.json({ error: "Unknown provider" }, 400);

  // Save API key to .env if provided (use first envKey as the primary)
  if (body.apiKey && provider.envKeys.length > 0) {
    writeEnvVar(provider.envKeys[0], body.apiKey);
  }

  // Build config
  const cfg = readConfig();
  const llmConfig: Record<string, unknown> = (cfg.llm as Record<string, unknown>) || {};

  if (body.provider === "local") {
    llmConfig.local = {
      baseUrl: body.baseUrl || "http://localhost:11434",
      apiType: body.apiType || "ollama",
      model: body.model,
    };
  } else {
    // Find which env key is active (API key or OAuth token)
    const activeEnvKey = provider.envKeys.find((k) => !!process.env[k]) || provider.envKeys[0];
    llmConfig[body.provider] = {
      apiKey: activeEnvKey ? `env:${activeEnvKey}` : undefined,
      model: body.model,
    };
  }

  llmConfig.activeProvider = body.provider;
  llmConfig.activeModel = body.model;

  cfg.llm = llmConfig;

  // Persist spending cap if provided
  if (body.spendCap !== undefined) {
    (cfg as Record<string, unknown>).spendCap = body.spendCap;
  }

  writeConfig(cfg);

  return c.json({ success: true });
});

/** POST /api/config/llm/test — test LLM connection */
config.post("/llm/test", async (c) => {
  const body = await c.req.json<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }>();

  try {
    if (body.provider === "local") {
      const baseUrl = body.baseUrl || "http://localhost:11434";
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) throw new Error(`Local server returned ${res.status}`);
      return c.json({ success: true, message: "Connected to local model server" });
    }

    // For cloud providers, do a minimal test
    const provider = PROVIDERS.find((p) => p.id === body.provider);
    const apiKey = body.apiKey || (provider ? getProviderCredential(provider) : null);

    if (!apiKey) {
      return c.json({ success: false, message: "No API key configured" }, 400);
    }

    // Test with a minimal request based on provider
    if (body.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: body.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error?.toString() || `HTTP ${res.status}`);
      }
    } else if (body.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: body.model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else if (body.provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 1 } }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }

    return c.json({ success: true, message: "Connection verified" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return c.json({ success: false, message }, 400);
  }
});

export { config as configRoutes };

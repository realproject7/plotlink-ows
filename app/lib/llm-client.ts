import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "..", "agent.config.json");

interface LLMConfig {
  activeProvider?: string;
  activeModel?: string;
  local?: { baseUrl: string; model: string; apiType?: string };
  [key: string]: unknown;
}

function readLLMConfig(): LLMConfig {
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return (cfg.llm as LLMConfig) || {};
    }
  } catch { /* ignore */ }
  return {};
}

function getCredential(provider: string): string | null {
  const keyMap: Record<string, string[]> = {
    anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
    openai: ["OPENAI_API_KEY", "OPENAI_OAUTH_TOKEN"],
    gemini: ["GEMINI_API_KEY"],
  };
  for (const key of keyMap[provider] || []) {
    if (process.env[key]) return process.env[key]!;
  }
  return null;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Stream a chat completion from the configured LLM provider.
 * Yields text chunks as they arrive.
 */
export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
  const config = readLLMConfig();
  const provider = config.activeProvider;
  const model = config.activeModel;

  if (!provider || !model) {
    yield "Error: No LLM provider configured. Go to Settings → LLM to set up.";
    return;
  }

  if (provider === "anthropic") {
    yield* streamAnthropic(messages, model);
  } else if (provider === "openai") {
    yield* streamOpenAI(messages, model);
  } else if (provider === "gemini") {
    yield* streamGemini(messages, model);
  } else if (provider === "local") {
    const localConfig = config.local;
    if (!localConfig) { yield "Error: Local model not configured."; return; }
    yield* streamLocal(messages, localConfig.baseUrl, localConfig.model, localConfig.apiType);
  } else {
    yield `Error: Unknown provider "${provider}".`;
  }
}

async function* streamAnthropic(messages: ChatMessage[], model: string): AsyncGenerator<string> {
  const apiKey = getCredential("anthropic");
  if (!apiKey) { yield "Error: No Anthropic API key configured."; return; }

  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      ...(systemMsg && { system: systemMsg.content }),
      messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    yield `Error: Anthropic API ${res.status} — ${err}`;
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            yield parsed.delta.text;
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }
}

async function* streamOpenAI(messages: ChatMessage[], model: string): AsyncGenerator<string> {
  const apiKey = getCredential("openai");
  if (!apiKey) { yield "Error: No OpenAI API key configured."; return; }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, messages }),
  });

  if (!res.ok) {
    yield `Error: OpenAI API ${res.status}`;
    return;
  }

  yield* parseSSEStream(res);
}

async function* streamGemini(messages: ChatMessage[], model: string): AsyncGenerator<string> {
  const apiKey = getCredential("gemini");
  if (!apiKey) { yield "Error: No Gemini API key configured."; return; }

  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const systemInstruction = messages.find((m) => m.role === "system");

  // Use streamGenerateContent for streaming
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction.content }] } }),
        generationConfig: { maxOutputTokens: 4096 },
      }),
    },
  );

  if (!res.ok) {
    yield `Error: Gemini API ${res.status}`;
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch { /* ignore */ }
      }
    }
  }
}

async function* streamLocal(messages: ChatMessage[], baseUrl: string, model: string, apiType?: string): AsyncGenerator<string> {
  if (apiType === "ollama") {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!res.ok) { yield `Error: Local model ${res.status}`; return; }

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) yield parsed.message.content;
        } catch { /* ignore */ }
      }
    }
  } else {
    // OpenAI-compatible (LM Studio, etc.)
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true, messages }),
    });
    if (!res.ok) { yield `Error: Local model ${res.status}`; return; }
    yield* parseSSEStream(res);
  }
}

async function* parseSSEStream(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch { /* ignore */ }
      }
    }
  }
}

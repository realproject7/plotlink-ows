import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db } from "../db";
import { streamChat, type ChatMessage } from "../lib/llm-client";
import { WRITER_SYSTEM_PROMPT } from "../lib/writer-prompt";

const chat = new Hono();

/** POST /api/chat/sessions — create a new story session */
chat.post("/sessions", async (c) => {
  const body = await c.req.json<{ title?: string; genre?: string }>();
  const session = await db.storySession.create({
    data: { title: body.title || "Untitled Story", genre: body.genre || null },
  });
  return c.json(session);
});

/** GET /api/chat/sessions — list all sessions */
chat.get("/sessions", async (c) => {
  const sessions = await db.storySession.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true, drafts: true } } },
  });
  return c.json(sessions);
});

/** GET /api/chat/sessions/:id — get session with messages */
chat.get("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const session = await db.storySession.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } }, drafts: { orderBy: { createdAt: "desc" } } },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(session);
});

/** DELETE /api/chat/sessions/:id — delete a session */
chat.delete("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  await db.storySession.delete({ where: { id } });
  return c.json({ success: true });
});

/** POST /api/chat/sessions/:id/send — send a message and stream AI response */
chat.post("/sessions/:id/send", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ content: string }>();

  if (!body.content?.trim()) {
    return c.json({ error: "Message content required" }, 400);
  }

  // Save user message
  await db.message.create({
    data: { sessionId: id, role: "user", content: body.content },
  });

  // Build context from conversation history
  const messages = await db.message.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
  });

  const chatMessages: ChatMessage[] = [
    { role: "system", content: WRITER_SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role as ChatMessage["role"], content: m.content })),
  ];

  // Stream response via SSE
  return streamSSE(c, async (stream) => {
    let fullResponse = "";

    try {
      for await (const chunk of streamChat(chatMessages)) {
        fullResponse += chunk;
        await stream.writeSSE({ data: JSON.stringify({ type: "chunk", content: chunk }) });
      }

      // Save assistant message
      await db.message.create({
        data: { sessionId: id, role: "assistant", content: fullResponse },
      });

      // Update session title from first exchange if still "Untitled Story"
      const session = await db.storySession.findUnique({ where: { id } });
      if (session?.title === "Untitled Story" && messages.length <= 2) {
        const title = body.content.slice(0, 60) + (body.content.length > 60 ? "..." : "");
        await db.storySession.update({ where: { id }, data: { title } });
      }

      await stream.writeSSE({ data: JSON.stringify({ type: "done", messageId: fullResponse.slice(0, 20) }) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Stream error";
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message }) });
    }
  });
});

/** POST /api/chat/sessions/:id/finalize — create a draft from conversation */
chat.post("/sessions/:id/finalize", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ title: string; content: string; genre?: string }>();

  if (!body.title || !body.content) {
    return c.json({ error: "Title and content required" }, 400);
  }

  const draft = await db.draft.create({
    data: {
      sessionId: id,
      title: body.title,
      content: body.content,
      genre: body.genre || null,
      status: "ready",
    },
  });

  await db.storySession.update({
    where: { id },
    data: { status: "finalized" },
  });

  return c.json(draft);
});

/** GET /api/chat/drafts — list all drafts */
chat.get("/drafts", async (c) => {
  const drafts = await db.draft.findMany({
    orderBy: { createdAt: "desc" },
  });
  return c.json(drafts);
});

export { chat as chatRoutes };

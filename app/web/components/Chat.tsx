import React, { useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";

const API_BASE = "http://localhost:7777";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

interface StorySession {
  id: string;
  title: string;
  genre: string | null;
  status: string;
  messages: Message[];
  drafts: Array<{ id: string; title: string; content: string; genre: string | null; status: string }>;
}

export function Chat({ token }: { token: string }) {
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; status: string; _count: { messages: number } }>>([]);
  const [activeSession, setActiveSession] = useState<StorySession | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

  const loadSessions = () => {
    authFetch(`${API_BASE}/api/chat/sessions`)
      .then((r) => r.json())
      .then((data) => setSessions(data));
  };

  const loadSession = (id: string) => {
    authFetch(`${API_BASE}/api/chat/sessions/${id}`)
      .then((r) => r.json())
      .then((data) => setActiveSession(data));
  };

  useEffect(() => { loadSessions(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeSession?.messages, streamContent]);

  const createSession = async () => {
    const res = await authFetch(`${API_BASE}/api/chat/sessions`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const session = await res.json();
    loadSessions();
    loadSession(session.id);
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeSession || streaming) return;
    const content = input.trim();
    setInput("");
    setStreaming(true);
    setStreamContent("");

    // Optimistically add user message
    setActiveSession((prev) => prev ? {
      ...prev,
      messages: [...prev.messages, { id: "temp", role: "user", content, createdAt: new Date().toISOString() }],
    } : null);

    try {
      // Use WebSocket for streaming
      const ws = new WebSocket(`ws://localhost:7777/ws/chat?token=${encodeURIComponent(token)}`);
      let fullContent = "";

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "message", sessionId: activeSession.id, content }));
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "chunk") {
              fullContent += data.content;
              setStreamContent(fullContent);
            } else if (data.type === "done") {
              ws.close();
              resolve();
            } else if (data.type === "error") {
              ws.close();
              reject(new Error(data.message));
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => reject(new Error("WebSocket error"));
        ws.onclose = () => resolve();
      });

      // Reload session to get persisted messages
      loadSession(activeSession.id);
      loadSessions();
    } catch (err) {
      console.error("Send error:", err);
    }

    setStreaming(false);
    setStreamContent("");
  };

  const handleFinalize = async () => {
    if (!activeSession) return;
    const lastAssistant = [...activeSession.messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;

    // Try to extract title and content from the formatted output
    const content = lastAssistant.content;
    const titleMatch = content.match(/TITLE:\s*(.+)/);
    const genreMatch = content.match(/GENRE:\s*(.+)/);
    const storyMatch = content.match(/---\n([\s\S]+)$/);

    const title = titleMatch?.[1]?.trim() || activeSession.title;
    const genre = genreMatch?.[1]?.trim() || activeSession.genre;
    const storyContent = storyMatch?.[1]?.trim() || content;

    await authFetch(`${API_BASE}/api/chat/sessions/${activeSession.id}/finalize`, {
      method: "POST",
      body: JSON.stringify({ title, content: storyContent, genre }),
    });

    loadSession(activeSession.id);
    loadSessions();
  };

  return (
    <div className="flex h-full">
      {/* Sidebar — session list */}
      <div className="border-border w-56 shrink-0 border-r">
        <div className="p-3">
          <button
            onClick={createSession}
            className="border-accent text-accent hover:bg-accent/10 w-full rounded border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            + new story
          </button>
        </div>
        <div className="space-y-0.5 px-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSession(s.id)}
              className={`w-full rounded px-2 py-1.5 text-left text-xs truncate transition-colors ${
                activeSession?.id === s.id ? "bg-surface text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {!activeSession ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-muted text-sm">select or create a story session</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="border-border flex items-center justify-between border-b px-4 py-2">
              <div>
                <h3 className="text-foreground text-sm font-medium">{activeSession.title}</h3>
                <span className="text-muted text-[10px]">{activeSession.genre || "no genre"} · {activeSession.status}</span>
              </div>
              {activeSession.status === "active" && activeSession.messages.length > 0 && (
                <button
                  onClick={handleFinalize}
                  className="border-accent text-accent hover:bg-accent/10 rounded border px-3 py-1 text-[10px] font-medium transition-colors"
                >
                  finalize draft
                </button>
              )}
              {activeSession.drafts?.length > 0 && (
                <span className="rounded border border-green-700/30 px-2 py-0.5 text-[10px] text-accent">
                  draft ready
                </span>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeSession.messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-accent/10 text-foreground"
                      : "bg-surface text-foreground border border-border"
                  }`}>
                    <div className="prose prose-xs max-w-none text-xs leading-relaxed"><Markdown>{msg.content}</Markdown></div>
                  </div>
                </div>
              ))}

              {/* Streaming response */}
              {streaming && streamContent && (
                <div className="flex justify-start">
                  <div className="bg-surface border-border max-w-[80%] rounded border px-3 py-2">
                    <div className="prose prose-xs max-w-none text-xs leading-relaxed"><Markdown>{streamContent}</Markdown></div>
                    <span className="text-accent animate-pulse">▌</span>
                  </div>
                </div>
              )}

              {streaming && !streamContent && (
                <div className="flex justify-start">
                  <div className="text-muted text-xs">thinking...</div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-border border-t p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="describe your story idea..."
                  disabled={streaming || activeSession.status !== "active"}
                  className="bg-surface border-border text-foreground placeholder:text-muted/50 flex-1 rounded border px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-40"
                />
                <button
                  onClick={sendMessage}
                  disabled={streaming || !input.trim() || activeSession.status !== "active"}
                  className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 rounded border px-4 py-2 text-sm font-medium transition-colors"
                >
                  send
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Draft preview panel */}
      {activeSession?.drafts && activeSession.drafts.length > 0 && (
        <div className="border-border w-80 shrink-0 overflow-y-auto border-l p-4">
          <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Draft Preview</h3>
          {activeSession.drafts.map((draft) => (
            <div key={draft.id} className="border-border space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-foreground text-sm font-medium">{draft.title}</h4>
                <span className="rounded border border-green-700/30 px-1.5 py-0.5 text-[9px] text-accent">{draft.status}</span>
              </div>
              {draft.genre && <span className="text-accent text-[10px]">{draft.genre}</span>}
              <div className="bg-surface max-h-[60vh] overflow-y-auto rounded p-3">
                <div className="prose prose-xs max-w-none text-xs leading-relaxed">
                  <Markdown>{draft.content}</Markdown>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

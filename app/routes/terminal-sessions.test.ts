import { describe, it, expect } from "vitest";
import { resumeIdFrom, isSessionRecord, carrySessionAcrossRename, type StoredValue } from "./terminal";

/**
 * Session-store back-compat: terminal-sessions.json may hold legacy bare-string
 * values (Claude UUIDs) OR new provider-aware records. Readers must accept both,
 * and writing one Codex key must NOT rewrite existing legacy strings.
 */
describe("session store shapes (resumeIdFrom / isSessionRecord)", () => {
  it("legacy bare string resolves to itself", () => {
    expect(resumeIdFrom("legacy-uuid-123")).toBe("legacy-uuid-123");
  });

  it("provider record resolves to its sessionId", () => {
    expect(
      resumeIdFrom({ provider: "codex", sessionId: "codex-id", lastStartedAt: 1 }),
    ).toBe("codex-id");
  });

  it("provider record with null sessionId resolves to null", () => {
    expect(resumeIdFrom({ provider: "codex", sessionId: null })).toBeNull();
  });

  it("missing entry resolves to null", () => {
    expect(resumeIdFrom(undefined)).toBeNull();
  });

  it("isSessionRecord distinguishes string vs record", () => {
    expect(isSessionRecord("bare-string")).toBe(false);
    expect(isSessionRecord(undefined)).toBe(false);
    expect(isSessionRecord({ provider: "codex", sessionId: null })).toBe(true);
    expect(isSessionRecord({ provider: "claude", sessionId: "x" })).toBe(true);
  });
});

describe("session store map mutation (no wholesale migration)", () => {
  // Simulates the load → mutate one key → save cycle that spawnPty performs.
  it("legacy mixed file: both shapes yield correct resume ids", () => {
    const map: Record<string, StoredValue> = {
      legacy: "legacy-id",
      modern: { provider: "codex", sessionId: "codex-id" },
    };
    expect(resumeIdFrom(map["legacy"])).toBe("legacy-id");
    expect(resumeIdFrom(map["modern"])).toBe("codex-id");
  });

  it("writing a Claude session keeps a bare string", () => {
    const map: Record<string, StoredValue> = { a: "id-a", b: "id-b" };
    // Claude path: assign a bare string (legacy shape).
    map["a"] = "new-claude-uuid";
    expect(typeof map["a"]).toBe("string");
    expect(map["a"]).toBe("new-claude-uuid");
  });

  it("adding a Codex key does not rewrite existing legacy strings", () => {
    const map: Record<string, StoredValue> = { a: "id-a", b: "id-b" };
    // Codex path: assign a record for ONLY the new key.
    map["c"] = { provider: "codex", sessionId: null, lastStartedAt: 123 };
    expect(typeof map["a"]).toBe("string");
    expect(typeof map["b"]).toBe("string");
    expect(map["a"]).toBe("id-a");
    expect(map["b"]).toBe("id-b");
    expect(isSessionRecord(map["c"])).toBe(true);
    // Round-trip through JSON (as saveSessionMap/loadSessionMap would) is stable.
    const roundTripped = JSON.parse(JSON.stringify(map)) as Record<string, StoredValue>;
    expect(roundTripped["a"]).toBe("id-a");
    expect(roundTripped["b"]).toBe("id-b");
    expect(resumeIdFrom(roundTripped["c"])).toBeNull();
  });
});

describe("carrySessionAcrossRename (rename preserves stored shape)", () => {
  it("preserves a Codex provider-aware record (does not flatten to the fallback UUID)", () => {
    // Regression for PR #260: a fresh cartoon _new_* Codex session stores
    // {provider:"codex", sessionId:null}; renaming must keep that record so a
    // later resume builds `codex resume --last`, not `codex resume <fallback-uuid>`.
    const map: Record<string, StoredValue> = {
      "_new_123": { provider: "codex", sessionId: null, lastStartedAt: 111 },
    };
    carrySessionAcrossRename(map, "_new_123", "my-toon", "fallback-pty-uuid");
    expect(map["_new_123"]).toBeUndefined();
    expect(map["my-toon"]).toEqual({ provider: "codex", sessionId: null, lastStartedAt: 111 });
    expect(map["my-toon"]).not.toBe("fallback-pty-uuid");
    expect(resumeIdFrom(map["my-toon"])).toBe(null);
  });

  it("preserves a Codex record with a real session id", () => {
    const map: Record<string, StoredValue> = {
      "_new_9": { provider: "codex", sessionId: "cdx-real", lastStartedAt: 5 },
    };
    carrySessionAcrossRename(map, "_new_9", "toon2", "fallback");
    expect(map["toon2"]).toEqual({ provider: "codex", sessionId: "cdx-real", lastStartedAt: 5 });
    expect(resumeIdFrom(map["toon2"])).toBe("cdx-real");
  });

  it("preserves a legacy Claude bare-string entry", () => {
    const map: Record<string, StoredValue> = { "_new_7": "claude-uuid" };
    carrySessionAcrossRename(map, "_new_7", "novel", "fallback");
    expect(map["_new_7"]).toBeUndefined();
    expect(map["novel"]).toBe("claude-uuid");
  });

  it("falls back to the live PTY session id only when no stored entry exists", () => {
    const map: Record<string, StoredValue> = {};
    carrySessionAcrossRename(map, "_new_x", "story", "live-uuid");
    expect(map["story"]).toBe("live-uuid");
  });

  it("leaves unrelated entries untouched", () => {
    const map: Record<string, StoredValue> = {
      "_new_1": { provider: "codex", sessionId: null },
      "other": "keep-me",
    };
    carrySessionAcrossRename(map, "_new_1", "renamed", "fb");
    expect(map["other"]).toBe("keep-me");
    expect(map["renamed"]).toEqual({ provider: "codex", sessionId: null });
  });
});

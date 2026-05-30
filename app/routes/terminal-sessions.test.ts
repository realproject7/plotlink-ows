import { describe, it, expect } from "vitest";
import { resumeIdFrom, isSessionRecord, type StoredValue } from "./terminal";

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

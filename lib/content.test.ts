import { describe, expect, it } from "vitest";
import {
  hashContent,
  validateContentLength,
  MIN_CONTENT_LENGTH,
  MAX_CONTENT_LENGTH,
} from "./content";

// ---------------------------------------------------------------------------
// hashContent
// ---------------------------------------------------------------------------

describe("hashContent", () => {
  it("returns a 0x-prefixed 66-char hex string", () => {
    const hash = hashContent("hello");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const a = hashContent("test content");
    const b = hashContent("test content");
    expect(a).toBe(b);
  });

  it("produces different hashes for different content", () => {
    expect(hashContent("aaa")).not.toBe(hashContent("bbb"));
  });

  it("handles Korean text", () => {
    const hash = hashContent("안녕하세요 세계");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("handles emoji", () => {
    const hash = hashContent("🔥🚀✨");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// validateContentLength
// ---------------------------------------------------------------------------

describe("validateContentLength", () => {
  const makeString = (char: string, count: number) =>
    Array.from({ length: count }, () => char).join("");

  it("rejects content shorter than 500 characters", () => {
    const result = validateContentLength(makeString("a", 499));
    expect(result.valid).toBe(false);
    expect(result.charCount).toBe(499);
  });

  it("accepts content at exactly 500 characters", () => {
    const result = validateContentLength(makeString("a", 500));
    expect(result.valid).toBe(true);
    expect(result.charCount).toBe(500);
  });

  it("accepts content at exactly 10,000 characters", () => {
    const result = validateContentLength(makeString("a", 10_000));
    expect(result.valid).toBe(true);
    expect(result.charCount).toBe(10_000);
  });

  it("rejects content longer than 10,000 characters", () => {
    const result = validateContentLength(makeString("a", 10_001));
    expect(result.valid).toBe(false);
    expect(result.charCount).toBe(10_001);
  });

  // Unicode correctness — Korean syllables are single characters
  it("counts Korean syllables as single characters", () => {
    // 가 = U+AC00, 3 bytes in UTF-8 but 1 character
    const korean = makeString("가", 500);
    const result = validateContentLength(korean);
    expect(result.charCount).toBe(500);
    expect(result.valid).toBe(true);
  });

  // Emoji (many are multi-byte or surrogate pairs)
  it("counts emoji as single characters", () => {
    // 🔥 = U+1F525, 4 bytes in UTF-8, 2 UTF-16 code units, but 1 character
    const emoji = makeString("🔥", 500);
    const result = validateContentLength(emoji);
    expect(result.charCount).toBe(500);
    expect(result.valid).toBe(true);
  });

  // Mixed content
  it("correctly counts mixed Korean, emoji, and ASCII", () => {
    // 3 Korean + 2 emoji + 5 ASCII = 10 characters
    const mixed = "안녕하🔥🚀hello";
    const result = validateContentLength(mixed);
    expect(result.charCount).toBe(10);
    expect(result.valid).toBe(false); // under 500
  });

  it("exports MIN and MAX constants", () => {
    expect(MIN_CONTENT_LENGTH).toBe(500);
    expect(MAX_CONTENT_LENGTH).toBe(10_000);
  });
});

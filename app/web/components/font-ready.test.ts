import { describe, it, expect, vi, afterEach } from "vitest";
import { ensureFontsReady } from "./export-cut";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureFontsReady", () => {
  it("returns ready when document.fonts is unavailable (SSR/Node)", async () => {
    const original = (globalThis as { document?: unknown }).document;
    // Simulate no font API
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true });
    try {
      const result = await ensureFontsReady(["Noto Sans"]);
      expect(result.ready).toBe(true);
      expect(result.missing).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, "document", { value: original, configurable: true });
    }
  });

  it("returns ready when all fonts load and check passes", async () => {
    const fakeFonts = {
      load: vi.fn().mockResolvedValue([]),
      check: vi.fn().mockReturnValue(true),
    };
    Object.defineProperty(document, "fonts", { value: fakeFonts, configurable: true });

    const result = await ensureFontsReady(["Noto Sans", "Bangers"]);
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
    expect(fakeFonts.load).toHaveBeenCalledTimes(2);
  });

  it("reports missing fonts when check fails", async () => {
    const fakeFonts = {
      load: vi.fn().mockResolvedValue([]),
      check: vi.fn().mockReturnValue(false),
    };
    Object.defineProperty(document, "fonts", { value: fakeFonts, configurable: true });

    const result = await ensureFontsReady(["Noto Sans KR"]);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("Noto Sans KR");
  });

  it("reports missing fonts when load throws", async () => {
    const fakeFonts = {
      load: vi.fn().mockRejectedValue(new Error("network blocked")),
      check: vi.fn().mockReturnValue(false),
    };
    Object.defineProperty(document, "fonts", { value: fakeFonts, configurable: true });

    const result = await ensureFontsReady(["Noto Sans JP"]);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("Noto Sans JP");
  });
});

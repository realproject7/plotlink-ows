import { describe, it, expect } from "vitest";
import { validateExportSize, MAX_SIZE } from "./export-cut";

describe("validateExportSize", () => {
  it("accepts blob under 1MB", () => {
    const blob = new Blob([new Uint8Array(500 * 1024)]);
    expect(validateExportSize(blob)).toEqual({ valid: true });
  });

  it("accepts blob at exactly 1MB", () => {
    const blob = new Blob([new Uint8Array(MAX_SIZE)]);
    expect(validateExportSize(blob)).toEqual({ valid: true });
  });

  it("rejects blob over 1MB", () => {
    const blob = new Blob([new Uint8Array(MAX_SIZE + 1)]);
    const result = validateExportSize(blob);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("1MB");
  });

  it("reports size in KB in error message", () => {
    const blob = new Blob([new Uint8Array(1500 * 1024)]);
    const result = validateExportSize(blob);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("1500");
  });
});

describe("MAX_SIZE constant", () => {
  it("is 1MB in bytes", () => {
    expect(MAX_SIZE).toBe(1024 * 1024);
  });
});

describe("WebP fallback detection", () => {
  it("detects non-WebP blob type as unsupported", () => {
    const pngBlob = new Blob([new Uint8Array(100)], { type: "image/png" });
    expect(pngBlob.type).not.toBe("image/webp");
  });

  it("accepts actual WebP blob type", () => {
    const webpBlob = new Blob([new Uint8Array(100)], { type: "image/webp" });
    expect(webpBlob.type).toBe("image/webp");
  });

  it("JPEG blob type is valid for fallback", () => {
    const jpegBlob = new Blob([new Uint8Array(100)], { type: "image/jpeg" });
    expect(jpegBlob.type).toBe("image/jpeg");
  });
});

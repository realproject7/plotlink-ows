// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { imageAssetIssue, isValidImageAsset } from "./image-asset-validate";

// Magic-byte fixtures (mirror the upload/sync byte-sniff tests).
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("imageAssetIssue / isValidImageAsset (#302)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-validate-"));
    fs.mkdirSync(path.join(dir, "assets", "plot-01"), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function write(rel: string, bytes: Uint8Array) {
    fs.writeFileSync(path.join(dir, rel), Buffer.from(bytes));
  }

  it("returns null for a valid WebP and a valid JPEG", () => {
    write("assets/plot-01/cut-01-clean.webp", WEBP);
    write("assets/plot-01/cut-02-clean.jpg", JPEG);
    expect(imageAssetIssue(dir, "assets/plot-01/cut-01-clean.webp")).toBeNull();
    expect(isValidImageAsset(dir, "assets/plot-01/cut-01-clean.webp")).toBe(true);
    expect(imageAssetIssue(dir, "assets/plot-01/cut-02-clean.jpg")).toBeNull();
  });

  it('reports "missing" for an absent file', () => {
    expect(imageAssetIssue(dir, "assets/plot-01/cut-01-clean.webp")).toBe("missing");
    expect(isValidImageAsset(dir, "assets/plot-01/cut-01-clean.webp")).toBe(false);
  });

  it("reports an unsupported extension", () => {
    write("assets/plot-01/cut-01-clean.png", PNG);
    expect(imageAssetIssue(dir, "assets/plot-01/cut-01-clean.png")).toBe("Unsupported extension .png");
  });

  it("reports a content/extension mismatch (PNG bytes named .webp)", () => {
    write("assets/plot-01/cut-01-clean.webp", PNG);
    expect(imageAssetIssue(dir, "assets/plot-01/cut-01-clean.webp")).toBe("content does not match .webp extension");
  });

  it("reports an oversize file", () => {
    const big = new Uint8Array(1024 * 1024 + 10);
    big.set(WEBP, 0);
    write("assets/plot-01/cut-01-clean.webp", big);
    expect(imageAssetIssue(dir, "assets/plot-01/cut-01-clean.webp")).toBe("File must be under 1MB");
  });

  it('reports "missing" for a directory at the path (not a regular file)', () => {
    fs.mkdirSync(path.join(dir, "assets/plot-01/cut-01-clean.webp"));
    expect(imageAssetIssue(dir, "assets/plot-01/cut-01-clean.webp")).toBe("missing");
  });
});

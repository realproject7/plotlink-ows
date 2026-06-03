// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  encodeCodexToken,
  decodeCodexToken,
  resolveCodexImagePath,
  listCodexImages,
  CODEX_LIST_LIMIT,
} from "./codex-images";

// #403: the Codex generated-image cache handoff exposes a hidden cache to the OWS
// UI. These cover the two traversal guards (token decode + resolved-boundary) and
// the read-only listing so a crafted token can never escape the cache root.
describe("codex cache token safety (#403)", () => {
  it("round-trips a normal relative path through encode/decode", () => {
    const rel = path.join("sub", "ig_abc.png");
    expect(decodeCodexToken(encodeCodexToken(rel))).toBe(rel);
  });

  it("rejects tokens that are empty, NUL-bearing, absolute, or contain a traversal segment", () => {
    expect(decodeCodexToken("")).toBeNull();
    expect(decodeCodexToken(encodeCodexToken("a\0b.png"))).toBeNull();
    expect(decodeCodexToken(encodeCodexToken("/etc/passwd"))).toBeNull();
    expect(decodeCodexToken(encodeCodexToken("../../etc/passwd"))).toBeNull();
    expect(decodeCodexToken(encodeCodexToken("sub/../../escape.png"))).toBeNull();
  });

  it("resolves a safe token to an absolute path inside the root", () => {
    const root = path.join(os.tmpdir(), "codex-root");
    const out = resolveCodexImagePath(root, encodeCodexToken("a/b.png"));
    expect(out).not.toBeNull();
    expect(out!.abs).toBe(path.resolve(root, "a/b.png"));
    expect(out!.relPath).toBe(path.join("a", "b.png"));
  });

  it("refuses a token resolving to the root dir itself (not a file)", () => {
    const root = path.join(os.tmpdir(), "codex-root");
    expect(resolveCodexImagePath(root, encodeCodexToken("."))).toBeNull();
  });

  it("refuses tokens that escape the root but allows unusual in-root file names", () => {
    const root = path.join(os.tmpdir(), "codex-root");
    expect(resolveCodexImagePath(root, encodeCodexToken("../../escape.png"))).toBeNull();
    expect(resolveCodexImagePath(root, encodeCodexToken("/escape.png"))).toBeNull();
    // The guard blocks escape, not odd file names: an in-root name still resolves.
    expect(resolveCodexImagePath(root, encodeCodexToken("weird name.png"))).not.toBeNull();
  });
});

describe("codex cache listing (#403)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cache-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function write(rel: string, mtimeMs?: number) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (mtimeMs != null) fs.utimesSync(abs, mtimeMs / 1000, mtimeMs / 1000);
  }

  it("returns an empty list for a missing cache root", () => {
    expect(listCodexImages(path.join(tmp, "does-not-exist"))).toEqual([]);
  });

  it("lists image files recursively and ignores non-image files", () => {
    write("ig_one.png");
    write("nested/ig_two.webp");
    write("notes.txt");
    write("nested/data.json");
    const out = listCodexImages(tmp);
    expect(out.map((e) => e.name).sort()).toEqual(["ig_one.png", "ig_two.webp"]);
    // Each entry round-trips to a resolvable, in-root path.
    for (const e of out) {
      expect(resolveCodexImagePath(tmp, e.token)).not.toBeNull();
    }
  });

  it("orders newest-first and honors the limit", () => {
    write("old.png", 1_000_000);
    write("mid.png", 2_000_000);
    write("new.png", 3_000_000);
    const out = listCodexImages(tmp, 2);
    expect(out.map((e) => e.name)).toEqual(["new.png", "mid.png"]);
    expect(out.length).toBeLessThanOrEqual(CODEX_LIST_LIMIT);
  });
});

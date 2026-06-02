import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  createDefaultCut,
  createCutsFile,
  readCutsFile,
  writeCutsFile,
  validateCutsFile,
  SHOT_TYPES,
} from "./cuts";

describe("createDefaultCut", () => {
  it("returns correct defaults", () => {
    const cut = createDefaultCut(1, "plot-01");
    expect(cut.id).toBe(1);
    expect(cut.shotType).toBe("medium");
    expect(cut.description).toBe("");
    expect(cut.characters).toEqual([]);
    expect(cut.dialogue).toEqual([]);
    expect(cut.narration).toBe("");
    expect(cut.sfx).toBe("");
    expect(cut.cleanImagePath).toBeNull();
    expect(cut.finalImagePath).toBeNull();
    expect(cut.exportedAt).toBeNull();
    expect(cut.uploadedCid).toBeNull();
    expect(cut.uploadedUrl).toBeNull();
  });
});

describe("createCutsFile", () => {
  it("creates file with correct version and plotFile", () => {
    const cf = createCutsFile("plot-01");
    expect(cf.version).toBe(1);
    expect(cf.plotFile).toBe("plot-01");
    expect(cf.cuts).toHaveLength(1);
    expect(cf.cuts[0].id).toBe(1);
  });

  it("creates file with custom cut count", () => {
    const cf = createCutsFile("plot-03", 5);
    expect(cf.cuts).toHaveLength(5);
    expect(cf.cuts[0].id).toBe(1);
    expect(cf.cuts[4].id).toBe(5);
  });
});

describe("readCutsFile / writeCutsFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-cuts-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for missing file", () => {
    expect(readCutsFile(tmpDir, "plot-01")).toBeNull();
  });

  it("roundtrips write then read", () => {
    const original = createCutsFile("plot-01", 3);
    writeCutsFile(tmpDir, "plot-01", original);
    const loaded = readCutsFile(tmpDir, "plot-01");
    expect(loaded).toEqual(original);
  });

  it("throws on malformed JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "plot-01.cuts.json"), "not json");
    expect(() => readCutsFile(tmpDir, "plot-01")).toThrow("invalid JSON");
  });

  it("throws on invalid schema", () => {
    fs.writeFileSync(path.join(tmpDir, "plot-01.cuts.json"), JSON.stringify({ version: 2 }));
    expect(() => readCutsFile(tmpDir, "plot-01")).toThrow("invalid");
  });

  it("maintains cut ordering after roundtrip", () => {
    const cf = createCutsFile("plot-01", 4);
    cf.cuts[0].description = "First";
    cf.cuts[3].description = "Last";
    writeCutsFile(tmpDir, "plot-01", cf);
    const loaded = readCutsFile(tmpDir, "plot-01")!;
    expect(loaded.cuts[0].id).toBe(1);
    expect(loaded.cuts[0].description).toBe("First");
    expect(loaded.cuts[3].id).toBe(4);
    expect(loaded.cuts[3].description).toBe("Last");
  });
});

describe("image cuts and blank narration cuts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-cuts-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists image cut with paths set", () => {
    const cf = createCutsFile("plot-01");
    cf.cuts[0].cleanImagePath = "assets/plot-01/cut-01-clean.webp";
    cf.cuts[0].finalImagePath = "assets/plot-01/cut-01-final.webp";
    cf.cuts[0].description = "Wide shot of the city";
    cf.cuts[0].shotType = "wide";

    writeCutsFile(tmpDir, "plot-01", cf);
    const loaded = readCutsFile(tmpDir, "plot-01")!;
    expect(loaded.cuts[0].cleanImagePath).toBe("assets/plot-01/cut-01-clean.webp");
    expect(loaded.cuts[0].finalImagePath).toBe("assets/plot-01/cut-01-final.webp");
    expect(loaded.cuts[0].shotType).toBe("wide");
  });

  it("supports blank narration cut (no images)", () => {
    const cf = createCutsFile("plot-01", 2);
    cf.cuts[1].cleanImagePath = null;
    cf.cuts[1].narration = "Time passed slowly in the old town.";
    cf.cuts[1].dialogue = [{ speaker: "Mira", text: "Where did everyone go?" }];

    writeCutsFile(tmpDir, "plot-01", cf);
    const loaded = readCutsFile(tmpDir, "plot-01")!;
    expect(loaded.cuts[1].cleanImagePath).toBeNull();
    expect(loaded.cuts[1].narration).toBe("Time passed slowly in the old town.");
    expect(loaded.cuts[1].dialogue).toEqual([{ speaker: "Mira", text: "Where did everyone go?" }]);
  });
});

describe("export and upload status fields", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-cuts-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists export and upload status", () => {
    const cf = createCutsFile("plot-01");
    cf.cuts[0].exportedAt = "2026-05-27T10:00:00Z";
    cf.cuts[0].uploadedCid = "QmTestCid123";
    cf.cuts[0].uploadedUrl = "https://ipfs.example.com/QmTestCid123";

    writeCutsFile(tmpDir, "plot-01", cf);
    const loaded = readCutsFile(tmpDir, "plot-01")!;
    expect(loaded.cuts[0].exportedAt).toBe("2026-05-27T10:00:00Z");
    expect(loaded.cuts[0].uploadedCid).toBe("QmTestCid123");
    expect(loaded.cuts[0].uploadedUrl).toBe("https://ipfs.example.com/QmTestCid123");
  });
});

describe("validateCutsFile", () => {
  it("accepts valid data", () => {
    const cf = createCutsFile("plot-01", 2);
    expect(validateCutsFile(cf)).toEqual({ valid: true });
  });

  it("rejects non-object", () => {
    expect(validateCutsFile("string")).toEqual({ valid: false, error: "Must be a JSON object" });
    expect(validateCutsFile(null)).toEqual({ valid: false, error: "Must be a JSON object" });
    expect(validateCutsFile([])).toEqual({ valid: false, error: "Must be a JSON object" });
  });

  it("rejects missing version", () => {
    expect(validateCutsFile({ plotFile: "plot-01", cuts: [] })).toEqual({
      valid: false,
      error: "Unsupported version (expected 1)",
    });
  });

  it("rejects wrong version", () => {
    expect(validateCutsFile({ version: 2, plotFile: "plot-01", cuts: [] })).toEqual({
      valid: false,
      error: "Unsupported version (expected 1)",
    });
  });

  it("rejects missing plotFile", () => {
    expect(validateCutsFile({ version: 1, cuts: [] })).toEqual({
      valid: false,
      error: "Missing or invalid plotFile",
    });
  });

  it("rejects non-array cuts", () => {
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: "not array" })).toEqual({
      valid: false,
      error: "cuts must be an array",
    });
  });

  // #347: optional top-level episode title.
  it("accepts an optional string title", () => {
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", title: "First Rain", cuts: [] })).toEqual({ valid: true });
  });

  it("rejects a non-string title", () => {
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", title: 5, cuts: [] })).toEqual({
      valid: false,
      error: "title must be a string",
    });
  });

  it("rejects cut without numeric id", () => {
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: [{ id: "bad" }] })).toEqual({
      valid: false,
      error: "Cut 0 missing numeric id",
    });
  });

  it("rejects cut with invalid shotType", () => {
    const cut = { ...createDefaultCut(1, "plot-01"), shotType: "ultra-wide" };
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: [cut] })).toEqual({
      valid: false,
      error: "Cut 0 has invalid shotType",
    });
  });

  it("rejects cut with non-string description", () => {
    const cut = { ...createDefaultCut(1, "plot-01"), description: 42 };
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: [cut] })).toEqual({
      valid: false,
      error: "Cut 0 missing description",
    });
  });

  it("rejects cut with non-array characters", () => {
    const cut = { ...createDefaultCut(1, "plot-01"), characters: "Mira" };
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: [cut] })).toEqual({
      valid: false,
      error: "Cut 0 characters must be an array",
    });
  });

  it("rejects cut with non-string character entry", () => {
    const cut = { ...createDefaultCut(1, "plot-01"), characters: [123] };
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: [cut] })).toEqual({
      valid: false,
      error: "Cut 0 characters[0] must be a string",
    });
  });

  it("rejects cut with malformed dialogue entry", () => {
    const cut = { ...createDefaultCut(1, "plot-01"), dialogue: [{ speaker: 123, text: "hi" }] };
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: [cut] })).toEqual({
      valid: false,
      error: "Cut 0 dialogue[0] must have speaker and text strings",
    });
  });

  it("rejects cut with non-string narration", () => {
    const cut = { ...createDefaultCut(1, "plot-01"), narration: null };
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: [cut] })).toEqual({
      valid: false,
      error: "Cut 0 missing narration",
    });
  });

  it("rejects cut with invalid nullable field type", () => {
    const cut = { ...createDefaultCut(1, "plot-01"), cleanImagePath: 42 };
    expect(validateCutsFile({ version: 1, plotFile: "plot-01", cuts: [cut] })).toEqual({
      valid: false,
      error: "Cut 0 cleanImagePath must be a string or null",
    });
  });

  it("exports SHOT_TYPES constant", () => {
    expect(SHOT_TYPES).toEqual(["wide", "medium", "close-up", "extreme-close-up"]);
  });
});

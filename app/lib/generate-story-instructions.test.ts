import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { generateStoryInstructions, writeStoryInstructions } from "./generate-story-instructions";

describe("generateStoryInstructions", () => {
  it("fiction output contains expected sections", () => {
    const out = generateStoryInstructions("fiction");
    expect(out).toContain("structure.md");
    expect(out).toContain("genesis.md");
    expect(out).toContain("plot-");
    expect(out).toContain("Core Concept");
    expect(out).toContain("Main Characters");
    expect(out).toContain("Story Arc");
    expect(out).toContain("10,000 characters");
  });

  it("fiction output does not contain cartoon terms", () => {
    const out = generateStoryInstructions("fiction");
    expect(out).not.toContain("cuts.json");
    expect(out).not.toContain("clean image");
    expect(out).not.toContain("lettering");
    expect(out).not.toContain("Character Bible");
    expect(out).not.toContain("speech bubble");
  });

  it("cartoon output contains expected sections", () => {
    const out = generateStoryInstructions("cartoon");
    expect(out).toContain("cuts.json");
    expect(out).toContain("Character Bible");
    expect(out).toContain("Visual Style Guide");
    expect(out).toContain("Lettering");
    expect(out).toContain("Bubble");
    expect(out).toContain("assets/");
    expect(out).toContain("cut-XX-clean");
    expect(out).toContain("10K characters");
  });

  it("cartoon output prohibits baking text into images", () => {
    const out = generateStoryInstructions("cartoon");
    expect(out).toContain("Do NOT bake dialogue");
    expect(out).toContain("No speech bubbles");
    expect(out).toContain("No text overlays");
  });

  it("fiction and cartoon outputs are different", () => {
    const fiction = generateStoryInstructions("fiction");
    const cartoon = generateStoryInstructions("cartoon");
    expect(fiction).not.toBe(cartoon);
  });

  it("cartoon output includes a valid cuts.json example matching the real schema", () => {
    const out = generateStoryInstructions("cartoon");
    expect(out).toContain('"version": 1');
    expect(out).toContain('"plotFile": "plot-01"');
    expect(out).toContain('"shotType"');
    expect(out).toContain('"description"');
    expect(out).toContain('"speaker"');
    expect(out).toContain('"text"');
    expect(out).toContain('"narration"');
    expect(out).toContain('"cleanImagePath"');
    expect(out).toContain('"finalImagePath"');
    expect(out).toContain('"overlays": []');
  });

  it("cartoon cuts example parses and passes validateCutsFile", async () => {
    const { validateCutsFile } = await import("./cuts");
    const out = generateStoryInstructions("cartoon");
    const match = out.match(/```json\n([\s\S]*?)\n```/);
    expect(match).toBeTruthy();
    const parsed = JSON.parse(match![1]);
    expect(validateCutsFile(parsed)).toEqual({ valid: true });
  });

  it("cartoon output guides against invalid pilot schema forms", () => {
    const out = generateStoryInstructions("cartoon");
    // The guidance table names the wrong forms so agents avoid them
    expect(out).toContain("$schema");
    expect(out).toContain('"c01"');
    expect(out).toContain("shot");
    expect(out).toContain("image.prompt");
    expect(out).toContain("dialogue[].line");
    expect(out).toContain("image.clean");
    // And the document must NOT present them as the schema to use
    expect(out).toContain("Do NOT invent alternate");
  });
});

describe("writeStoryInstructions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plotlink-instructions-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates CLAUDE.md with correct marker", () => {
    writeStoryInstructions(tmpDir, "cartoon");
    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content.split("\n")[0]).toBe("<!-- plotlink-ows:story-instructions:cartoon -->");
    expect(content).toContain("Character Bible");
  });

  it("skips write when marker matches", () => {
    writeStoryInstructions(tmpDir, "fiction");
    const content1 = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");

    writeStoryInstructions(tmpDir, "fiction");
    const content2 = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");

    expect(content1).toBe(content2);
  });

  it("regenerates when contentType changes", () => {
    writeStoryInstructions(tmpDir, "fiction");
    const fictionContent = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(fictionContent).toContain("story-instructions:fiction");
    expect(fictionContent).not.toContain("cuts.json");

    writeStoryInstructions(tmpDir, "cartoon");
    const cartoonContent = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(cartoonContent).toContain("story-instructions:cartoon");
    expect(cartoonContent).toContain("cuts.json");
  });

  it("preserves user-owned unmarked CLAUDE.md", () => {
    const userContent = "# My custom writing notes\n\nDo not overwrite this.\n";
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), userContent);

    writeStoryInstructions(tmpDir, "cartoon");

    const after = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(after).toBe(userContent);
  });

  it("fiction CLAUDE.md does not contain API endpoint tables", () => {
    writeStoryInstructions(tmpDir, "fiction");
    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content).not.toContain("/api/");
  });
});

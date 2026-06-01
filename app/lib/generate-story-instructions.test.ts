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

  it("Claude/default cartoon output explains the clean-image prompt handoff and never claims it created files", () => {
    // Default provider is Claude (matches the absent⇒Claude default; see #268).
    const out = generateStoryInstructions("cartoon");
    // Claude must not claim a clean image file was created when it only made a prompt
    expect(out).toContain("Do NOT claim that");
    expect(out).toContain("cut-XX-clean.webp");
    // It must instruct preparing the prompt and external generation + upload/import
    expect(out).toContain("PREPARE THE EXACT CLEAN-IMAGE PROMPT");
    expect(out).toContain("generate it externally");
    expect(out).toContain("upload/import");
    expect(out).toContain("Copy prompt");
    expect(out).toContain("Upload clean image");
    // After a real file exists, cleanImagePath is updated via OWS/cuts API
    expect(out).toContain("cleanImagePath");
    // Default == explicit "claude" branch
    expect(out).toBe(generateStoryInstructions("cartoon", "claude"));
  });

  it("Codex cartoon output leads with the create-the-file contract, not a can't-create-files warning", () => {
    const out = generateStoryInstructions("cartoon", "codex");
    // PRIMARY instruction: create the real file at the canonical path and verify it
    expect(out).toContain("CREATE THE REAL CLEAN-IMAGE FILE");
    expect(out).toContain("cut-XX-clean.webp");
    expect(out).toContain("under 1MB");
    expect(out).toContain("VERIFY the file actually exists");
    expect(out).toContain("Do NOT claim the image was generated unless the file actually exists");
    expect(out).toContain("Sync clean images");
    // Acceptance (#274): Codex must NOT be told it cannot/does not create image files
    expect(out).not.toContain("You cannot create image files yourself");
    expect(out).not.toContain("do **not** generate image files");
    // The manual prompt+import path survives only as an explicit fallback
    expect(out).toContain("Fallback: hand the prompt to the writer");
    expect(out).toContain("Copy prompt");
    expect(out).toContain("Upload clean image");
  });

  it("Codex and Claude cartoon outputs differ; the create-file contract is primary only for Codex", () => {
    const codex = generateStoryInstructions("cartoon", "codex");
    const claude = generateStoryInstructions("cartoon", "claude");
    expect(codex).not.toBe(claude);
    // The shared clean-image-first rules are present in both
    expect(codex).toContain("Do NOT bake dialogue");
    expect(claude).toContain("Do NOT bake dialogue");
    // The Codex create-file primary heading appears only in the Codex variant
    expect(codex).toContain("Create the clean image file directly — your primary job");
    expect(claude).not.toContain("Create the clean image file directly — your primary job");
    // The Claude can't-create-files handoff is primary only in the Claude variant
    expect(claude).toContain("You cannot create image files yourself");
    expect(codex).not.toContain("You cannot create image files yourself");
    // Episode workflow step 2 reflects the provider's primary path
    expect(codex).toContain("Create the real clean-image file for each cut");
    expect(claude).toContain("**Prompt & import**");
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

  it("cartoon output instructs OWS-generated publish markdown, not hand-written", () => {
    const out = generateStoryInstructions("cartoon");
    expect(out).toContain("Do NOT hand-write plot-NN.md");
    expect(out).toContain("OWS generates the publish");
    expect(out).toContain("ows:cartoon-cut cut-001 start");
    expect(out).toContain("awaiting upload");
  });

  it("cartoon output requires every publishable cut to be uploaded (incl. narration)", () => {
    const out = generateStoryInstructions("cartoon");
    expect(out).toContain("Every publishable cut must become a final uploaded image");
    // Must NOT tell agents that narration-only cuts can stay image-less for publish
    expect(out).not.toContain("For a narration-only cut with no image, leave");
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

  it("creates CLAUDE.md with provider-aware cartoon marker (default Claude)", () => {
    writeStoryInstructions(tmpDir, "cartoon");
    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content.split("\n")[0]).toBe("<!-- plotlink-ows:story-instructions:cartoon:claude -->");
    expect(content).toContain("Character Bible");
  });

  it("creates a Codex cartoon CLAUDE.md with the codex marker and create-file contract", () => {
    writeStoryInstructions(tmpDir, "cartoon", "codex");
    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content.split("\n")[0]).toBe("<!-- plotlink-ows:story-instructions:cartoon:codex -->");
    expect(content).toContain("CREATE THE REAL CLEAN-IMAGE FILE");
    expect(content).not.toContain("You cannot create image files yourself");
  });

  it("regenerates when the cartoon provider changes (Claude → Codex repair)", () => {
    writeStoryInstructions(tmpDir, "cartoon", "claude");
    const before = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(before).toContain("You cannot create image files yourself");

    writeStoryInstructions(tmpDir, "cartoon", "codex");
    const after = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(after.split("\n")[0]).toBe("<!-- plotlink-ows:story-instructions:cartoon:codex -->");
    expect(after).toContain("CREATE THE REAL CLEAN-IMAGE FILE");
    expect(after).not.toContain("You cannot create image files yourself");
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

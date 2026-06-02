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

  // #297: deterministic asset handoff — Codex must use OWS flows, never assume
  // local image tooling (the pilot stalled trying magick/identify/sharp/Playwright).
  it("cartoon (codex) output forbids ad-hoc local image tools and names them", () => {
    const out = generateStoryInstructions("cartoon", "codex");
    expect(out).toContain("Asset Tooling");
    expect(out).toContain("magick");
    expect(out).toContain("identify");
    expect(out).toContain("sharp");
    expect(out).toContain("Playwright");
    expect(out).toContain("do NOT post-process");
  });

  it("cartoon output routes export/lettering/upload through supported OWS flows", () => {
    const out = generateStoryInstructions("cartoon", "codex");
    expect(out).toContain("Sync clean images");
    expect(out).toContain("OWS lettering editor");
    expect(out).toContain("Upload & Generate");
    // The deterministic asset targets the agent vs. OWS/editor own.
    expect(out).toContain("assets/cover.webp");
    expect(out).toContain("cut-XX-clean.webp");
    expect(out).toContain("cut-XX-final.webp");
    // No agent-side image tools are required.
    expect(out).toContain("No agent-side image tools are required");
  });

  it("cartoon (claude/default) output also carries the no-shell-tools handoff", () => {
    const out = generateStoryInstructions("cartoon");
    expect(out).toContain("Asset Tooling");
    expect(out).toContain("magick");
    expect(out).toContain("OWS lettering editor");
  });

  it("fiction output is unaffected by the deterministic asset-tooling guidance", () => {
    const out = generateStoryInstructions("fiction");
    expect(out).not.toContain("Asset Tooling");
    expect(out).not.toContain("magick");
    expect(out).not.toContain("Sync clean images");
  });

  // #309: overlays must use the real OWS schema (numeric geometry), never a
  // semantic `position` string that renders nothing and exports unlettered.
  it("cartoon output documents the real overlay schema and forbids semantic positions", () => {
    const out = generateStoryInstructions("cartoon", "codex");
    expect(out).toContain("Overlay schema");
    // Required numeric geometry fields named.
    for (const f of ["`id`", "`type`", "`x`", "`y`", "`width`", "`height`", "`text`", "`tailAnchor`"]) {
      expect(out).toContain(f);
    }
    // Leave-empty guidance + explicit ban on the `position` string form.
    expect(out).toContain("Leave `overlays` empty");
    expect(out).toContain('semantic `position` string');
    expect(out).toContain("There is NO `position` field");
  });

  // #311: Codex must post an explicit completion line and stop, with no
  // open-ended visual-inspection loop that leaves the session stuck Working.
  it("cartoon (codex) output requires an explicit completion line and forbids an open-ended inspection loop", () => {
    const flat = generateStoryInstructions("cartoon", "codex").replace(/\s+/g, " ");
    expect(flat).toContain("Finishing the task: post a completion line and STOP");
    expect(flat).toContain("CARTOON ASSETS COMPLETE");
    expect(flat).toContain("CARTOON ASSETS PARTIAL");
    // No open-ended re-inspection; stop after the line.
    expect(flat).toContain('Do NOT start an open-ended "let me visually re-inspect the images" loop');
    expect(flat).toContain("stuck in a long-running `Working` state");
    expect(flat).toContain("return to the idle prompt");
  });

  it("the #311 completion-line guidance is Codex-only (absent from claude/fiction)", () => {
    const claude = generateStoryInstructions("cartoon", "claude");
    const fiction = generateStoryInstructions("fiction");
    for (const phrase of ["CARTOON ASSETS COMPLETE", "Finishing the task: post a completion line and STOP"]) {
      expect(claude).not.toContain(phrase);
      expect(fiction).not.toContain(phrase);
    }
  });

  it("the overlay schema guidance is present for both Codex and Claude cartoon (provider-neutral)", () => {
    expect(generateStoryInstructions("cartoon", "codex")).toContain("Overlay schema");
    expect(generateStoryInstructions("cartoon", "claude")).toContain("Overlay schema");
    // ...but not in fiction.
    expect(generateStoryInstructions("fiction")).not.toContain("Overlay schema");
  });

  // #307: Codex cartoon image generation must not silently hang — confirm
  // capability, checkpoint, and fail visibly instead of an indefinite Working
  // state. Match against a whitespace-normalized copy so line-wrapping of the
  // template literal can change without breaking these assertions.
  it("cartoon (codex) output carries the image-generation no-hang guardrail", () => {
    const out = generateStoryInstructions("cartoon", "codex");
    const flat = out.replace(/\s+/g, " ");
    // Capability is not assumed — it must be confirmed.
    expect(flat).toContain("NOT guaranteed to be available");
    expect(flat).toContain("Confirm the capability");
    // One bounded attempt, never an indefinite Working state / retry loop.
    expect(flat).toContain("ONE bounded attempt");
    expect(flat).toContain("never retry image generation in a loop");
    expect(flat).toContain("indefinite `Working` state");
    // Fail visibly with an explicit blocker line, then fall back cleanly.
    expect(flat).toContain("Fail visibly, never silently");
    expect(flat).toContain("Image generation is unavailable in this Codex session; switching to the prompt-and-import handoff.");
    expect(flat).toContain("An unreported hang is a bug");
    // Progress checkpoints so the writer never just sees a spinner.
    expect(flat).toContain("Report progress per file");
    expect(flat).toContain("Checkpoint first");
    // The fallback path still exists (and is reached via the guardrail).
    expect(flat).toContain("Fallback: hand the prompt to the writer");
  });

  it("cartoon (codex) output adds a cover-specific no-hang fallback via OWS import", () => {
    const flat = generateStoryInstructions("cartoon", "codex").replace(/\s+/g, " ");
    expect(flat).toContain("Cover fallback");
    // Cover-only requests must not hang either; OWS import is the concrete fallback.
    expect(flat).toContain("Import generated image");
    expect(flat).toContain("cover-only request");
    expect(flat).toContain("do NOT hang on the cover");
  });

  it("the #307 guardrail preserves the #274 create-file primacy (Codex is not told it cannot create files)", () => {
    const out = generateStoryInstructions("cartoon", "codex");
    // Guardrail is a precondition, not a demotion: create-file is still primary.
    expect(out).toContain("Create the clean image file directly — your primary job");
    expect(out).toContain("CREATE THE REAL CLEAN-IMAGE FILE");
    // #274 invariant intact — never categorically denied the capability.
    expect(out).not.toContain("You cannot create image files yourself");
    expect(out).not.toContain("do **not** generate image files");
  });

  it("the no-hang guardrail and cover fallback are Codex-only and do not leak into claude/fiction", () => {
    const codex = generateStoryInstructions("cartoon", "codex");
    const claude = generateStoryInstructions("cartoon", "claude");
    const fiction = generateStoryInstructions("fiction");
    expect(codex).toContain("confirm capability, checkpoint, and never hang");
    // #307 guardrail/fallback phrasing must NOT appear in Claude/default output
    // (it would contradict "You cannot create image files yourself"). The shared
    // Asset Tooling copy stays provider-neutral.
    for (const phrase of [
      "confirm capability, checkpoint, and never hang",
      "Cover fallback",
      "bounded attempt",
      "Import generated image",
      "switching to the prompt-and-import",
    ]) {
      expect(claude).not.toContain(phrase);
      expect(fiction).not.toContain(phrase);
    }
    // Claude/default still carries its own can't-create-files handoff intact.
    expect(claude).toContain("You cannot create image files yourself");
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

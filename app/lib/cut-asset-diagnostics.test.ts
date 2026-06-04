import { describe, it, expect } from "vitest";
import { diagnoseCutAssets, summarizeAssetDiagnostics } from "./cut-asset-diagnostics";
import type { Cut } from "./cuts";

function cut(o: Partial<Cut> & { id: number }): Cut {
  return {
    id: 0, shotType: "medium", description: "", characters: [], dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null, exportedAt: null, uploadedCid: null, uploadedUrl: null,
    overlays: [], ...o,
  };
}

/** assetIssue stub: every path in `present` is valid (null); anything else is "missing". */
function issuer(present: string[]) {
  const set = new Set(present);
  return (rel: string) => (set.has(rel) ? null : "the file is missing");
}

describe("diagnoseCutAssets (#427)", () => {
  it("classifies the full state taxonomy against disk", () => {
    const cuts = [
      cut({ id: 1 }), // no recorded path → planned
      cut({ id: 2, cleanImagePath: "assets/genesis/cut-02-clean.webp" }), // exists → clean-ready
      cut({ id: 3, cleanImagePath: "assets/genesis/cut-03-clean.webp", finalImagePath: "assets/genesis/cut-03-final.webp", exportedAt: "t" }), // final exists → final-ready
      cut({ id: 4, cleanImagePath: "assets/genesis/cut-04-clean.webp", uploadedUrl: "https://x/4" }), // uploaded
      cut({ id: 5, cleanImagePath: "assets/genesis/cut-05-clean.png" }), // recorded but not present → missing
    ];
    const present = ["assets/genesis/cut-02-clean.webp", "assets/genesis/cut-03-final.webp"];
    const diags = diagnoseCutAssets(cuts, issuer(present));
    expect(diags.map((d) => d.state)).toEqual(["planned", "clean-ready", "final-ready", "uploaded", "missing"]);
    // The missing cut names the exact path + reason.
    expect(diags[4].issue).toMatch(/Cut 5: clean image "assets\/genesis\/cut-05-clean\.png" — the file is missing/);
    // Summary tallies.
    expect(summarizeAssetDiagnostics(diags)).toEqual({ planned: 1, needsConversion: 0, missing: 1, cleanReady: 1, finalReady: 1, uploaded: 1 });
  });

  // #441: a PNG clean image is a friendly "needs-conversion" step, not a red
  // unsupported-extension error.
  it("classifies a recorded PNG clean image as needs-conversion with the convertible path", () => {
    const cuts = [cut({ id: 1, cleanImagePath: "assets/genesis/cut-01-clean.png" })];
    // assetIssue rejects the .png (publish-strict), but pngClean reports it convertible.
    const diags = diagnoseCutAssets(cuts, () => "Unsupported extension .png", () => "assets/genesis/cut-01-clean.png");
    expect(diags[0].state).toBe("needs-conversion");
    expect(diags[0].convertiblePng).toBe("assets/genesis/cut-01-clean.png");
    // The raw unsupported-extension reason is kept as a hide-able technical detail.
    expect(diags[0].issue).toMatch(/Unsupported extension \.png/);
    expect(summarizeAssetDiagnostics(diags).needsConversion).toBe(1);
  });

  it("classifies an UNRECORDED on-disk PNG (no cleanImagePath) as needs-conversion", () => {
    const diags = diagnoseCutAssets([cut({ id: 2 })], issuer([]), () => "assets/genesis/cut-02-clean.png");
    expect(diags[0].state).toBe("needs-conversion");
    expect(diags[0].convertiblePng).toBe("assets/genesis/cut-02-clean.png");
    expect(diags[0].issue).toBeNull();
  });

  it("a text panel is never needs-conversion even if pngClean returns a path", () => {
    const diags = diagnoseCutAssets([cut({ id: 3, kind: "text", background: "#101820" })], issuer([]), () => "assets/genesis/cut-03-clean.png");
    expect(diags[0].state).toBe("planned");
    expect(diags[0].convertiblePng).toBeNull();
  });

  it("a recorded invalid path with NO convertible PNG stays 'missing'", () => {
    const diags = diagnoseCutAssets([cut({ id: 4, cleanImagePath: "assets/genesis/cut-04-clean.webp" })], issuer([]), () => null);
    expect(diags[0].state).toBe("missing");
    expect(diags[0].convertiblePng).toBeNull();
  });

  it("an uploaded cut stays 'uploaded' even when its local files are gone (content is on IPFS)", () => {
    const diags = diagnoseCutAssets([cut({ id: 1, cleanImagePath: "assets/x.webp", finalImagePath: "assets/y.webp", uploadedCid: "Qm" })], issuer([]));
    expect(diags[0].state).toBe("uploaded");
    expect(diags[0].issue).toBeNull();
  });

  it("a recorded final path that's missing reports the final (not the clean) path", () => {
    const diags = diagnoseCutAssets([cut({ id: 7, cleanImagePath: "assets/c.webp", finalImagePath: "assets/f.webp", exportedAt: "t" })], issuer(["assets/c.webp"]));
    expect(diags[0].state).toBe("missing");
    expect(diags[0].issue).toMatch(/final image "assets\/f\.webp"/);
  });

  it("a text panel with no exported final is 'planned' (no clean image required)", () => {
    const diags = diagnoseCutAssets([cut({ id: 1, kind: "text", background: "#101820" })], issuer([]));
    expect(diags[0].state).toBe("planned");
    expect(diags[0].kind).toBe("text");
  });
});

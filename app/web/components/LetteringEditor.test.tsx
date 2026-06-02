import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { LetteringEditor } from "./LetteringEditor";
import { installObjectUrlStub, makeAssetAuthFetch, MOCK_BLOB_URL } from "./asset-test-utils";

beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      Object.defineProperty(target, "clientWidth", { value: 400, configurable: true });
      Object.defineProperty(target, "clientHeight", { value: 300, configurable: true });
      this.callback([{ contentRect: { width: 400, height: 300 }, target } as unknown as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

interface Overlay {
  id: string;
  type: "speech" | "narration" | "sfx";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  speaker?: string;
  tailAnchor?: { x: number; y: number };
}

afterEach(cleanup);

// The clean image now loads asynchronously through authFetch -> blob -> object
// URL, so the <img> only mounts after that resolves. Await it before firing the
// load event that drives overlay positioning.
async function simulateImageLoad() {
  const img = await screen.findByRole("img");
  Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
  act(() => { fireEvent.load(img); });
  return img;
}

function makeCut(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    cleanImagePath: "assets/plot-01/cut-01-clean.webp",
    overlays: [] as Overlay[],
    ...overrides,
  };
}

describe("LetteringEditor", () => {
  it("renders clean image via authFetch blob, not a raw auth-protected URL", async () => {
    // Regression: a raw <img src="/api/stories/.../asset/..."> can't send the
    // Bearer header, so the asset 401s and the image breaks. The editor must
    // load it through authFetch and render the resulting object URL instead.
    const authFetch = makeAssetAuthFetch();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut()}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const img = await screen.findByAltText("Cut 1 clean");
    expect(img).toHaveAttribute("src", MOCK_BLOB_URL);
    expect(img).not.toHaveAttribute("src", "/api/stories/story/asset/plot-01/cut-01-clean.webp");
    expect(authFetch).toHaveBeenCalledWith("/api/stories/story/asset/plot-01/cut-01-clean.webp");
  });

  it("shows message when no clean image and no overlays", () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ cleanImagePath: null, overlays: [] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/No clean image/)).toBeInTheDocument();
  });

  it("allows editor for blank narration cut with overlays", () => {
    const overlay: Overlay = {
      id: "narr-1",
      type: "narration",
      x: 0.1, y: 0.1, width: 0.8, height: 0.2,
      text: "The story begins...",
    };
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ cleanImagePath: null, overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("export-btn")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");
  });

  it("allows editor for narration cut with narration text but no overlays", () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ cleanImagePath: null, overlays: [], narration: "Once upon a time..." })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("export-btn")).toBeInTheDocument();
    expect(screen.getByText("Narration cut")).toBeInTheDocument();
  });

  it("renders overlay elements after image load", async () => {
    const overlay: Overlay = {
      id: "test-overlay-1",
      type: "speech",
      x: 0.1,
      y: 0.2,
      width: 0.25,
      height: 0.12,
      text: "Hello!",
      speaker: "Mira",
    };

    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await simulateImageLoad();

    const el = screen.getByTestId("overlay-test-overlay-1");
    expect(el).toBeInTheDocument();
    // Bubble text is gated on font readiness (#310): until fonts resolve, the
    // speaker-prefixed transient renders "Mira: Hello!" as a single node; once
    // ready, the body wraps into its own line span. Wait for that re-render so
    // the body-text assertion is deterministic (was a flaky getByText race).
    await waitFor(() =>
      expect(screen.getByTestId("overlay-text-test-overlay-1")).toHaveAttribute("data-fonts-ready", "true"),
    );
    expect(screen.getByText("Hello!")).toBeInTheDocument();
  });

  it("renders a visible tail for a speech overlay so tail-anchor edits are seen, not only exported", async () => {
    // Regression: tailAnchor was editable and persisted but drawn nowhere in
    // the editor — the writer got no feedback until export. The preview must
    // render the tail polygon driven by tailAnchor.
    const overlay: Overlay = {
      id: "tail-speech",
      type: "speech",
      x: 0.1, y: 0.2, width: 0.25, height: 0.12,
      text: "Hi", speaker: "Mira",
      tailAnchor: { x: 0.5, y: 1.2 },
    };
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await simulateImageLoad();

    const tail = screen.getByTestId("tail-tail-speech");
    expect(tail).toBeInTheDocument();
    expect(tail.tagName.toLowerCase()).toBe("polygon");
    // Three points: base1, tip, base2.
    expect(tail.getAttribute("points")?.trim().split(/\s+/)).toHaveLength(3);
  });

  it("does not render a tail polygon for narration overlays", async () => {
    const overlay: Overlay = {
      id: "narr-tail",
      type: "narration",
      x: 0.1, y: 0.2, width: 0.25, height: 0.12,
      text: "Later...",
    };
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await simulateImageLoad();

    expect(screen.queryByTestId("tail-narr-tail")).not.toBeInTheDocument();
  });

  it("shows inspector when overlay is clicked", async () => {
    const overlay: Overlay = {
      id: "test-overlay-2",
      type: "narration",
      x: 0.3,
      y: 0.4,
      width: 0.25,
      height: 0.12,
      text: "The sun set.",
    };

    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await simulateImageLoad();

    expect(screen.queryByTestId("inspector-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-test-overlay-2"));

    expect(screen.queryByTestId("inspector-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("delete-overlay")).toBeInTheDocument();
  });

  it("deselects overlay when clicking background", async () => {
    const overlay: Overlay = {
      id: "test-overlay-3",
      type: "speech",
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      text: "Test",
      speaker: "Jin",
    };

    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await simulateImageLoad();

    fireEvent.click(screen.getByTestId("overlay-test-overlay-3"));
    expect(screen.getByTestId("delete-overlay")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("editor-surface"));
    expect(screen.getByTestId("inspector-empty")).toBeInTheDocument();
  });

  it("positions overlays correctly with mismatched aspect ratio (letterboxing)", async () => {
    const overlay: Overlay = {
      id: "test-overlay-ar",
      type: "speech",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      text: "Full",
      speaker: "A",
    };

    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Simulate a wide image in a tall container (will letterbox top/bottom)
    const img = await screen.findByRole("img");
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 200, configurable: true });

    const container = screen.getByTestId("editor-surface");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });

    act(() => { fireEvent.load(img); });

    // With 800x200 image in 400x400 container:
    // scale = min(400/800, 400/200) = min(0.5, 2) = 0.5
    // rendered: 400x100, offset y = (400-100)/2 = 150
    const el = screen.getByTestId("overlay-test-overlay-ar");
    expect(el.style.left).toBe("0px");
    expect(el.style.top).toBe("150px");
    expect(el.style.width).toBe("400px");
    expect(el.style.height).toBe("100px");
  });

  it("adds overlay via toolbar button", async () => {
    render(
      <LetteringEditor storyName="story" cut={makeCut()} plotFile="plot-01" authFetch={makeAssetAuthFetch()} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    await simulateImageLoad();

    expect(screen.getByTestId("overlay-count")).toHaveTextContent("0 overlays");
    fireEvent.click(screen.getByTestId("add-speech"));
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");
  });

  it("edits overlay text via inspector", async () => {
    render(
      <LetteringEditor storyName="story" cut={makeCut()} plotFile="plot-01" authFetch={makeAssetAuthFetch()} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    await simulateImageLoad();

    fireEvent.click(screen.getByTestId("add-narration"));
    const overlayEl = document.querySelector("[data-testid^='overlay-overlay-']")!;
    fireEvent.click(overlayEl);

    const textInput = screen.getByTestId("inspector-text");
    fireEvent.change(textInput, { target: { value: "The dawn broke." } });

    expect(textInput).toHaveValue("The dawn broke.");
  });

  it("deletes overlay with double-click confirmation", async () => {
    render(
      <LetteringEditor storyName="story" cut={makeCut()} plotFile="plot-01" authFetch={makeAssetAuthFetch()} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    await simulateImageLoad();

    fireEvent.click(screen.getByTestId("add-sfx"));
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");

    const overlayEl = document.querySelector("[data-testid^='overlay-overlay-']")!;
    fireEvent.click(overlayEl);

    const deleteBtn = screen.getByTestId("delete-overlay");
    expect(deleteBtn).toHaveTextContent("Delete");
    fireEvent.click(deleteBtn);
    expect(deleteBtn).toHaveTextContent("Click again to delete");
    fireEvent.click(deleteBtn);

    expect(screen.getByTestId("overlay-count")).toHaveTextContent("0 overlays");
  });

  it("saves overlays via onSave callback", async () => {
    const onSave = vi.fn();
    render(
      <LetteringEditor storyName="story" cut={makeCut()} plotFile="plot-01" authFetch={makeAssetAuthFetch()} onSave={onSave} onClose={vi.fn()} />,
    );
    await simulateImageLoad();

    fireEvent.click(screen.getByTestId("add-speech"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: "speech" })]),
    );
  });

  it("shows tail anchor controls for speech overlay without tailAnchor field", async () => {
    const overlay: Overlay = {
      id: "test-no-tail",
      type: "speech",
      x: 0.1,
      y: 0.1,
      width: 0.25,
      height: 0.12,
      text: "Hello",
      speaker: "Mira",
    };

    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await simulateImageLoad();
    fireEvent.click(screen.getByTestId("overlay-test-no-tail"));

    const tailX = screen.getByTestId("inspector-tail-x") as HTMLInputElement;
    const tailY = screen.getByTestId("inspector-tail-y") as HTMLInputElement;
    expect(tailX).toBeInTheDocument();
    expect(tailY).toBeInTheDocument();
    expect(parseFloat(tailX.value)).toBe(0.5);
    expect(parseFloat(tailY.value)).toBe(1.2);
  });

  it("uses Korean font when language is Korean", async () => {
    const overlay: Overlay = {
      id: "test-kr-font",
      type: "speech",
      x: 0.1,
      y: 0.1,
      width: 0.25,
      height: 0.12,
      text: "안녕",
      speaker: "주인공",
    };

    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [overlay] })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        language="Korean"
      />,
    );

    await simulateImageLoad();
    fireEvent.click(screen.getByTestId("overlay-test-kr-font"));

    expect(screen.getByTestId("inspector-font")).toHaveTextContent("Noto Sans KR");
  });

  it("calls onClose when Close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut()}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  // #310: the editor preview must wrap bubble dialogue into multiple lines
  // (shared layout with the export), not a single truncated label.
  it("renders wrapped multi-line bubble text in the preview (WYSIWYG)", async () => {
    const authFetch = makeAssetAuthFetch();
    const longText = "the quick brown fox jumps over the lazy dog and keeps on running through";
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [{ id: "ov1", type: "speech", x: 0.05, y: 0.05, width: 0.4, height: 0.35, text: longText, tailAnchor: { x: 0.5, y: 1.2 } }] as unknown as Overlay[] })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();
    // The exact (canvas-measured) layout only renders once fonts are ready.
    await waitFor(() =>
      expect(screen.getByTestId("overlay-text-ov1")).toHaveAttribute("data-fonts-ready", "true"),
    );
    const textBox = screen.getByTestId("overlay-text-ov1");
    const lines = Array.from(textBox.querySelectorAll("span.block")).map((s) => s.textContent);
    expect(lines.length).toBeGreaterThan(1); // wrapped, not one line
    expect(lines.join(" ")).toBe(longText); // no words lost across the wrapped lines
  });

  // #310 (re1): the preview must not freeze fallback-font line breaks — the exact
  // canvas-measured layout is gated on the same font-readiness signal as export,
  // and recomputes once fonts load.
  it("defers the exact preview layout until fonts are ready, then recomputes", async () => {
    // Control font readiness: ensureFontsReady awaits document.fonts.load.
    let resolveLoad: (v: unknown) => void = () => {};
    const loadPromise = new Promise((r) => { resolveLoad = r; });
    const fontsStub = {
      load: vi.fn(() => loadPromise),
      check: vi.fn(() => false),
      ready: Promise.resolve(),
    };
    const original = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", { value: fontsStub, configurable: true });
    try {
      const authFetch = makeAssetAuthFetch();
      render(
        <LetteringEditor
          storyName="story"
          cut={makeCut({ overlays: [{ id: "ovf", type: "speech", x: 0.05, y: 0.05, width: 0.4, height: 0.35, text: "wrap me across multiple lines please now" }] as unknown as Overlay[] })}
          plotFile="plot-01"
          authFetch={authFetch}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      await simulateImageLoad();
      // Before fonts load: transient render, NOT the canvas-measured line spans.
      const before = await screen.findByTestId("overlay-text-ovf");
      expect(before).toHaveAttribute("data-fonts-ready", "false");
      expect(before.querySelectorAll("span.block").length).toBe(0);
      expect(fontsStub.load).toHaveBeenCalled(); // export's readiness signal used

      // Fonts become ready → preview recomputes the exact layout.
      await act(async () => { resolveLoad([{}]); await Promise.resolve(); });
      await waitFor(() =>
        expect(screen.getByTestId("overlay-text-ovf")).toHaveAttribute("data-fonts-ready", "true"),
      );
      expect(screen.getByTestId("overlay-text-ovf").querySelectorAll("span.block").length).toBeGreaterThan(1);
    } finally {
      if (original) Object.defineProperty(document, "fonts", original);
      else Reflect.deleteProperty(document, "fonts");
    }
  });

  // #309: a cut authored with a semantic `position` overlay (no numeric geometry)
  // must be repaired on load so it renders and exports, with a visible note.
  it("normalizes a semantic-position overlay on load and surfaces a repair note", async () => {
    const authFetch = makeAssetAuthFetch();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [{ type: "speech", speaker: "Hana", text: "Hi", position: "upper-left" }] as unknown as Overlay[] })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("overlay-repair-note")).toBeInTheDocument();
    // Repaired (not dropped) → still counted as one overlay.
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");
  });

  it("surfaces a blocking note (not a silent drop) for an un-placeable overlay", async () => {
    const authFetch = makeAssetAuthFetch();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [{ type: "speech", text: "orphan, no geometry" }] as unknown as Overlay[] })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const note = await screen.findByTestId("overlay-repair-note");
    expect(note).toHaveTextContent(/cannot be exported/);
    expect(screen.getByTestId("discard-invalid-overlays")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("0 overlays");
  });

  // #309 (re1): clicking Export on a cut with an un-placeable overlay must NOT
  // save/export the silently-reduced set — it must show a clear error.
  it("blocks export (no save) for an un-placeable overlay and shows a clear error", async () => {
    const onSave = vi.fn();
    const authFetch = makeAssetAuthFetch();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [{ type: "speech", text: "orphan, no geometry" }] as unknown as Overlay[] })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId("overlay-repair-note");
    fireEvent.click(screen.getByTestId("export-btn"));
    // Clear, blocking error; the reduced overlay set is neither saved nor exported.
    await screen.findByText(/cannot be exported — re-place it or discard it first/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("after discarding unplaceable overlays, export is no longer blocked (proceeds to save)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const authFetch = makeAssetAuthFetch();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays: [{ type: "speech", text: "orphan, no geometry" }] as unknown as Overlay[] })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId("discard-invalid-overlays");
    fireEvent.click(screen.getByTestId("discard-invalid-overlays"));
    // Note flips to the discarded state; the export guard no longer blocks.
    await waitFor(() => expect(screen.getByTestId("overlay-repair-note")).toHaveTextContent(/Discarded/));
    fireEvent.click(screen.getByTestId("export-btn"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  // #318: overlapping speech bubbles hide each other's text. The editor must
  // warn before export/publish, naming the cut and the affected overlay indexes,
  // without blocking export (overlap can be intentional).
  it("warns when two bubbles overlap, naming the cut and overlay indexes", async () => {
    const overlays: Overlay[] = [
      { id: "ov-a", type: "speech", x: 0.1, y: 0.1, width: 0.3, height: 0.2, text: "Good news! We are short one", speaker: "Boss" },
      { id: "ov-b", type: "speech", x: 0.2, y: 0.15, width: 0.3, height: 0.2, text: "I am not applying for a boyfriend.", speaker: "Mei" },
    ];
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ id: 7, overlays })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();
    const warning = screen.getByTestId("overlay-overlap-warning");
    expect(warning).toHaveTextContent("Cut #7");
    // Affected overlay indexes (1-based) are identified.
    expect(warning).toHaveTextContent("#1");
    expect(warning).toHaveTextContent("#2");
  });

  it("does not warn when bubbles do not overlap", async () => {
    const overlays: Overlay[] = [
      { id: "ov-a", type: "speech", x: 0.0, y: 0.0, width: 0.25, height: 0.15, text: "Hi", speaker: "A" },
      { id: "ov-b", type: "speech", x: 0.6, y: 0.6, width: 0.25, height: 0.15, text: "Bye", speaker: "B" },
    ];
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();
    expect(screen.queryByTestId("overlay-overlap-warning")).not.toBeInTheDocument();
  });

  it("the overlap warning is non-blocking — export still proceeds", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const overlays: Overlay[] = [
      { id: "ov-a", type: "speech", x: 0.1, y: 0.1, width: 0.3, height: 0.2, text: "front", speaker: "A" },
      { id: "ov-b", type: "speech", x: 0.2, y: 0.15, width: 0.3, height: 0.2, text: "back", speaker: "B" },
    ];
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();
    expect(screen.getByTestId("overlay-overlap-warning")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("export-btn"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it("clears the overlap warning once the bubbles are separated (live)", async () => {
    const overlays: Overlay[] = [
      { id: "ov-a", type: "speech", x: 0.1, y: 0.1, width: 0.3, height: 0.2, text: "front", speaker: "A" },
      { id: "ov-b", type: "speech", x: 0.2, y: 0.15, width: 0.3, height: 0.2, text: "back", speaker: "B" },
    ];
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ overlays })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();
    expect(screen.getByTestId("overlay-overlap-warning")).toBeInTheDocument();
    // Remove one of the overlapping bubbles → the overlap is gone, warning clears.
    fireEvent.click(screen.getByTestId("overlay-ov-b"));
    const del = screen.getByTestId("delete-overlay");
    fireEvent.click(del); // arms confirmation
    fireEvent.click(del); // confirms delete
    await waitFor(() => expect(screen.queryByTestId("overlay-overlap-warning")).not.toBeInTheDocument());
  });
});

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
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

  it("drops an un-placeable overlay on load and warns it was removed", async () => {
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
    expect(note).toHaveTextContent(/removed/);
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("0 overlays");
  });
});

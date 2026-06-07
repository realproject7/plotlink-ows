import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { LetteringEditor } from "./LetteringEditor";
import {
  installObjectUrlStub,
  makeAssetAuthFetch,
  MOCK_BLOB_URL,
} from "./asset-test-utils";
import { textPanelDimensions } from "@app-lib/cuts";

beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      Object.defineProperty(target, "clientWidth", {
        value: 400,
        configurable: true,
      });
      Object.defineProperty(target, "clientHeight", {
        value: 300,
        configurable: true,
      });
      this.callback(
        [
          {
            contentRect: { width: 400, height: 300 },
            target,
          } as unknown as ResizeObserverEntry,
        ],
        this,
      );
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
  textStyle?: {
    mode?: "auto" | "manual";
    fontScale?: number;
    fontWeight?: 400 | 700;
    lineHeightFactor?: number;
    speakerScale?: number;
  };
  bubbleStyle?: {
    paddingX?: number;
    paddingY?: number;
    cornerRadius?: number;
  };
}

afterEach(cleanup);

// The clean image now loads asynchronously through authFetch -> blob -> object
// URL, so the <img> only mounts after that resolves. Await it before firing the
// load event that drives overlay positioning.
async function simulateImageLoad() {
  const img = await screen.findByRole("img");
  Object.defineProperty(img, "naturalWidth", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(img, "naturalHeight", {
    value: 600,
    configurable: true,
  });
  act(() => {
    fireEvent.load(img);
  });
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
    expect(img).not.toHaveAttribute(
      "src",
      "/api/stories/story/asset/plot-01/cut-01-clean.webp",
    );
    expect(authFetch).toHaveBeenCalledWith(
      "/api/stories/story/asset/plot-01/cut-01-clean.webp",
    );
  });

  // #452: a clean-image cut opens a clear lettering workspace, and a narration
  // overlay added from the script gets a roomy default box (no instant overflow)
  // plus a one-click "Fit box to text" resize.
  it("offers the lettering workspace + a roomy narration overlay with a Fit-to-text control", async () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          narration:
            "A long narration line that would overflow a tiny default box on an ordinary panel.",
        })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Workspace regions: the image canvas, the script-insert buttons, the add tools.
    await screen.findByAltText("Cut 1 clean");
    expect(screen.getByTestId("add-narration")).toBeInTheDocument();
    expect(screen.getByTestId("script-insert-panel")).toBeInTheDocument();

    // Insert the narration line from the script → an overlay is added + selected.
    fireEvent.click(screen.getByTestId("script-insert-narration"));
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");
    // The inspector opens with the text and a one-click Fit control.
    expect(screen.getByTestId("inspector-text")).toHaveValue(
      "A long narration line that would overflow a tiny default box on an ordinary panel.",
    );
    const fit = screen.getByTestId("inspector-fit-text");
    expect(fit).toBeInTheDocument();

    // Clicking Fit keeps the overlay placed (the one-click resize path works).
    fireEvent.click(fit);
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");
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
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.2,
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
        cut={makeCut({
          cleanImagePath: null,
          overlays: [],
          narration: "Once upon a time...",
        })}
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
      expect(screen.getByTestId("overlay-text-test-overlay-1")).toHaveAttribute(
        "data-fonts-ready",
        "true",
      ),
    );
    expect(screen.getByText("Hello!")).toBeInTheDocument();
  });

  // #327: the body and tail must render as ONE integrated balloon <path> so the
  // editor preview shows no internal seam between them, and tail-anchor edits
  // stay visible (they are part of the single outline, not a separate polygon).
  it("renders the speech bubble body + tail as one integrated balloon path (no seamed polygon)", async () => {
    const overlay: Overlay = {
      id: "tail-speech",
      type: "speech",
      x: 0.1,
      y: 0.2,
      width: 0.25,
      height: 0.12,
      text: "Hi",
      speaker: "Mira",
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

    const balloon = screen.getByTestId("balloon-tail-speech");
    expect(balloon).toBeInTheDocument();
    expect(balloon.tagName.toLowerCase()).toBe("path");
    const d = balloon.getAttribute("d") ?? "";
    // One continuous outline: starts with a moveto, closes with Z, and includes
    // rounded-corner arcs — the tail is a detour in this same path, not a
    // separate shape laid under a fully-stroked body box.
    expect(d.startsWith("M")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect(d).toContain("A"); // rounded body corners in the same path
    // The default {0.5, 1.2} tail points straight down: its tip Y sits below the
    // bubble's bottom edge, so the integrated path must reach past the bottom.
    const bubbleBottom = 0.2 * 300 + 0.12 * 300; // oy + oh in display px (image 800x600 → 400x300)
    const ys = Array.from(d.matchAll(/[ML] [\d.-]+ ([\d.-]+)/g)).map((m) =>
      parseFloat(m[1]),
    );
    expect(Math.max(...ys)).toBeGreaterThan(bubbleBottom); // tail tip extends below the body
    // No separate stroked tail polygon — that was the old seamed rendering.
    expect(document.querySelector("polygon")).toBeNull();
  });

  it("renders a tailless speech bubble as a plain rounded-rectangle path", async () => {
    // A tail anchor whose tip falls inside the bubble yields no tail; the bubble
    // must still render as a single rounded-rect balloon path (#327).
    const overlay: Overlay = {
      id: "no-tail-speech",
      type: "speech",
      x: 0.1,
      y: 0.2,
      width: 0.25,
      height: 0.12,
      text: "Hi",
      speaker: "Mira",
      tailAnchor: { x: 0.5, y: 0.5 }, // tip inside the bubble → no tail
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

    const balloon = screen.getByTestId("balloon-no-tail-speech");
    expect(balloon.tagName.toLowerCase()).toBe("path");
    const d = balloon.getAttribute("d") ?? "";
    // Bounded by the body rect — no point extends past the bottom edge.
    const bubbleBottom = 0.2 * 300 + 0.12 * 300;
    const ys = Array.from(d.matchAll(/[ML] [\d.-]+ ([\d.-]+)/g)).map((m) =>
      parseFloat(m[1]),
    );
    expect(Math.max(...ys)).toBeLessThanOrEqual(bubbleBottom + 0.01);
  });

  it("does not render a balloon path for narration overlays", async () => {
    const overlay: Overlay = {
      id: "narr-tail",
      type: "narration",
      x: 0.1,
      y: 0.2,
      width: 0.25,
      height: 0.12,
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

    expect(screen.queryByTestId("balloon-narr-tail")).not.toBeInTheDocument();
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
    Object.defineProperty(img, "naturalWidth", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(img, "naturalHeight", {
      value: 200,
      configurable: true,
    });

    const container = screen.getByTestId("editor-surface");
    Object.defineProperty(container, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 400,
      configurable: true,
    });

    act(() => {
      fireEvent.load(img);
    });

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
      <LetteringEditor
        storyName="story"
        cut={makeCut()}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();

    expect(screen.getByTestId("overlay-count")).toHaveTextContent("0 overlays");
    fireEvent.click(screen.getByTestId("add-speech"));
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");
  });

  it("edits overlay text via inspector", async () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut()}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();

    fireEvent.click(screen.getByTestId("add-narration"));
    const overlayEl = document.querySelector(
      "[data-testid^='overlay-overlay-']",
    )!;
    fireEvent.click(overlayEl);

    const textInput = screen.getByTestId("inspector-text");
    fireEvent.change(textInput, { target: { value: "The dawn broke." } });

    expect(textInput).toHaveValue("The dawn broke.");
  });

  it("deletes overlay with double-click confirmation", async () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut()}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();

    fireEvent.click(screen.getByTestId("add-sfx"));
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");

    const overlayEl = document.querySelector(
      "[data-testid^='overlay-overlay-']",
    )!;
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
      <LetteringEditor
        storyName="story"
        cut={makeCut()}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();

    fireEvent.click(screen.getByTestId("add-speech"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: "speech" })]),
    );
  });

  it("saves manual typography and bubble controls through the inspector", async () => {
    const onSave = vi.fn();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          overlays: [
            {
              id: "manual",
              type: "speech",
              x: 0.1,
              y: 0.1,
              width: 0.25,
              height: 0.12,
              text: "Hello",
              speaker: "Mira",
            },
          ],
        })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();

    fireEvent.click(screen.getByTestId("overlay-manual"));
    fireEvent.click(screen.getByTestId("inspector-text-manual"));
    fireEvent.change(screen.getByTestId("inspector-font-scale"), {
      target: { value: "4.5" },
    });
    fireEvent.change(screen.getByTestId("inspector-line-height"), {
      target: { value: "1.35" },
    });
    fireEvent.change(screen.getByTestId("inspector-speaker-scale"), {
      target: { value: "0.9" },
    });
    fireEvent.change(screen.getByTestId("inspector-padding-x"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByTestId("inspector-padding-y"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByTestId("inspector-corner-radius"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manual",
          textStyle: expect.objectContaining({
            mode: "manual",
            fontScale: 0.045,
            fontWeight: 400,
            lineHeightFactor: 1.35,
            speakerScale: 0.9,
          }),
          bubbleStyle: expect.objectContaining({
            paddingX: 0.12,
            paddingY: 0.1,
            cornerRadius: 0.25,
          }),
        }),
      ]),
    );
  });

  it("applies the manual bold text style in the preview", async () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          overlays: [
            {
              id: "bold",
              type: "speech",
              x: 0.1,
              y: 0.1,
              width: 0.25,
              height: 0.12,
              text: "Bold line",
              speaker: "Mira",
              textStyle: { mode: "manual", fontScale: 0.04, fontWeight: 700 },
            },
          ],
        })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();
    await waitFor(() =>
      expect(screen.getByTestId("overlay-text-bold")).toHaveAttribute(
        "data-fonts-ready",
        "true",
      ),
    );
    const body = screen
      .getByTestId("overlay-text-bold")
      .querySelector(".text-\\[\\#1a1a1a\\]") as HTMLElement | null;
    expect(body?.style.fontWeight).toBe("700");
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

  it("offers preset tail directions beyond raw numeric inputs", async () => {
    const overlay: Overlay = {
      id: "tail-preset",
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
    fireEvent.click(screen.getByTestId("overlay-tail-preset"));
    fireEvent.click(screen.getByTestId("inspector-tail-left"));

    expect(
      (screen.getByTestId("inspector-tail-x") as HTMLInputElement).value,
    ).toBe("-0.2");
    expect(
      (screen.getByTestId("inspector-tail-y") as HTMLInputElement).value,
    ).toBe("0.5");
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

    expect(screen.getByTestId("inspector-font")).toHaveTextContent(
      "Noto Sans KR",
    );
  });

  it("calls onClose when Cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut()}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows generated AI draft guidance and can return to review after Save (#494)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          dialogue: [{ speaker: "Mira", text: "We move now." }],
          aiDraft: {
            status: "generated",
            baseSig: "sig",
            generatedAt: "2026-01-01T00:00:00Z",
          },
        })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={onSave}
        onClose={onClose}
        targetLabel="Cut 01"
        returnOnSave
      />,
    );

    expect(screen.getByTestId("focused-lettering-editor")).toHaveTextContent(
      "Focused lettering editor",
    );
    expect(screen.getByTestId("ai-draft-current-target")).toHaveTextContent(
      "AI draft ready",
    );

    fireEvent.click(screen.getByTestId("add-speech"));
    fireEvent.click(screen.getByTestId("save-lettering-btn"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  // #310: the editor preview must wrap bubble dialogue into multiple lines
  // (shared layout with the export), not a single truncated label.
  it("renders wrapped multi-line bubble text in the preview (WYSIWYG)", async () => {
    const authFetch = makeAssetAuthFetch();
    const longText =
      "the quick brown fox jumps over the lazy dog and keeps on running through";
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          overlays: [
            {
              id: "ov1",
              type: "speech",
              x: 0.05,
              y: 0.05,
              width: 0.4,
              height: 0.35,
              text: longText,
              tailAnchor: { x: 0.5, y: 1.2 },
            },
          ] as unknown as Overlay[],
        })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();
    // The exact (canvas-measured) layout only renders once fonts are ready.
    await waitFor(() =>
      expect(screen.getByTestId("overlay-text-ov1")).toHaveAttribute(
        "data-fonts-ready",
        "true",
      ),
    );
    const textBox = screen.getByTestId("overlay-text-ov1");
    const lines = Array.from(textBox.querySelectorAll("span.block")).map(
      (s) => s.textContent,
    );
    expect(lines.length).toBeGreaterThan(1); // wrapped, not one line
    expect(lines.join(" ")).toBe(longText); // no words lost across the wrapped lines
  });

  // #310 (re1): the preview must not freeze fallback-font line breaks — the exact
  // canvas-measured layout is gated on the same font-readiness signal as export,
  // and recomputes once fonts load.
  it("defers the exact preview layout until fonts are ready, then recomputes", async () => {
    // Control font readiness: ensureFontsReady awaits document.fonts.load.
    let resolveLoad: (v: unknown) => void = () => {};
    const loadPromise = new Promise((r) => {
      resolveLoad = r;
    });
    const fontsStub = {
      load: vi.fn(() => loadPromise),
      check: vi.fn(() => false),
      ready: Promise.resolve(),
    };
    const original = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", {
      value: fontsStub,
      configurable: true,
    });
    try {
      const authFetch = makeAssetAuthFetch();
      render(
        <LetteringEditor
          storyName="story"
          cut={makeCut({
            overlays: [
              {
                id: "ovf",
                type: "speech",
                x: 0.05,
                y: 0.05,
                width: 0.4,
                height: 0.35,
                text: "wrap me across multiple lines please now",
              },
            ] as unknown as Overlay[],
          })}
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
      await act(async () => {
        resolveLoad([{}]);
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(screen.getByTestId("overlay-text-ovf")).toHaveAttribute(
          "data-fonts-ready",
          "true",
        ),
      );
      expect(
        screen.getByTestId("overlay-text-ovf").querySelectorAll("span.block")
          .length,
      ).toBeGreaterThan(1);
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
        cut={makeCut({
          overlays: [
            {
              type: "speech",
              speaker: "Hana",
              text: "Hi",
              position: "upper-left",
            },
          ] as unknown as Overlay[],
        })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      await screen.findByTestId("overlay-repair-note"),
    ).toBeInTheDocument();
    // Repaired (not dropped) → still counted as one overlay.
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");
  });

  it("surfaces a blocking note (not a silent drop) for an un-placeable overlay", async () => {
    const authFetch = makeAssetAuthFetch();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          overlays: [
            { type: "speech", text: "orphan, no geometry" },
          ] as unknown as Overlay[],
        })}
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
        cut={makeCut({
          overlays: [
            { type: "speech", text: "orphan, no geometry" },
          ] as unknown as Overlay[],
        })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId("overlay-repair-note");
    fireEvent.click(screen.getByTestId("export-btn"));
    // Clear, blocking error; the reduced overlay set is neither saved nor exported.
    await screen.findByText(
      /cannot be exported — re-place it or discard it first/,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("after discarding unplaceable overlays, export is no longer blocked (proceeds to save)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const authFetch = makeAssetAuthFetch();
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          overlays: [
            { type: "speech", text: "orphan, no geometry" },
          ] as unknown as Overlay[],
        })}
        plotFile="plot-01"
        authFetch={authFetch}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId("discard-invalid-overlays");
    fireEvent.click(screen.getByTestId("discard-invalid-overlays"));
    // Note flips to the discarded state; the export guard no longer blocks.
    await waitFor(() =>
      expect(screen.getByTestId("overlay-repair-note")).toHaveTextContent(
        /Discarded/,
      ),
    );
    fireEvent.click(screen.getByTestId("export-btn"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  // #318: overlapping speech bubbles hide each other's text. The editor must
  // warn before export/publish, naming the cut and the affected overlay indexes,
  // without blocking export (overlap can be intentional).
  it("warns when two bubbles overlap, naming the cut and overlay indexes", async () => {
    const overlays: Overlay[] = [
      {
        id: "ov-a",
        type: "speech",
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.2,
        text: "Good news! We are short one",
        speaker: "Boss",
      },
      {
        id: "ov-b",
        type: "speech",
        x: 0.2,
        y: 0.15,
        width: 0.3,
        height: 0.2,
        text: "I am not applying for a boyfriend.",
        speaker: "Mei",
      },
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
      {
        id: "ov-a",
        type: "speech",
        x: 0.0,
        y: 0.0,
        width: 0.25,
        height: 0.15,
        text: "Hi",
        speaker: "A",
      },
      {
        id: "ov-b",
        type: "speech",
        x: 0.6,
        y: 0.6,
        width: 0.25,
        height: 0.15,
        text: "Bye",
        speaker: "B",
      },
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
    expect(
      screen.queryByTestId("overlay-overlap-warning"),
    ).not.toBeInTheDocument();
  });

  it("the overlap warning is non-blocking — export still proceeds", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const overlays: Overlay[] = [
      {
        id: "ov-a",
        type: "speech",
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.2,
        text: "front",
        speaker: "A",
      },
      {
        id: "ov-b",
        type: "speech",
        x: 0.2,
        y: 0.15,
        width: 0.3,
        height: 0.2,
        text: "back",
        speaker: "B",
      },
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
      {
        id: "ov-a",
        type: "speech",
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.2,
        text: "front",
        speaker: "A",
      },
      {
        id: "ov-b",
        type: "speech",
        x: 0.2,
        y: 0.15,
        width: 0.3,
        height: 0.2,
        text: "back",
        speaker: "B",
      },
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
    await waitFor(() =>
      expect(
        screen.queryByTestId("overlay-overlap-warning"),
      ).not.toBeInTheDocument(),
    );
  });

  // #336: insert dialogue/narration/SFX from cuts.json straight into a prefilled
  // overlay, so the writer never copies text out of the JSON by hand.
  it("inserts a script line from cuts.json as a prefilled overlay", async () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          overlays: [],
          dialogue: [{ speaker: "Mira", text: "We're here at last." }],
          narration: "Dawn broke.",
        })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();

    // The script panel lists the cut's dialogue + narration.
    expect(screen.getByTestId("script-insert-panel")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("0 overlays");

    // Clicking a dialogue line adds a speech overlay carrying that text/speaker.
    fireEvent.click(screen.getByTestId("script-insert-speech-0"));
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("1 overlays");
    const speakerInput = screen.getByTestId(
      "inspector-speaker",
    ) as HTMLInputElement;
    expect(speakerInput.value).toBe("Mira");
    expect(
      (screen.getByTestId("inspector-text") as HTMLTextAreaElement).value,
    ).toBe("We're here at last.");

    // Narration is insertable too.
    fireEvent.click(screen.getByTestId("script-insert-narration"));
    expect(screen.getByTestId("overlay-count")).toHaveTextContent("2 overlays");
  });

  // #336: warn about likely export problems — here a bubble whose body extends
  // past the image bounds (would be clipped at export).
  it("warns when a bubble is positioned outside the image bounds", async () => {
    const overlay: Overlay = {
      id: "oob",
      type: "speech",
      x: 0.9,
      y: 0.2,
      width: 0.25,
      height: 0.12, // x + width = 1.15 > 1 → clipped
      text: "Edge",
      speaker: "Mira",
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

    const warning = screen.getByTestId("lettering-export-warning");
    expect(warning).toHaveTextContent(/outside image/i);
    expect(screen.getByTestId("overlay-oob")).toHaveAttribute(
      "data-warning",
      "true",
    );
  });

  it("shows the per-cut lettering checklist reflecting cut progress", async () => {
    const overlay: Overlay = {
      id: "ck",
      type: "speech",
      x: 0.1,
      y: 0.2,
      width: 0.25,
      height: 0.12,
      text: "Hi",
      speaker: "Mira",
    };
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          overlays: [overlay],
          dialogue: [{ speaker: "Mira", text: "Hi" }],
        })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();
    // makeCut sets a cleanImagePath; dialogue + a placed overlay are present, but
    // nothing is exported/uploaded yet.
    expect(screen.getByTestId("lettering-check-clean-image")).toHaveAttribute(
      "data-done",
      "true",
    );
    expect(screen.getByTestId("lettering-check-script-text")).toHaveAttribute(
      "data-done",
      "true",
    );
    expect(screen.getByTestId("lettering-check-bubbles")).toHaveAttribute(
      "data-done",
      "true",
    );
    expect(screen.getByTestId("lettering-check-exported")).toHaveAttribute(
      "data-done",
      "false",
    );
    expect(screen.getByTestId("lettering-check-uploaded")).toHaveAttribute(
      "data-done",
      "false",
    );
  });

  // #336 (re1): editing bubbles after an export/upload must invalidate them — the
  // checklist can't keep reporting "Final exported"/"Uploaded" for a stale image.
  it("marks export/upload stale after overlays are edited post-export", async () => {
    const overlay: Overlay = {
      id: "stale",
      type: "speech",
      x: 0.1,
      y: 0.2,
      width: 0.25,
      height: 0.12,
      text: "Hi",
      speaker: "Mira",
      tailAnchor: { x: 0.5, y: 1.2 },
    };
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          overlays: [overlay],
          finalImagePath: "assets/plot-01/cut-01-final.webp",
          exportedAt: "2026-01-01T00:00:00Z",
          uploadedUrl: "https://ipfs/QmExported",
        })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await simulateImageLoad();

    // On open (no edits) the recorded export/upload count as done, no warning.
    expect(screen.getByTestId("lettering-check-exported")).toHaveAttribute(
      "data-done",
      "true",
    );
    expect(screen.getByTestId("lettering-check-uploaded")).toHaveAttribute(
      "data-done",
      "true",
    );
    expect(
      screen.queryByTestId("lettering-stale-export-warning"),
    ).not.toBeInTheDocument();

    // Edit the bubble text → the prior export/upload no longer match the screen.
    fireEvent.click(screen.getByTestId("overlay-stale"));
    fireEvent.change(screen.getByTestId("inspector-text"), {
      target: { value: "Changed line" },
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("lettering-stale-export-warning"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("lettering-check-exported")).toHaveAttribute(
      "data-done",
      "false",
    );
    expect(screen.getByTestId("lettering-check-uploaded")).toHaveAttribute(
      "data-done",
      "false",
    );
  });

  // #336 (re1): the lifecycle that regressed lives in handleExport/React state —
  // exercise the full edit → stale → successful Export → clear sequence in the
  // SAME open editor, with export-cut mocked so the export succeeds in jsdom.
  it("clears the stale-export warning after a successful re-export in the same editor session", async () => {
    vi.doMock("./export-cut", () => ({
      exportCut: vi
        .fn()
        .mockResolvedValue(
          new Blob([new Uint8Array(10)], { type: "image/webp" }),
        ),
      ensureFontsReady: vi.fn().mockResolvedValue({ ready: true, missing: [] }),
    }));
    try {
      const overlay: Overlay = {
        id: "re",
        type: "speech",
        x: 0.1,
        y: 0.2,
        width: 0.25,
        height: 0.12,
        text: "Hi",
        speaker: "Mira",
        tailAnchor: { x: 0.5, y: 1.2 },
      };
      render(
        <LetteringEditor
          storyName="story"
          cut={makeCut({
            overlays: [overlay],
            finalImagePath: "assets/plot-01/cut-01-final.webp",
            exportedAt: "2026-01-01T00:00:00Z",
            uploadedUrl: "https://ipfs/QmExported",
          })}
          plotFile="plot-01"
          authFetch={makeAssetAuthFetch({ ok: true })}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
          onExported={vi.fn()}
        />,
      );
      await simulateImageLoad();

      // Edit a bubble → export goes stale.
      fireEvent.click(screen.getByTestId("overlay-re"));
      fireEvent.change(screen.getByTestId("inspector-text"), {
        target: { value: "Changed line" },
      });
      await waitFor(() =>
        expect(
          screen.getByTestId("lettering-stale-export-warning"),
        ).toBeInTheDocument(),
      );
      expect(screen.getByTestId("lettering-check-exported")).toHaveAttribute(
        "data-done",
        "false",
      );

      // Re-export in the same session → handleExport advances the baseline, so
      // the warning clears and the checklist steps return to done.
      await act(async () => {
        fireEvent.click(screen.getByTestId("export-btn"));
      });
      await waitFor(() =>
        expect(
          screen.queryByTestId("lettering-stale-export-warning"),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("lettering-check-exported")).toHaveAttribute(
        "data-done",
        "true",
      );
      expect(screen.getByTestId("lettering-check-uploaded")).toHaveAttribute(
        "data-done",
        "true",
      );
    } finally {
      vi.doUnmock("./export-cut");
    }
  });

  // #351 (re1): a text panel's editor canvas must use the SAME aspect ratio the
  // export uses, so lettering and the exported final agree. The ResizeObserver
  // stub reports a 400x300 container; a 4:5 panel (800x1000) object-contained in
  // it is 240x300 — i.e. height/width === 5/4, matching textPanelDimensions.
  it("sizes a text-panel editor canvas to the export aspect ratio (4:5)", async () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({
          cleanImagePath: null,
          overlays: [],
          kind: "text",
          background: "#101820",
          aspectRatio: "4:5",
        })}
        plotFile="plot-01"
        authFetch={makeAssetAuthFetch()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const canvas = await screen.findByTestId("text-panel-canvas");
    const w = parseFloat(canvas.style.width);
    const h = parseFloat(canvas.style.height);
    const dims = textPanelDimensions("4:5")!;
    // Editor canvas ratio equals the export canvas ratio.
    expect(h / w).toBeCloseTo(dims.height / dims.width, 5);
    expect(h / w).toBeCloseTo(5 / 4, 5);
  });
});

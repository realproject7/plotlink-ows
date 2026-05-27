import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LetteringEditor } from "./LetteringEditor";

beforeAll(() => {
  global.ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
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
}

afterEach(cleanup);

function makeCut(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    cleanImagePath: "assets/plot-01/cut-01-clean.webp",
    overlays: [] as Overlay[],
    ...overrides,
  };
}

describe("LetteringEditor", () => {
  it("renders clean image as background", () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const img = screen.getByAltText("Cut 1 clean");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/api/stories/story/asset/plot-01/cut-01-clean.webp");
  });

  it("shows message when no clean image", () => {
    render(
      <LetteringEditor
        storyName="story"
        cut={makeCut({ cleanImagePath: null })}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No clean image — upload one first.")).toBeInTheDocument();
  });

  it("renders overlay elements", () => {
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
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const el = screen.getByTestId("overlay-test-overlay-1");
    expect(el).toBeInTheDocument();
    expect(screen.getByText("Hello!")).toBeInTheDocument();
  });

  it("shows inspector when overlay is clicked", () => {
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
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("inspector-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-test-overlay-2"));

    expect(screen.getByText("Narration")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector-empty")).not.toBeInTheDocument();
  });

  it("deselects overlay when clicking background", () => {
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
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("overlay-test-overlay-3"));
    expect(screen.getByText("Speech")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("editor-surface"));
    expect(screen.getByTestId("inspector-empty")).toBeInTheDocument();
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
});

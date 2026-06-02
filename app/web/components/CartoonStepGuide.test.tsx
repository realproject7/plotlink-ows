import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CartoonStepGuide } from "./CartoonStepGuide";
import { cartoonChecklist } from "@app-lib/cartoon-readiness";
import type { Cut } from "@app-lib/cuts";

afterEach(cleanup);

function makeCut(overrides: Partial<Cut> = {}): Cut {
  return {
    id: 1, shotType: "medium", description: "", characters: [],
    dialogue: [], narration: "", sfx: "",
    cleanImagePath: null, finalImagePath: null,
    exportedAt: null, uploadedCid: null, uploadedUrl: null,
    overlays: [],
    ...overrides,
  };
}

const STEP_KEYS = ["plan", "clean", "letter", "export", "upload", "publish"];

describe("CartoonStepGuide (#335)", () => {
  it("renders nothing when there is no checklist (e.g. fiction / not classified)", () => {
    const { container } = render(<CartoonStepGuide checklist={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty checklist (no cut plan)", () => {
    const { container } = render(<CartoonStepGuide checklist={cartoonChecklist({ cuts: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("teaches the six production steps in order, no jargon, with clean-image help", () => {
    render(<CartoonStepGuide checklist={cartoonChecklist({ cuts: [makeCut({ id: 1 }), makeCut({ id: 2 })] })} />);
    expect(screen.getByTestId("cartoon-step-guide")).toBeInTheDocument();
    expect(screen.getByTestId("cartoon-step-guide")).toHaveAttribute("data-layout", "diagram");
    STEP_KEYS.forEach((k) => expect(screen.getByTestId(`cartoon-step-${k}`)).toBeInTheDocument());
    // With only a cut plan, creating clean images is the current step.
    expect(screen.getByTestId("cartoon-step-plan")).toHaveAttribute("data-status", "done");
    expect(screen.getByTestId("cartoon-step-clean")).toHaveAttribute("data-status", "current");
    expect(screen.getByTestId("cartoon-step-publish")).toHaveAttribute("data-status", "todo");
    // No implementation jargon anywhere in the guide.
    expect(screen.getByTestId("cartoon-step-guide").textContent).not.toMatch(/generate md|markdown/i);
    // Contextual clean-image help is present.
    expect(screen.getByTestId("cartoon-clean-image-help").textContent).toMatch(/artwork only/i);
  });

  it("shows per-cut progress detail on countable steps", () => {
    render(<CartoonStepGuide checklist={cartoonChecklist({ cuts: [makeCut({ id: 1, cleanImagePath: "c.webp" }), makeCut({ id: 2 })] })} />);
    expect(screen.getByTestId("cartoon-step-clean-detail")).toHaveTextContent("1 / 2 cuts");
  });

  it("marks publish current when everything is uploaded but unpublished", () => {
    const uploaded = (id: number): Partial<Cut> => ({
      id, cleanImagePath: "c.webp",
      overlays: [{ id: `o${id}`, type: "speech", x: 0, y: 0, width: 0.2, height: 0.1, text: "hi" }],
      finalImagePath: "f.webp", exportedAt: "2026-01-01", uploadedUrl: `https://ipfs/Qm${id}`,
    });
    render(<CartoonStepGuide checklist={cartoonChecklist({ cuts: [makeCut(uploaded(1))], published: false })} />);
    expect(screen.getByTestId("cartoon-step-publish")).toHaveAttribute("data-status", "current");
    expect(screen.getByTestId("cartoon-next-step")).toHaveTextContent(/preview the episode, then publish/i);
  });
});

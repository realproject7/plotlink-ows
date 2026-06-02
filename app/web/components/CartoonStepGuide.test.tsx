import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CartoonStepGuide } from "./CartoonStepGuide";

afterEach(cleanup);

describe("CartoonStepGuide (#320)", () => {
  it("renders nothing for an unknown stage (e.g. fiction / not classified)", () => {
    const { container } = render(<CartoonStepGuide stage={null} awaitingCount={0} totalCuts={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("teaches the production sequence with the current step marked, no jargon", () => {
    render(<CartoonStepGuide stage="planning" awaitingCount={0} totalCuts={3} />);
    expect(screen.getByTestId("cartoon-step-guide")).toBeInTheDocument();
    // All four milestones present in order.
    ["plan", "markdown", "images", "publish"].forEach((k) =>
      expect(screen.getByTestId(`cartoon-step-${k}`)).toBeInTheDocument(),
    );
    // Current step in planning is "prepare for publish" (renamed from Generate MD).
    expect(screen.getByTestId("cartoon-step-markdown")).toHaveAttribute("data-status", "current");
    expect(screen.getByTestId("cartoon-step-plan")).toHaveAttribute("data-status", "done");
    expect(screen.getByTestId("cartoon-step-publish")).toHaveAttribute("data-status", "todo");
    expect(screen.getByTestId("cartoon-step-guide").textContent).not.toMatch(/generate md/i);
  });

  it("shows the remaining-upload count in the next step during awaiting-upload", () => {
    render(<CartoonStepGuide stage="awaiting-upload" awaitingCount={2} totalCuts={5} />);
    expect(screen.getByTestId("cartoon-step-images")).toHaveAttribute("data-status", "current");
    expect(screen.getByTestId("cartoon-next-step")).toHaveTextContent("2 of 5 cuts still need an uploaded image");
  });

  it("marks publish as the current step when ready", () => {
    render(<CartoonStepGuide stage="ready" awaitingCount={0} totalCuts={4} />);
    expect(screen.getByTestId("cartoon-step-publish")).toHaveAttribute("data-status", "current");
    expect(screen.getByTestId("cartoon-next-step")).toHaveTextContent(/preview the episode, then publish/i);
  });
});

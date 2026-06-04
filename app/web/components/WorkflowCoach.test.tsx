// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { WorkflowCoach, WorkflowCoachView } from "./WorkflowCoach";
import type { CartoonCoach } from "@app-lib/cartoon-coach";

afterEach(cleanup);

const agentCoach: CartoonCoach = {
  stageLabel: "Genesis cuts planned", action: "Generate clean images", actionKind: "agent",
  prompt: "Generate clean images for every cut in genesis.cuts.json. Don't letter, upload, or publish yet.", uiAction: null, episodeFile: "genesis.md",
};
const uiCoach: CartoonCoach = {
  stageLabel: "Clean images ready", action: "Review cuts and start lettering", actionKind: "ui",
  prompt: null, uiAction: "open-lettering", episodeFile: "plot-01.md",
};

/** authFetch that returns a coach for /progress, varying by the focus query. */
function makeAuthFetch(byFocus: Record<string, CartoonCoach | null>, failFor: string[] = []) {
  return vi.fn((url: string) => {
    const focus = new URL(url, "http://x").searchParams.get("focus") ?? "";
    if (failFor.includes(focus)) {
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ coach: byFocus[focus] ?? null }) });
  });
}

describe("WorkflowCoachView (#429)", () => {
  it("renders nothing when there is no coach (fiction / nothing queued)", () => {
    const { container } = render(<WorkflowCoachView coach={null} onAction={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("agent step: shows the action and copies the prompt", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WorkflowCoachView coach={agentCoach} onAction={vi.fn()} />);

    expect(screen.getByTestId("workflow-coach-stage")).toHaveTextContent("Genesis cuts planned");
    expect(screen.getByTestId("workflow-coach-action")).toHaveTextContent("Generate clean images");
    fireEvent.click(screen.getByTestId("workflow-coach-copy"));
    expect(writeText).toHaveBeenCalledWith(agentCoach.prompt);
  });

  it("UI step: the action button invokes onAction with the action key + episode", () => {
    const onAction = vi.fn();
    render(<WorkflowCoachView coach={uiCoach} onAction={onAction} />);
    // No copy button for a UI step.
    expect(screen.queryByTestId("workflow-coach-copy")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workflow-coach-do"));
    expect(onAction).toHaveBeenCalledWith("open-lettering", "plot-01.md");
  });
});

describe("WorkflowCoach container (#429)", () => {
  it("loads and renders the coach scoped to the focused file", async () => {
    const authFetch = makeAuthFetch({ "plot-01.md": uiCoach });
    render(<WorkflowCoach storyName="god-cell" fileName="plot-01.md" authFetch={authFetch} onAction={vi.fn()} />);
    expect(await screen.findByTestId("workflow-coach")).toHaveTextContent("Review cuts and start lettering");
    expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("/progress?focus=plot-01.md"));
  });

  it("clears a previous file's coach when switching to a file whose load fails (stale-state guard)", async () => {
    // genesis.md loads a coach; plot-02.md's progress request 500s.
    const authFetch = makeAuthFetch({ "genesis.md": agentCoach }, ["plot-02.md"]);
    const { rerender } = render(<WorkflowCoach storyName="god-cell" fileName="genesis.md" authFetch={authFetch} onAction={vi.fn()} />);
    expect(await screen.findByTestId("workflow-coach")).toHaveTextContent("Generate clean images");

    rerender(<WorkflowCoach storyName="god-cell" fileName="plot-02.md" authFetch={authFetch} onAction={vi.fn()} />);
    // The previous episode's coach must not linger under the new file after a failed load.
    await waitFor(() => expect(screen.queryByTestId("workflow-coach")).not.toBeInTheDocument());
  });
});

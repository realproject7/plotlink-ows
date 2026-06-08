// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CartoonWorkflowNav } from "./CartoonWorkflowNav";

afterEach(cleanup);

describe("CartoonWorkflowNav (#439)", () => {
  it("renders the simplified cartoon workflow tabs and marks the active one", () => {
    render(<CartoonWorkflowNav storyTitle="신의 세포" active="story-info" onSelect={vi.fn()} />);
    for (const key of ["progress", "story-info", "episodes", "publish"]) {
      expect(screen.getByTestId(`nav-tab-${key}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("nav-tab-whitepaper")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-tab-genesis")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-tab-story-info")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("nav-tab-progress")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("cartoon-workflow-nav")).toHaveTextContent("신의 세포");
  });

  it("routes a tab click to onSelect with its key", () => {
    const onSelect = vi.fn();
    render(<CartoonWorkflowNav storyTitle="god-cell" active="progress" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("nav-tab-episodes"));
    expect(onSelect).toHaveBeenCalledWith("episodes");
    fireEvent.click(screen.getByTestId("nav-tab-publish"));
    expect(onSelect).toHaveBeenCalledWith("publish");
  });
});

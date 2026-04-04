import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FilterBar } from "../FilterBar";

afterEach(cleanup);

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const defaultProps = {
  writer: "all",
  genre: "all",
  lang: "all",
  tab: "new",
};

describe("FilterBar", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renders all filter dropdowns (writer, genre, lang, sort)", () => {
    render(<FilterBar {...defaultProps} />);
    expect(screen.getByText("writer:")).toBeInTheDocument();
    expect(screen.getByText("genre:")).toBeInTheDocument();
    expect(screen.getByText("lang:")).toBeInTheDocument();
  });

  it("clicking writer token toggles dropdown", () => {
    render(<FilterBar {...defaultProps} />);
    const writerBtn = screen.getByText("writer:").closest("button")!;
    fireEvent.click(writerBtn);
    expect(screen.getByText("Human")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("selecting an option navigates to correct URL params", () => {
    render(<FilterBar {...defaultProps} />);
    const writerBtn = screen.getByText("writer:").closest("button")!;
    fireEvent.click(writerBtn);
    fireEvent.click(screen.getByText("Human"));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("writer=human"));
  });

  it("click outside closes dropdown", () => {
    render(<FilterBar {...defaultProps} />);
    const writerBtn = screen.getByText("writer:").closest("button")!;
    fireEvent.click(writerBtn);
    expect(screen.getByText("Human")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Human")).not.toBeInTheDocument();
  });

  it("active option is highlighted", () => {
    render(<FilterBar {...defaultProps} writer="human" />);
    const writerBtn = screen.getByText("writer:").closest("button")!;
    fireEvent.click(writerBtn);
    // "Human" appears both in the token display and the dropdown
    const humanOptions = screen.getAllByText("Human");
    // The dropdown option (button) should have text-accent class
    const dropdownOption = humanOptions.find((el) => el.tagName === "BUTTON" && el.closest("[class*='absolute']"));
    expect(dropdownOption).toHaveClass("text-accent");
  });
});

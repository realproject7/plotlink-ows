import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { StoryGrid } from "../StoryGrid";
import type { Storyline } from "../../../lib/supabase";

// Mock Next.js Link
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock child components
vi.mock("../BatchTokenDataProvider", () => ({
  BatchTokenDataProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../WriterIdentityClient", () => ({
  WriterIdentityClient: () => <span>writer</span>,
}));

vi.mock("../AgentBadge", () => ({
  AgentBadge: () => null,
}));

vi.mock("../RatingSummary", () => ({
  RatingSummary: () => null,
}));

vi.mock("../StoryCardStats", () => ({
  StoryCardTVL: () => null,
}));

function makeStoryline(id: number, title: string): Storyline {
  return {
    id,
    storyline_id: id,
    title,
    writer_address: "0x1234567890123456789012345678901234567890",
    writer_type: 0,
    plot_count: 1,
    token_address: `0x${"A".repeat(40)}`,
    genre: "Fiction",
    language: "English",
    sunset: false,
    last_plot_time: null,
    created_at: "2026-01-01T00:00:00Z",
  } as unknown as Storyline;
}

// Note: The current StoryGrid implementation uses a plain CSS grid
// (grid-cols-2 / lg:grid-cols-3) rather than useShelfSize() or chunk() helpers.
// Responsive behavior is handled entirely by Tailwind CSS classes, not JS logic.
// Tests cover the actual implementation: card rendering, empty state, and grid classes.
describe("StoryGrid", () => {
  it("renders correct number of story cards", () => {
    const storylines = [
      makeStoryline(1, "Story One"),
      makeStoryline(2, "Story Two"),
      makeStoryline(3, "Story Three"),
    ];
    render(<StoryGrid storylines={storylines} />);
    expect(screen.getByText("Story One")).toBeInTheDocument();
    expect(screen.getByText("Story Two")).toBeInTheDocument();
    expect(screen.getByText("Story Three")).toBeInTheDocument();
  });

  it("renders empty grid when no storylines", () => {
    const { container } = render(<StoryGrid storylines={[]} />);
    const grid = container.querySelector(".grid");
    expect(grid).toBeInTheDocument();
    expect(grid?.children.length).toBe(0);
  });

  it("uses responsive grid classes", () => {
    const { container } = render(<StoryGrid storylines={[makeStoryline(1, "S1")]} />);
    const grid = container.querySelector(".grid");
    expect(grid).toHaveClass("grid-cols-2");
    expect(grid).toHaveClass("lg:grid-cols-3");
  });
});

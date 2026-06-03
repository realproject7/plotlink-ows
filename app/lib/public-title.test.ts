import { describe, it, expect } from "vitest";
import { extractOgTitle, leadingTitleSegment } from "./public-title";

// Real page shapes captured from plotlink.xyz for the #379 pilot story #59.
const PLOT_PAGE = `<!DOCTYPE html><html><head><title>plot-01 — genesis — PlotLink</title>` +
  `<meta property="og:title" content="plot-01 — genesis"/>` +
  `<meta name="twitter:title" content="PlotLink"/></head><body>…</body></html>`;
const STORYLINE_PAGE = `<!DOCTYPE html><html><head><title>genesis — PlotLink</title>` +
  `<meta property="og:title" content="genesis"/></head><body>…</body></html>`;
const GOOD_PLOT_PAGE = `<head><title>The Couple Coupon — Coupon Crush — PlotLink</title>` +
  `<meta property="og:title" content="The Couple Coupon — Coupon Crush"/></head>`;
const NUMBERED_GOOD_PLOT_PAGE = `<head><title>Episode 1 — The Couple Coupon — Coupon Crush — PlotLink</title>` +
  `<meta property="og:title" content="Episode 1 — The Couple Coupon — Coupon Crush"/></head>`;
const STORYLINE_WITH_DASH = "Coupon Crush — Season One";
const PLOT_WITH_DASHED_STORYLINE_PAGE = `<head><title>The Couple Coupon — ${STORYLINE_WITH_DASH} — PlotLink</title>` +
  `<meta property="og:title" content="The Couple Coupon — ${STORYLINE_WITH_DASH}"/></head>`;

describe("extractOgTitle (#379)", () => {
  it("reads og:title from a plot page (real shape)", () => {
    expect(extractOgTitle(PLOT_PAGE)).toBe("plot-01 — genesis");
  });
  it("reads og:title from a storyline page (real shape)", () => {
    expect(extractOgTitle(STORYLINE_PAGE)).toBe("genesis");
  });
  it("falls back to <title> minus the ' — PlotLink' suffix when og:title is absent", () => {
    expect(extractOgTitle(`<head><title>genesis — PlotLink</title></head>`)).toBe("genesis");
    expect(extractOgTitle(`<head><title>plot-01 — genesis — PlotLink</title></head>`)).toBe("plot-01 — genesis");
  });
  it("decodes HTML entities in the title", () => {
    expect(extractOgTitle(`<meta property="og:title" content="Tom &amp; Jerry"/>`)).toBe("Tom & Jerry");
  });
  it("returns null when the page has no title metadata", () => {
    expect(extractOgTitle(`<head></head>`)).toBeNull();
  });
});

describe("leadingTitleSegment (#379)", () => {
  it("returns the plot title (leading segment) from a plot page og:title", () => {
    expect(leadingTitleSegment(extractOgTitle(PLOT_PAGE))).toBe("plot-01");
    expect(leadingTitleSegment(extractOgTitle(GOOD_PLOT_PAGE))).toBe("The Couple Coupon");
    expect(leadingTitleSegment(extractOgTitle(NUMBERED_GOOD_PLOT_PAGE))).toBe("Episode 1 — The Couple Coupon");
  });
  it("strips the exact storyline suffix when the storyline title itself contains an em dash (#396)", () => {
    expect(leadingTitleSegment(extractOgTitle(PLOT_WITH_DASHED_STORYLINE_PAGE), STORYLINE_WITH_DASH)).toBe("The Couple Coupon");
  });
  it("returns the whole value when there is no separator", () => {
    expect(leadingTitleSegment("genesis")).toBe("genesis");
  });
  it("returns null for empty/missing input", () => {
    expect(leadingTitleSegment(null)).toBeNull();
    expect(leadingTitleSegment("")).toBeNull();
  });
});

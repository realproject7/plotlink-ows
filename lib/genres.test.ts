import { describe, it, expect } from "vitest";
import { canonicalizeGenre, GENRES } from "./genres";

describe("canonicalizeGenre (#412)", () => {
  it("maps the Sci-Fi alias family to the canonical Science Fiction", () => {
    for (const input of ["Sci-Fi", "SciFi", "sci fi", "SF", "sf"]) {
      expect(canonicalizeGenre(input)).toBe("Science Fiction");
    }
  });

  it("accepts a valid canonical genre (case/punctuation-insensitive)", () => {
    expect(canonicalizeGenre("Science Fiction")).toBe("Science Fiction");
    expect(canonicalizeGenre("science fiction")).toBe("Science Fiction");
    expect(canonicalizeGenre("  ROMANCE  ")).toBe("Romance");
    // Canonical labels that carry punctuation still resolve via their key.
    expect(canonicalizeGenre("non fiction")).toBe("Non-Fiction");
    expect(canonicalizeGenre("LGBTQ+")).toBe("LGBTQ+");
  });

  it("resolves a few other common natural aliases", () => {
    expect(canonicalizeGenre("comedy")).toBe("Humor");
    expect(canonicalizeGenre("YA")).toBe("Teen Fiction");
    expect(canonicalizeGenre("lgbt")).toBe("LGBTQ+");
    expect(canonicalizeGenre("historical")).toBe("Historical Fiction");
  });

  it("returns null for blank or unmappable input", () => {
    expect(canonicalizeGenre("")).toBeNull();
    expect(canonicalizeGenre("   ")).toBeNull();
    expect(canonicalizeGenre(null)).toBeNull();
    expect(canonicalizeGenre(undefined)).toBeNull();
    expect(canonicalizeGenre("Definitely Not A Genre")).toBeNull();
  });

  it("every canonical genre maps to itself", () => {
    for (const g of GENRES) {
      expect(canonicalizeGenre(g)).toBe(g);
    }
  });
});

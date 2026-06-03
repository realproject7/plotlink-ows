export const GENRES = [
  "Romance",
  "Fantasy",
  "Science Fiction",
  "Mystery",
  "Thriller",
  "Horror",
  "Adventure",
  "Historical Fiction",
  "Contemporary Lit",
  "Humor",
  "Poetry",
  "Non-Fiction",
  "Fanfiction",
  "Short Story",
  "Paranormal",
  "Werewolf",
  "LGBTQ+",
  "New Adult",
  "Teen Fiction",
  "Diverse Lit",
  "Others",
] as const;

export const LANGUAGES = [
  "English",
  "Chinese",
  "Korean",
  "Japanese",
  "Spanish",
  "French",
  "Hindi",
  "Arabic",
  "Portuguese",
  "Russian",
  "Others",
] as const;

export const CONTENT_TYPES = ["fiction", "cartoon"] as const;

export type Genre = (typeof GENRES)[number];
export type Language = (typeof LANGUAGES)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Punctuation/spacing/case-insensitive key for matching a free-form genre label
 * to a canonical value. Strips everything but letters, digits and `+` (so
 * `LGBTQ+` survives), which collapses `Sci-Fi`, `sci fi`, `SciFi` → `scifi` and
 * `Science Fiction` / `science-fiction` → `sciencefiction`.
 */
function genreKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9+]/g, "");
}

const CANONICAL_GENRE_BY_KEY: Record<string, Genre> = Object.fromEntries(
  GENRES.map((g) => [genreKey(g), g]),
) as Record<string, Genre>;

/**
 * Common natural-language genre aliases → canonical PlotLink value (#412). Keyed
 * by `genreKey`, so each entry already covers punctuation/spacing/case variants
 * (e.g. the `scifi` key matches `Sci-Fi`, `Sci Fi`, `SciFi`). Canonical labels and
 * their punctuation variants (e.g. `non fiction` → `Non-Fiction`) are handled by
 * `CANONICAL_GENRE_BY_KEY` and don't need an alias here.
 */
const GENRE_ALIAS_BY_KEY: Record<string, Genre> = {
  scifi: "Science Fiction",
  sf: "Science Fiction",
  comedy: "Humor",
  humour: "Humor",
  ya: "Teen Fiction",
  youngadult: "Teen Fiction",
  lgbt: "LGBTQ+",
  lgbtq: "LGBTQ+",
  "lgbtqia+": "LGBTQ+",
  historical: "Historical Fiction",
  scary: "Horror",
};

/**
 * Map a free-form genre label to its canonical PlotLink value, or `null` if it
 * can't be resolved (#412). PlotLink's metadata update rejects non-canonical
 * genres (e.g. `Sci-Fi` → `Invalid genre`), which once left a published pilot
 * `UNCATEGORIZED`; callers normalize through this before sending metadata and
 * surface a clear local error when it returns `null`. Empty/blank input → `null`.
 */
export function canonicalizeGenre(input: string | null | undefined): Genre | null {
  if (!input) return null;
  const key = genreKey(input.trim());
  if (!key) return null;
  return CANONICAL_GENRE_BY_KEY[key] ?? GENRE_ALIAS_BY_KEY[key] ?? null;
}

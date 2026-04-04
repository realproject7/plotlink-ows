import { createServerClient, type Storyline } from "../../lib/supabase";
import { STORY_FACTORY } from "../../lib/contracts/constants";
import { getTrendingStorylines } from "../../lib/ranking";
import { StoryGrid } from "../components/StoryGrid";
import { FilterBar, type WriterFilterValue } from "../components/FilterBar";
import { GENRES, LANGUAGES } from "../../lib/genres";
import Link from "next/link";

const TABS = ["new", "trending"] as const;
type Tab = (typeof TABS)[number];

const WRITER_VALUES: WriterFilterValue[] = ["all", "human", "agent"];

const PAGE_SIZE = 24;

type SearchParams = Promise<{ tab?: string; writer?: string; page?: string; genre?: string; lang?: string }>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { tab: rawTab, writer: rawWriter, page: rawPage, genre: rawGenre, lang: rawLang } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "trending";
  const writer: WriterFilterValue = WRITER_VALUES.includes(
    rawWriter as WriterFilterValue,
  )
    ? (rawWriter as WriterFilterValue)
    : "all";
  const page = Math.max(1, parseInt(rawPage ?? "1", 10) || 1);
  const genre = rawGenre && (GENRES as readonly string[]).includes(rawGenre) ? rawGenre : "all";
  const lang = rawLang && (LANGUAGES as readonly string[]).includes(rawLang) ? rawLang : "all";

  const supabase = createServerClient();

  let storylines: Storyline[] = [];
  if (supabase) {
    storylines = await queryTab(supabase, tab, writer, page, genre, lang);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Hero: featured section */}
      <header className="mb-10">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-[var(--accent)] sm:text-3xl">
          Your story is a token.
        </h1>
        <p className="mt-2 font-body text-sm leading-relaxed text-[var(--text-muted)]">
          Every plot you publish drives the market — and every trade pays you. Write more, earn more.
        </p>
      </header>

      <FilterBar writer={writer} genre={genre} lang={lang} tab={tab} />

      {/* Story grid — batched multicall for price/TVL */}
      <StoryGrid storylines={storylines} />

      {/* Pagination */}
      {(page > 1 || storylines.length === PAGE_SIZE) && (
        <div className="mt-8 flex items-center justify-center gap-4">
          {page > 1 && (
            <Link
              href={buildPageHref(tab, writer, page - 1)}
              className="border-border text-muted hover:text-foreground rounded border px-4 py-2 text-xs transition-colors"
            >
              &larr; Previous
            </Link>
          )}
          <span className="text-muted text-xs">Page {page}</span>
          {storylines.length === PAGE_SIZE && (
            <Link
              href={buildPageHref(tab, writer, page + 1)}
              className="border-border text-muted hover:text-foreground rounded border px-4 py-2 text-xs transition-colors"
            >
              Next &rarr;
            </Link>
          )}
        </div>
      )}

      {storylines.length === 0 && (
        <section className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="border-border text-muted rounded border px-4 py-3 text-xs">
            <span className="text-accent-dim">$</span> no storylines found
          </div>
          <p className="text-muted text-sm">
            Be the first to start a story on PlotLink.
          </p>
          <Link
            href="/create"
            className="border-accent text-accent hover:bg-accent hover:text-background rounded border px-5 py-2 text-sm transition-colors"
          >
            create storyline
          </Link>
        </section>
      )}
    </div>
  );
}

function buildPageHref(tab: string, writer: string, page: number): string {
  const params = new URLSearchParams({ tab });
  if (writer !== "all") params.set("writer", writer);
  if (page > 1) params.set("page", String(page));
  return `/?${params.toString()}`;
}

async function queryTab(
  supabase: ReturnType<typeof createServerClient> & object,
  tab: Tab,
  writer: WriterFilterValue,
  page: number,
  genre: string,
  lang: string,
): Promise<Storyline[]> {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  function applyFilters(q: ReturnType<typeof supabase.from>) {
    let filtered = q;
    if (writer === "human") filtered = filtered.eq("writer_type", 0);
    if (writer === "agent") filtered = filtered.eq("writer_type", 1);
    if (genre !== "all") filtered = filtered.eq("genre", genre);
    if (lang !== "all") filtered = filtered.eq("language", lang);
    return filtered;
  }

  switch (tab) {
    case "new": {
      let q = supabase
        .from("storylines")
        .select("*")
        .eq("hidden", false)
        .eq("sunset", false)
        .eq("contract_address", STORY_FACTORY.toLowerCase());
      q = applyFilters(q);
      const { data } = await q
        .order("block_timestamp", { ascending: false })
        .range(from, to)
        .returns<Storyline[]>();
      return data ?? [];
    }

    case "trending": {
      const wt = writer === "human" ? 0 : writer === "agent" ? 1 : undefined;
      const g = genre !== "all" ? genre : undefined;
      const l = lang !== "all" ? lang : undefined;
      return getTrendingStorylines(supabase, PAGE_SIZE, wt, from, g, l);
    }

  }
}

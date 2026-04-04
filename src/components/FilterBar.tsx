"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GENRES, LANGUAGES } from "../../lib/genres";

const WRITER_OPTIONS = ["All", "Human", "AI"] as const;
const SORT_OPTIONS = [
  { value: "new", label: "Recent" },
  { value: "trending", label: "Trending" },
] as const;

export type WriterFilterValue = "all" | "human" | "agent";

type FilterKey = "writer" | "genre" | "lang" | "sort";

interface FilterBarProps {
  writer: string;
  genre: string;
  lang: string;
  tab: string;
}

function buildHref(params: { tab: string; writer: string; genre: string; lang: string }) {
  const sp = new URLSearchParams({ tab: params.tab });
  if (params.writer !== "all") sp.set("writer", params.writer);
  if (params.genre !== "all") sp.set("genre", params.genre);
  if (params.lang !== "all") sp.set("lang", params.lang);
  return `/?${sp.toString()}`;
}

function writerDisplay(v: string) {
  if (v === "agent") return "AI";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function sortLabel(tab: string) {
  return SORT_OPTIONS.find((o) => o.value === tab)?.label ?? "Recent";
}

export function FilterBar({ writer, genre, lang, tab }: FilterBarProps) {
  const [open, setOpen] = useState<FilterKey | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Restore saved language preference on first visit (no lang param in URL)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("lang")) return; // explicit param — don't override
    try {
      const saved = localStorage.getItem("plotlink_lang");
      if (saved && saved !== "all" && (LANGUAGES as readonly string[]).includes(saved)) {
        router.replace(buildHref({ tab, writer, genre, lang: saved }));
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key: FilterKey) {
    setOpen(open === key ? null : key);
  }

  function navigate(params: { tab: string; writer: string; genre: string; lang: string }) {
    setOpen(null);
    try { localStorage.setItem("plotlink_lang", params.lang); } catch {}
    router.push(buildHref(params));
  }

  return (
    <div ref={barRef}>
      <div className="border-border flex min-w-0 items-center gap-x-3 rounded border px-3 py-2 text-xs">
        {/* Writer token + dropdown */}
        <div className="relative min-w-0">
          <Token
            label="writer"
            shortLabel="W"
            value={writerDisplay(writer)}
            active={open === "writer"}
            onClick={() => toggle("writer")}
          />
          {open === "writer" && (
            <Dropdown>
              {WRITER_OPTIONS.map((opt) => {
                const val = opt.toLowerCase() === "ai" ? "agent" : opt.toLowerCase();
                return (
                  <DropdownItem
                    key={val}
                    label={opt}
                    active={writer === val}
                    onClick={() => navigate({ tab, writer: val, genre, lang })}
                  />
                );
              })}
            </Dropdown>
          )}
        </div>

        {/* Genre token + dropdown */}
        <div className="relative min-w-0">
          <Token
            label="genre"
            shortLabel="G"
            value={genre === "all" ? "All" : genre}
            active={open === "genre"}
            onClick={() => toggle("genre")}
          />
          {open === "genre" && (
            <Dropdown>
              <DropdownItem
                label="All genres"
                active={genre === "all"}
                onClick={() => navigate({ tab, writer, genre: "all", lang })}
              />
              {GENRES.map((g) => (
                <DropdownItem
                  key={g}
                  label={g}
                  active={genre === g}
                  onClick={() => navigate({ tab, writer, genre: g, lang })}
                />
              ))}
            </Dropdown>
          )}
        </div>

        {/* Language token + dropdown */}
        <div className="relative min-w-0">
          <Token
            label="lang"
            shortLabel="L"
            value={lang === "all" ? "All" : lang}
            active={open === "lang"}
            onClick={() => toggle("lang")}
          />
          {open === "lang" && (
            <Dropdown>
              <DropdownItem
                label="All languages"
                active={lang === "all"}
                onClick={() => navigate({ tab, writer, genre, lang: "all" })}
              />
              {LANGUAGES.map((l) => (
                <DropdownItem
                  key={l}
                  label={l}
                  active={lang === l}
                  onClick={() => navigate({ tab, writer, genre, lang: l })}
                />
              ))}
            </Dropdown>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sort token + dropdown */}
        <div className="relative shrink-0">
          <button
            onClick={() => toggle("sort")}
            className={`text-muted hover:text-foreground transition-colors ${open === "sort" ? "text-accent" : ""}`}
          >
            <span className="sm:hidden">{"\u2195"}</span>
            <span className="hidden sm:inline">
              <span className="text-muted">sort:</span>
              <span className="text-accent">{sortLabel(tab)}</span>
            </span>
          </button>
          {open === "sort" && (
            <Dropdown align="right">
              {SORT_OPTIONS.map(({ value, label }) => (
                <DropdownItem
                  key={value}
                  label={label}
                  active={tab === value}
                  onClick={() => navigate({ tab: value, writer, genre, lang })}
                />
              ))}
            </Dropdown>
          )}
        </div>
      </div>
    </div>
  );
}

function Token({
  label,
  shortLabel,
  value,
  active,
  onClick,
}: {
  label: string;
  shortLabel: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap px-1 py-0.5 transition-colors hover:bg-[var(--border)]/30 ${active ? "bg-[var(--accent)]/10" : ""}`}
    >
      <span className="text-[var(--text-muted)] sm:hidden">{shortLabel}:</span>
      <span className="text-[var(--text-muted)] hidden sm:inline">{label}:</span>
      <span className="font-semibold text-[var(--accent)]">{value}</span>
    </button>
  );
}

function Dropdown({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <div
      className={`border-border bg-[var(--bg)] absolute top-full z-20 mt-1 max-h-60 overflow-y-auto rounded border py-1 shadow-lg ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </div>
  );
}

function DropdownItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full whitespace-nowrap px-4 py-1.5 text-left text-xs transition-colors ${
        active ? "text-accent bg-accent/10" : "text-muted hover:text-foreground hover:bg-[var(--border)]/30"
      }`}
    >
      {label}
    </button>
  );
}

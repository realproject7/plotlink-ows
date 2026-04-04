"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select...",
  disabled = false,
  className = "",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const allOptions = useMemo(
    () => (placeholder ? [{ value: "", label: placeholder }, ...options] : options),
    [placeholder, options],
  );

  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? placeholder;

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[focusIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, focusIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      if (!open) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setOpen(true);
          setFocusIndex(0);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((i) => Math.min(i + 1, allOptions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusIndex >= 0 && focusIndex < allOptions.length && !allOptions[focusIndex].disabled) {
            onChange(allOptions[focusIndex].value);
            setOpen(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [disabled, open, allOptions, focusIndex, onChange],
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-border bg-surface text-foreground w-full rounded border px-3 pr-10 py-2 text-left text-sm focus:border-accent focus:outline-none disabled:opacity-50"
      >
        <span className={value ? "" : "text-muted"}>{selectedLabel}</span>
        <svg
          className="text-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          onKeyDown={handleKeyDown}
          className="border-border bg-surface absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded border py-1 shadow-lg"
        >
          {allOptions.map((opt, i) => (
            <li
              key={opt.value === "" ? "__placeholder__" : opt.value}
              role="option"
              aria-selected={opt.value === value}
              onMouseEnter={() => setFocusIndex(i)}
              onClick={() => {
                if (opt.disabled) return;
                onChange(opt.value);
                setOpen(false);
              }}
              className={`px-3 py-2 text-sm ${
                opt.disabled
                  ? "text-muted opacity-50 cursor-default"
                  : opt.value === value
                    ? "bg-accent text-background cursor-pointer"
                    : i === focusIndex
                      ? "bg-border/50 text-foreground cursor-pointer"
                      : opt.value === ""
                        ? "text-muted hover:bg-border/30 cursor-pointer"
                        : "text-foreground hover:bg-border/30 cursor-pointer"
              }`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

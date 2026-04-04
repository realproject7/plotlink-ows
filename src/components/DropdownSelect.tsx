"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface DropdownSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function DropdownSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  size = "md",
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? "Select...";

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

  // Scroll focused item into view
  useEffect(() => {
    if (!open || focusIdx < 0 || !listRef.current) return;
    const items = listRef.current.children;
    if (items[focusIdx]) {
      (items[focusIdx] as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [focusIdx, open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (!open) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setOpen(true);
          setFocusIdx(options.findIndex((o) => o.value === value));
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusIdx((i) => Math.min(i + 1, options.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIdx((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusIdx >= 0 && focusIdx < options.length) {
            onChange(options[focusIdx].value);
            setOpen(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [open, focusIdx, options, value, onChange, disabled],
  );

  const sizeClasses =
    size === "sm"
      ? "px-2 py-1 text-xs"
      : "px-3 py-2 text-sm";

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
        className={`border-border bg-surface flex w-full items-center justify-between rounded border ${sizeClasses} transition-colors focus:border-accent focus:outline-none disabled:opacity-50 ${
          selected ? "text-foreground" : "text-muted"
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="text-muted ml-2 text-[10px]">{open ? "\u25B2" : "\u25BC"}</span>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="border-border bg-surface absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded border shadow-lg"
        >
          {options.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              onMouseEnter={() => setFocusIdx(i)}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`cursor-pointer ${sizeClasses} transition-colors ${
                opt.value === value
                  ? "text-accent font-medium"
                  : focusIdx === i
                    ? "bg-accent/10 text-foreground"
                    : "text-muted hover:text-foreground"
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

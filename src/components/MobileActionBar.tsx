"use client";

import { useState, type ReactNode } from "react";
import { usePlatformDetection } from "../hooks/usePlatformDetection";

type Panel = "trade" | "donate" | "rate" | null;

export function MobileActionBar({
  tradeContent,
  donateContent,
  rateContent,
}: {
  tradeContent?: ReactNode;
  donateContent: ReactNode;
  rateContent?: ReactNode;
}) {
  const [open, setOpen] = useState<Panel>(null);
  const { isMiniApp } = usePlatformDetection();

  const buttons: { key: Panel; label: string; content?: ReactNode }[] = [
    { key: "trade", label: "Trade", content: tradeContent },
    { key: "donate", label: "Donate", content: donateContent },
    { key: "rate", label: "Rate", content: rateContent },
  ].filter((b) => b.content != null) as { key: Panel; label: string; content: ReactNode }[];

  return (
    <div className="lg:hidden">
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={() => setOpen(null)}
        />
      )}

      {/* Bottom sheet */}
      {open && (
        <div className={`fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-lg border-t border-[var(--border)] bg-[var(--bg)] p-4 ${isMiniApp ? "pb-10" : "pb-[calc(1rem+env(safe-area-inset-bottom))]"}`}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-foreground text-sm font-medium capitalize">
              {open}
            </span>
            <button
              onClick={() => setOpen(null)}
              className="text-muted hover:text-foreground text-xs transition-colors"
            >
              [close]
            </button>
          </div>
          <div className="space-y-4">
            {buttons.find((b) => b.key === open)?.content}
          </div>
        </div>
      )}

      {/* Fixed bottom bar */}
      <div className={`fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-2 border-t border-[var(--border)] bg-[var(--bg)]/95 px-3 pt-3 ${isMiniApp ? "pb-8" : "pb-[calc(0.75rem+env(safe-area-inset-bottom))]"} backdrop-blur-sm`}>
        {buttons.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setOpen(open === key ? null : key)}
            className={`rounded px-3 py-2 text-xs transition-colors ${
              open === key
                ? "border-2 border-accent text-accent font-semibold"
                : key === "trade"
                  ? "border-2 border-accent text-accent font-bold hover:opacity-80"
                  : "border border-[var(--border)] text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { StoryContent } from "./StoryContent";
import { usePlatformDetection } from "../hooks/usePlatformDetection";

interface Chapter {
  plotIndex: number;
  title: string;
  content: string | null;
}

interface ReadingModeProps {
  storylineId: number;
  storylineTitle: string;
  chapters: Chapter[];
  initialChapterIndex: number;
  onClose: () => void;
}

export function ReadingMode({
  storylineId,
  storylineTitle,
  chapters,
  initialChapterIndex,
  onClose,
}: ReadingModeProps) {
  const [currentIdx, setCurrentIdx] = useState(initialChapterIndex);
  const [showToc, setShowToc] = useState(false);
  const [flipDir, setFlipDir] = useState<"left" | "right" | null>(null);
  const [outgoingIdx, setOutgoingIdx] = useState<number | null>(null);
  const [outgoingScroll, setOutgoingScroll] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const flipping = useRef(false);
  const { isMiniApp } = usePlatformDetection();

  const chapter = chapters[currentIdx];
  const outgoingChapter = outgoingIdx !== null ? chapters[outgoingIdx] : null;
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx < chapters.length - 1;

  const scrollToTop = useCallback(() => {
    contentRef.current?.scrollTo(0, 0);
  }, []);

  const navigate = useCallback((idx: number, dir: "left" | "right" | null) => {
    if (flipping.current) return;
    flipping.current = true;
    // Capture scroll offset so the outgoing page can render at its old position
    const scrollOffset = contentRef.current?.scrollTop ?? 0;
    setOutgoingScroll(scrollOffset);
    // Freeze container height so layout is stable during the flip
    if (stackRef.current) {
      stackRef.current.style.minHeight = `${stackRef.current.offsetHeight}px`;
    }
    // Set outgoing, swap to incoming, and scroll to top immediately
    setOutgoingIdx(currentIdx);
    setFlipDir(dir);
    setCurrentIdx(idx);
    scrollToTop();
    // After animation: unfreeze height, clean up
    setTimeout(() => {
      if (stackRef.current) {
        stackRef.current.style.minHeight = "";
      }
      setOutgoingIdx(null);
      setFlipDir(null);
      flipping.current = false;
    }, 500);
  }, [currentIdx, scrollToTop]);

  const goPrev = useCallback(() => {
    if (hasPrev) navigate(currentIdx - 1, "right");
  }, [hasPrev, currentIdx, navigate]);

  const goNext = useCallback(() => {
    if (hasNext) navigate(currentIdx + 1, "left");
  }, [hasNext, currentIdx, navigate]);

  const goToChapter = useCallback((idx: number) => {
    setShowToc(false);
    navigate(idx, idx > currentIdx ? "left" : "right");
  }, [currentIdx, navigate]);

  // Esc to close, arrow keys for navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showToc) setShowToc(false);
        else onClose();
      }
      if (e.key === "ArrowLeft" && hasPrev) goPrev();
      if (e.key === "ArrowRight" && hasNext) goNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, hasPrev, hasNext, goPrev, goNext, showToc]);

  // Lock body scroll when overlay is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--paper-bg, #F5F0E8)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 sm:px-6" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="min-w-0 flex-1">
          <p className="text-muted truncate text-xs">{storylineTitle}</p>
          <p className="text-foreground truncate text-sm font-medium">
            {chapter?.title || `Chapter ${chapter?.plotIndex ?? 0}`}
          </p>
        </div>
        <div className="ml-4 flex items-center gap-3">
          <span className="text-muted text-[11px]">
            {currentIdx + 1} / {chapters.length}
          </span>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-lg transition-colors"
            title="Exit reading mode (Esc)"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        ref={contentRef}
        className="page-flip-container flex-1 overflow-y-auto overflow-x-hidden"
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0].clientX;
          touchStartY.current = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          const dy = e.changedTouches[0].clientY - touchStartY.current;
          // Only trigger if horizontal swipe exceeds threshold and is more horizontal than vertical
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) goNext();
            else goPrev();
          }
        }}
      >
        <div ref={stackRef} className="page-flip-stack">
          {/* Incoming page (underneath) */}
          <div className={`page-flip-page ${outgoingIdx !== null ? "page-incoming" : ""}`}>
            <div className="mx-auto max-w-[720px] px-6 py-8 sm:px-8 sm:py-12">
              {chapter?.content ? (
                <StoryContent content={chapter.content} />
              ) : (
                <p className="text-muted text-sm italic">Content unavailable</p>
              )}
            </div>
          </div>

          {/* Outgoing page (on top, flipping away at its old scroll offset) */}
          {outgoingChapter && flipDir && (
            <div
              className={`page-flip-page page-outgoing ${
                flipDir === "left" ? "page-flip-out-left" : "page-flip-out-right"
              }`}
              style={{
                background: "var(--paper-bg, #F5F0E8)",
                top: `-${outgoingScroll}px`,
              }}
            >
              <div className="mx-auto max-w-[720px] px-6 py-8 sm:px-8 sm:py-12">
                {outgoingChapter.content ? (
                  <StoryContent content={outgoingChapter.content} />
                ) : (
                  <p className="text-muted text-sm italic">Content unavailable</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom navigation */}
      <nav
        className={`flex items-center justify-between px-4 pt-3 ${isMiniApp ? "pb-8" : "pb-[calc(0.75rem+env(safe-area-inset-bottom))]"} sm:px-6`}
        style={{ borderTop: "1px solid var(--border)" }}
      >
        {hasPrev ? (
          <button
            onClick={goPrev}
            className="text-muted hover:text-accent rounded px-3 py-2 text-xs font-medium transition-colors"
          >
            &larr; Prev
          </button>
        ) : (
          <span className="w-16" />
        )}

        <button
          onClick={() => setShowToc(!showToc)}
          className="text-muted hover:text-accent rounded px-3 py-2 text-xs font-medium transition-colors"
        >
          Contents
        </button>

        {hasNext ? (
          <button
            onClick={goNext}
            className="text-muted hover:text-accent rounded px-3 py-2 text-xs font-medium transition-colors"
          >
            Next &rarr;
          </button>
        ) : (
          <span className="w-16" />
        )}
      </nav>

      {/* Table of Contents overlay */}
      {showToc && (
        <div
          className="fixed inset-0 z-60 flex items-end justify-center sm:items-center"
          onClick={() => setShowToc(false)}
        >
          <div
            className="border-border w-full max-w-md rounded-t-lg border sm:rounded-lg"
            style={{ background: "var(--paper-bg, #F5F0E8)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-foreground text-sm font-medium">Table of Contents</h3>
              <button
                onClick={() => setShowToc(false)}
                className="text-muted hover:text-foreground transition-colors"
              >
                &times;
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {chapters.map((ch, idx) => (
                <button
                  key={ch.plotIndex}
                  onClick={() => goToChapter(idx)}
                  className={`w-full rounded px-3 py-2 text-left text-xs transition-colors ${
                    idx === currentIdx
                      ? "bg-accent/10 text-accent font-medium"
                      : "text-foreground hover:bg-accent/5"
                  }`}
                >
                  <span className="text-muted mr-2">
                    {ch.plotIndex === 0 ? "G" : ch.plotIndex}.
                  </span>
                  {ch.title || (ch.plotIndex === 0 ? "Genesis" : `Chapter ${ch.plotIndex}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Button to enter reading mode. Place near story content.
 */
export function ReadingModeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="border-border text-muted hover:text-accent hover:border-accent flex items-center gap-1.5 rounded border px-3 py-1.5 text-[11px] font-medium transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
      Reading Mode
    </button>
  );
}

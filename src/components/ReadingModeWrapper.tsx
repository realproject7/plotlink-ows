"use client";

import { useState } from "react";
import { ReadingMode, ReadingModeButton } from "./ReadingMode";

interface Chapter {
  plotIndex: number;
  title: string;
  content: string | null;
}

/**
 * Client wrapper that manages reading mode state.
 * Receives serialized chapter data from server components.
 */
export function ReadingModeWrapper({
  storylineId,
  storylineTitle,
  chapters,
  initialPlotIndex,
}: {
  storylineId: number;
  storylineTitle: string;
  chapters: Chapter[];
  initialPlotIndex: number;
}) {
  const [active, setActive] = useState(false);

  const initialIdx = chapters.findIndex(
    (ch) => ch.plotIndex === initialPlotIndex,
  );

  return (
    <>
      <ReadingModeButton onClick={() => setActive(true)} />
      {active && (
        <ReadingMode
          storylineId={storylineId}
          storylineTitle={storylineTitle}
          chapters={chapters}
          initialChapterIndex={initialIdx >= 0 ? initialIdx : 0}
          onClose={() => setActive(false)}
        />
      )}
    </>
  );
}

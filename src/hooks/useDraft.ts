"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const DEBOUNCE_MS = 1000;

/**
 * Auto-save and restore draft content from localStorage.
 * Debounces writes by 1 second. Returns restore/discard helpers.
 */
export function useDraft<T extends Record<string, unknown>>(
  key: string,
  currentValues: T,
  setters: { [K in keyof T]: (val: T[K]) => void },
) {
  const [restored, setRestored] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasContent = useRef(false);
  const prevKeyRef = useRef(key);

  // Restore on mount or key change; reset fields if no draft for new key
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        // Key changed and no draft exists — reset fields to prevent stale saves
        if (prevKeyRef.current !== key) {
          for (const k of Object.keys(setters) as (keyof T)[]) {
            (setters[k] as (val: unknown) => void)("");
          }
        }
        prevKeyRef.current = key;
        return;
      }
      const saved = JSON.parse(raw) as Partial<T>;
      let didRestore = false;
      for (const k of Object.keys(saved) as (keyof T)[]) {
        if (saved[k] !== undefined && saved[k] !== "" && k in setters) {
          (setters[k] as (val: unknown) => void)(saved[k]);
          didRestore = true;
        }
      }
      if (didRestore) setRestored(true);
    } catch {
      // Corrupt data — ignore
    }
    prevKeyRef.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Auto-dismiss "Draft restored" after 3 seconds
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => setRestored(false), 3000);
    return () => clearTimeout(t);
  }, [restored]);

  // Debounced save
  useEffect(() => {
    // Check if there's any non-empty content
    const hasData = Object.values(currentValues).some(
      (v) => typeof v === "string" ? v.length > 0 : v !== undefined && v !== null,
    );
    hasContent.current = hasData;

    if (!hasData) {
      localStorage.removeItem(key);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      localStorage.setItem(key, JSON.stringify(currentValues));
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [key, currentValues]);

  // beforeunload warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasContent.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(key);
    hasContent.current = false;
  }, [key]);

  const discardDraft = useCallback(() => {
    localStorage.removeItem(key);
    hasContent.current = false;
    for (const k of Object.keys(setters) as (keyof T)[]) {
      (setters[k] as (val: unknown) => void)(
        typeof currentValues[k] === "string" ? "" : null,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setters]);

  return { restored, clearDraft, discardDraft };
}

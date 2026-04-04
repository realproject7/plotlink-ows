"use client";

import { useState, useEffect } from "react";

export const DEADLINE_HOURS = 168;
export const DEADLINE_MS = DEADLINE_HOURS * 60 * 60 * 1000;

export function DeadlineCountdown({
  lastPlotTime,
  hideLabel,
  valueClassName,
}: {
  lastPlotTime: string;
  hideLabel?: boolean;
  valueClassName?: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial sync needed for SSR hydration safety
    setRemaining(calcRemaining(lastPlotTime));
    const interval = setInterval(() => {
      setRemaining(calcRemaining(lastPlotTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastPlotTime]);

  const defaultValueClass = "text-accent font-medium";
  const activeClass = valueClassName ?? defaultValueClass;

  if (remaining === null) {
    return (
      <div className="text-xs">
        {!hideLabel && <><span className="text-muted">Deadline:</span>{" "}</>}
        <span className={activeClass}>--</span>
      </div>
    );
  }

  if (remaining <= 0) {
    return (
      <div className="text-xs">
        {!hideLabel && <><span className="text-muted">Deadline:</span>{" "}</>}
        <span className={valueClassName ? `${valueClassName} text-error` : "text-error font-medium"}>expired</span>
      </div>
    );
  }

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  let formatted: string;
  if (days > 0) {
    formatted = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  } else if (hours > 0) {
    formatted = `${hours}h ${minutes}m ${seconds}s`;
  } else {
    formatted = `${minutes}m ${seconds}s`;
  }

  return (
    <div className="text-xs">
      {!hideLabel && <><span className="text-muted">Deadline:</span>{" "}</>}
      <span className={activeClass}>{formatted}</span>
    </div>
  );
}

function calcRemaining(lastPlotTime: string): number {
  const deadline =
    new Date(lastPlotTime).getTime() + DEADLINE_HOURS * 60 * 60 * 1000;
  return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
}

"use client";

import { useAccount } from "wagmi";
import Link from "next/link";
import { DEADLINE_HOURS } from "./DeadlineCountdown";

function isDeadlineExpired(lastPlotTime: string | null): boolean {
  if (!lastPlotTime) return false;
  const deadline = new Date(lastPlotTime).getTime() + DEADLINE_HOURS * 60 * 60 * 1000;
  return Date.now() > deadline;
}

export function AddPlotButton({
  storylineId,
  writerAddress,
  lastPlotTime,
  sunset,
  hasDeadline,
}: {
  storylineId: number;
  writerAddress: string;
  lastPlotTime?: string | null;
  sunset?: boolean;
  hasDeadline?: boolean;
}) {
  const { address } = useAccount();
  if (!address || address.toLowerCase() !== writerAddress.toLowerCase())
    return null;

  const expired = sunset || (hasDeadline !== false && lastPlotTime ? isDeadlineExpired(lastPlotTime) : false);

  if (expired) {
    return (
      <div
        className="border-border text-muted mt-3 inline-block rounded border px-6 py-2 text-center text-xs font-medium opacity-50"
        title={sunset ? "This story has sunset" : "The 7-day deadline has expired"}
      >
        {sunset ? "Story complete" : "Deadline expired"}
      </div>
    );
  }

  return (
    <Link
      href={`/create?tab=chain&storyline=${storylineId}`}
      className="border-accent text-accent hover:bg-accent/10 mt-3 inline-block rounded border px-6 py-2 text-center text-xs font-medium transition-colors"
    >
      + Add a new Plot
    </Link>
  );
}

"use client";

import { useCallback } from "react";
import { usePlatformDetection } from "../hooks/usePlatformDetection";

/**
 * "Share to Farcaster" button — only renders when platform === 'farcaster'.
 * Calls sdk.actions.composeCast() with pre-filled text and story URL as embed.
 */
export function ShareToFarcaster({
  storylineId,
  title,
}: {
  storylineId: number;
  title: string;
}) {
  const { platform, isLoading } = usePlatformDetection();

  const handleShare = useCallback(async () => {
    const { sdk } = await import("@farcaster/miniapp-sdk");

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const storyUrl = `${appUrl}/story/${storylineId}`;

    await sdk.actions.composeCast({
      text: `Check out "${title}" on PlotLink`,
      embeds: [storyUrl],
    });
  }, [storylineId, title]);

  if (isLoading || platform !== "farcaster") return null;

  return (
    <button
      type="button"
      onClick={handleShare}
      className="border-border bg-surface text-foreground hover:border-accent hover:text-accent flex w-full cursor-pointer items-center justify-center gap-2 rounded border px-3 py-2 text-xs transition-colors"
    >
      <FarcasterIcon />
      Share to Farcaster
    </button>
  );
}

function FarcasterIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 1000 1000"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
      <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
      <path d="M693.333 746.667C681.06 746.667 671.111 756.616 671.111 768.889V795.556H666.667C654.394 795.556 644.444 805.505 644.444 817.778V844.444H893.333V817.778C893.333 805.505 883.384 795.556 871.111 795.556H866.667V768.889C866.667 756.616 856.717 746.667 844.444 746.667V351.111H868.889L897.778 253.333H720V746.667H693.333Z" />
    </svg>
  );
}

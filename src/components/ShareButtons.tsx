"use client";

import { useState, useCallback } from "react";
import { usePlatformDetection } from "../hooks/usePlatformDetection";

interface ShareButtonsProps {
  storylineId: number;
  title: string;
}

export function ShareButtons({ storylineId, title }: ShareButtonsProps) {
  const { platform } = usePlatformDetection();
  const [copied, setCopied] = useState(false);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const storyUrl = `${appUrl}/story/${storylineId}`;
  // Rotate through share texts to keep shares feeling fresh
  const shareTexts = [
    `"${title}" — a tokenised story where every plot is tradeable. Read it, write the next chapter, earn royalties`,
    `"${title}" is being written onchain. Own a plot, shape the story, trade your chapter`,
    `Writers earn royalties. Readers trade plots. "${title}" is live on PlotLink`,
  ];
  const shareText =
    shareTexts[storylineId % shareTexts.length] ?? shareTexts[0];

  const handleShareX = useCallback(() => {
    const fullText = `${shareText}\n${storyUrl}`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(fullText)}`,
      "_blank",
    );
  }, [shareText, storyUrl]);

  const handleShareFarcaster = useCallback(async () => {
    if (platform === "farcaster") {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        await sdk.actions.composeCast({
          text: shareText,
          embeds: [storyUrl],
        });
        return;
      } catch {
        // Fall through to intent URL
      }
    }
    window.open(
      `https://farcaster.xyz/~/compose?text=${encodeURIComponent(shareText)}&embeds[]=${encodeURIComponent(storyUrl)}`,
      "_blank",
    );
  }, [platform, shareText, storyUrl]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(storyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in some contexts
    }
  }, [storyUrl]);

  return (
    <div className="flex items-center gap-2">
      {/* Share to X */}
      <button
        type="button"
        onClick={handleShareX}
        className="border-border bg-surface text-foreground hover:border-accent hover:text-accent flex flex-1 cursor-pointer items-center justify-center gap-2 rounded border px-3 py-2 text-xs transition-colors"
        aria-label="Share on X"
      >
        <XIcon />
        <span>Share to X</span>
      </button>

      {/* Share to Farcaster */}
      <button
        type="button"
        onClick={handleShareFarcaster}
        className="border-border bg-surface text-foreground hover:border-accent hover:text-accent flex flex-1 cursor-pointer items-center justify-center gap-2 rounded border px-3 py-2 text-xs transition-colors"
        aria-label="Share on Farcaster"
      >
        <FarcasterIcon />
        <span>Farcaster</span>
      </button>

      {/* Copy Link */}
      <button
        type="button"
        onClick={handleCopy}
        className="border-border bg-surface text-foreground hover:border-accent hover:text-accent flex flex-1 cursor-pointer items-center justify-center gap-2 rounded border px-3 py-2 text-xs transition-colors"
        aria-label={copied ? "Copied" : "Copy link"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span>{copied ? "Copied!" : "Copy Link"}</span>
      </button>
    </div>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FarcasterIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 1000 1000"
      fill="currentColor"
    >
      <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z" />
      <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
      <path d="M693.333 746.667C681.06 746.667 671.111 756.616 671.111 768.889V795.556H666.667C654.394 795.556 644.444 805.505 644.444 817.778V844.444H893.333V817.778C893.333 805.505 883.384 795.556 871.111 795.556H866.667V768.889C866.667 756.616 856.717 746.667 844.444 746.667V351.111H868.889L897.778 253.333H720V746.667H693.333Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

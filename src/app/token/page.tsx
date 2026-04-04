"use client";

import { useAccount, useReadContract } from "wagmi";
import { formatUnits, erc20Abi } from "viem";
import { useState } from "react";
import Image from "next/image";
import {
  PLOT_TOKEN, EXPLORER_URL,
} from "../../../lib/contracts/constants";
import { SwapInterface } from "../../components/token/SwapInterface";
import { useTokenInfo, formatPrice, formatNumber } from "../../hooks/useTokenInfo";

const BASESCAN_URL = `${EXPLORER_URL}/token/${PLOT_TOKEN}`;
const MINT_CLUB_URL = "https://mint.club/token/base/PLOT";
const HUNT_TOWN_URL = "https://hunt.town/project/PLOT";

export default function TokenPage() {
  const { address, isConnected } = useAccount();
  const [copied, setCopied] = useState(false);

  const { data: balance, isLoading: balanceLoading } = useReadContract({
    address: PLOT_TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: tokenInfo, isLoading: tokenInfoLoading } = useTokenInfo();

  const formattedBalance = balance ? formatUnits(balance, 18) : "0";

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(PLOT_TOKEN);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
      {/* Page Title */}
      <div className="text-center mb-6">
        <h1 className="text-foreground text-2xl font-bold">$PLOT Token</h1>
        <p className="text-muted mt-1 text-sm">The reserve token behind every story on PlotLink</p>
      </div>

      {/* Your Balance */}
      <div className="bg-accent text-background rounded p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-background/60 text-xs uppercase tracking-wider">Your Balance</h2>
          {isConnected && (
            <div className="flex items-center gap-1.5 text-xs text-background/80">
              <div className="bg-background h-1.5 w-1.5 animate-pulse rounded-full" />
              Connected
            </div>
          )}
        </div>

        {!isConnected ? (
          <div className="text-center py-4">
            <p className="text-background/70 text-sm">Connect your wallet to view balance</p>
          </div>
        ) : balanceLoading ? (
          <div className="text-center py-4">
            <p className="text-background/70 text-sm">Loading...</p>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-background text-3xl font-bold">
              {parseFloat(formattedBalance).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}{" "}
              <span className="text-background/80">PLOT</span>
            </div>
            {tokenInfo?.price && parseFloat(formattedBalance) > 0 && (
              <div className="text-background/60 mt-1 text-sm">
                ${(parseFloat(formattedBalance) * tokenInfo.price).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} USD
              </div>
            )}
          </div>
        )}
      </div>

      {/* Token Utility */}
      <div className="border-border rounded border p-5">
        <h3 className="text-foreground text-sm font-bold mb-3">Why PLOT?</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="bg-accent/10 text-accent flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold">1</span>
            <p className="text-muted text-sm">
              <span className="text-foreground font-semibold">Reserve token for story tokens</span> — every storyline token on PlotLink is backed by PLOT via MCV2 bonding curves.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="bg-accent/10 text-accent flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold">2</span>
            <p className="text-muted text-sm">
              <span className="text-foreground font-semibold">TVL growth</span> — as more story tokens are minted, more PLOT gets locked in bonding curve reserves, increasing total value locked across all storylines.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="bg-accent/10 text-accent flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold">3</span>
            <p className="text-muted text-sm">
              <span className="text-foreground font-semibold">Creator royalties</span> — 1% mint and 1% burn royalty on every trade flows directly to the story writer.
            </p>
          </div>
        </div>
      </div>

      {/* Swap Interface */}
      <SwapInterface />

      {/* Token Information */}
      <div className="border-border rounded border p-5">
        <h3 className="text-foreground text-sm font-bold mb-4">Token Information</h3>

        {/* Stats Grid — Price + Market Cap */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="border-border bg-surface rounded border p-3">
            <div className="text-muted text-[10px] uppercase tracking-wider mb-1">Price</div>
            {tokenInfoLoading ? (
              <div className="bg-border h-6 animate-pulse rounded" />
            ) : tokenInfo ? (
              <div className="space-y-1">
                <div className="text-foreground text-sm font-bold">
                  {formatPrice(tokenInfo.price)}
                </div>
                {tokenInfo.priceChange24h !== null && (
                  <div className={`text-xs ${tokenInfo.priceChange24h >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {tokenInfo.priceChange24h >= 0 ? "+" : ""}
                    {tokenInfo.priceChange24h.toFixed(2)}%
                  </div>
                )}
              </div>
            ) : (
              <div className="text-muted text-sm">—</div>
            )}
          </div>
          <div className="border-border bg-surface rounded border p-3">
            <div className="text-muted text-[10px] uppercase tracking-wider mb-1">Market Cap</div>
            {tokenInfoLoading ? (
              <div className="bg-border h-6 animate-pulse rounded" />
            ) : tokenInfo ? (
              <div className="text-foreground text-sm font-bold">
                ${formatNumber(tokenInfo.marketCap)}
              </div>
            ) : (
              <div className="text-muted text-sm">—</div>
            )}
          </div>
        </div>

        {/* External Links */}
        <div className="space-y-2">
          {/* Mint Club */}
          <a
            href={MINT_CLUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border hover:border-accent flex items-center justify-between rounded border p-3 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Image
                src="/mc-icon-light.svg"
                alt="Mint Club"
                width={20}
                height={20}
                className="h-5 w-5"
              />
              <span className="text-foreground text-sm">View on Mint Club</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>

          {/* Hunt Town */}
          <a
            href={HUNT_TOWN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border hover:border-accent flex items-center justify-between rounded border p-3 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Image
                src="/hunt-token.svg"
                alt="Hunt Town"
                width={20}
                height={20}
                className="h-5 w-5"
              />
              <span className="text-foreground text-sm">View on Hunt Town</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>

          {/* Basescan — Contract Address */}
          <a
            href={BASESCAN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border hover:border-accent flex items-center justify-between rounded border p-3 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Image
                src="/basescan-icon.svg"
                alt="Basescan"
                width={20}
                height={20}
                className="h-5 w-5"
              />
              <div className="flex flex-col">
                <span className="text-muted text-[10px] uppercase tracking-wider">Contract Address</span>
                <code className="text-foreground text-sm font-bold">
                  {PLOT_TOKEN.slice(0, 6)}...{PLOT_TOKEN.slice(-6)}
                </code>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleCopyAddress();
                }}
                className="text-muted hover:text-foreground p-1.5 transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </div>
          </a>

          {/* Network Badge */}
          <div className="border-border bg-surface flex items-center gap-3 rounded border p-3">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20">
              <div className="h-2 w-2 rounded-full bg-blue-500" />
            </div>
            <span className="text-foreground text-sm">Base Mainnet (ERC-20)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

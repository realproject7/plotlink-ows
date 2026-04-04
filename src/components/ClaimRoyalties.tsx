"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWriteContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, type Address } from "viem";
import { browserClient } from "../../lib/rpc";
import { mcv2BondAbi, getTokenTVL } from "../../lib/price";
import { MCV2_BOND, RESERVE_LABEL, EXPLORER_URL, PLOT_TOKEN } from "../../lib/contracts/constants";
import { formatUsdValue } from "../../lib/usd-price";

function formatTruncated(value: bigint, decimals: number, digits = 4): string {
  const raw = formatUnits(value, decimals);
  const dot = raw.indexOf(".");
  if (dot === -1 || raw.length - dot - 1 <= digits) return raw;
  const truncated = raw.slice(0, dot + 1 + digits).replace(/0+$/, "").replace(/\.$/, "");
  return truncated === "0" && value > BigInt(0) ? raw.slice(0, dot + 1 + digits) : truncated;
}

type TxState = "idle" | "confirming" | "pending" | "done" | "error";

interface ClaimRoyaltiesProps {
  tokenAddress: Address;
  plotCount: number;
  beneficiary: Address;
  plotUsd?: number | null;
}

export function ClaimRoyalties({ tokenAddress, plotCount, beneficiary, plotUsd }: ClaimRoyaltiesProps) {
  const [txState, setTxState] = useState<TxState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [claimedAmount, setClaimedAmount] = useState<bigint>(BigInt(0));
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const { writeContractAsync } = useWriteContract();

  // Fetch unclaimed royalty balance + cumulative claimed
  const { data: royaltyInfo } = useQuery({
    queryKey: ["royalty-info", tokenAddress, beneficiary],
    queryFn: async () => {
      const [balance, claimed] = await browserClient.readContract({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "getRoyaltyInfo",
        args: [beneficiary, PLOT_TOKEN],
      });
      return { unclaimed: balance, claimed };
    },
    refetchInterval: 30000,
  });

  // Fetch reserve token decimals dynamically
  const { data: tvlData } = useQuery({
    queryKey: ["claim-decimals", tokenAddress],
    queryFn: () => getTokenTVL(tokenAddress, browserClient),
  });
  const decimals = tvlData?.decimals ?? 18;

  const unclaimed = royaltyInfo?.unclaimed ?? BigInt(0);
  const totalClaimed = royaltyInfo?.claimed ?? BigInt(0);
  const eligible = plotCount >= 2;
  const canClaim = eligible && unclaimed > BigInt(0);

  // Track dataUpdatedAt to detect refetch after claim
  const claimDoneRef = useRef(false);
  useEffect(() => {
    if (txState === "done") {
      claimDoneRef.current = true;
    }
  }, [txState]);
  // Reset to idle when royaltyInfo updates after a successful claim
  useEffect(() => {
    if (claimDoneRef.current && txState === "done") {
      claimDoneRef.current = false;
      setTxState("idle");
      setError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [royaltyInfo]);

  const executeClaim = useCallback(async () => {
    try {
      setError(null);
      setClaimedAmount(unclaimed);
      setTxState("confirming");

      const hash = await writeContractAsync({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "claimRoyalties",
        args: [PLOT_TOKEN],
      });
      setTxHash(hash);

      setTxState("pending");
      await browserClient.waitForTransactionReceipt({ hash });

      setTxState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
      setTxState("error");
    }
  }, [unclaimed, writeContractAsync]);

  const reset = useCallback(() => {
    setTxState("idle");
    setError(null);
  }, []);

  return (
    <div className="text-xs space-y-1">
      <p className="text-muted text-[10px] uppercase tracking-wider">Royalties</p>
      {/* Claimable row + Claim button inline */}
      <div className="flex items-center gap-2">
        <span className="text-muted">Claimable:</span>{" "}
        <span className={`font-medium ${unclaimed > BigInt(0) ? "text-accent" : "text-foreground"}`}>
          {formatTruncated(unclaimed, decimals)} {RESERVE_LABEL}
        </span>
        {plotUsd != null && unclaimed > BigInt(0) && (
          <span className="text-muted"> ({formatUsdValue(parseFloat(formatUnits(unclaimed, decimals)) * plotUsd)})</span>
        )}
        <button
          onClick={txState === "error" ? reset : executeClaim}
          disabled={
            txState === "done" ||
            (txState === "idle" && !canClaim) ||
            (txState !== "idle" && txState !== "error")
          }
          className="bg-accent text-background rounded px-3 py-0.5 text-[10px] font-medium transition-opacity disabled:opacity-40"
        >
          {txState === "idle" && "Claim"}
          {txState === "confirming" && "Confirm..."}
          {txState === "pending" && "Pending..."}
          {txState === "done" && "Claimed"}
          {txState === "error" && "Retry"}
        </button>
        {/* Info tooltip */}
        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => setShowTooltip((v) => !v)}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="text-muted hover:text-foreground text-[10px] leading-none transition-colors"
            aria-label="Royalty info"
          >
            &#9432;
          </button>
          {showTooltip && (
            <div className="border-border bg-surface absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded border px-3 py-2 text-[10px] leading-relaxed shadow-lg">
              <p className="text-foreground font-medium">Royalties</p>
              <p className="text-muted mt-1">
                You earn a share of every trade on your storyline&apos;s token.
              </p>
              <p className="text-muted mt-1.5">Requires at least 2 plots ({plotCount}/2){eligible && " \u2713"}</p>
            </div>
          )}
        </div>
      </div>
      {/* Claimed row */}
      {totalClaimed > BigInt(0) && (
        <div>
          <span className="text-muted">Claimed:</span>{" "}
          <span className="text-foreground font-medium">
            {formatTruncated(totalClaimed, decimals)} {RESERVE_LABEL}
          </span>
          {plotUsd != null && (
            <span className="text-muted"> ({formatUsdValue(parseFloat(formatUnits(totalClaimed, decimals)) * plotUsd)})</span>
          )}
        </div>
      )}
      {!eligible && txState === "idle" && (
        <p className="text-muted text-xs">
          Chain at least 2 plots to enable claims ({plotCount}/2)
        </p>
      )}
      {eligible && unclaimed === BigInt(0) && txState === "idle" && totalClaimed === BigInt(0) && (
        <p className="text-muted text-xs">
          No royalties yet — accrue when readers trade your token
        </p>
      )}
      {txHash && txState === "done" && (
        <p className="text-muted text-xs">
          Claimed {formatTruncated(claimedAmount, decimals)} {RESERVE_LABEL} —{" "}
          <a href={`${EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {txHash.slice(0, 10)}...{txHash.slice(-8)}
          </a>
        </p>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Address, formatUnits } from "viem";
import { supabase } from "../../lib/supabase";
import { RESERVE_LABEL } from "../../lib/contracts/constants";

const CHART_W = 320;
const CHART_H = 140;
const PAD = { top: 10, right: 10, bottom: 24, left: 48 };
const PLOT_W = CHART_W - PAD.left - PAD.right;
const PLOT_H = CHART_H - PAD.top - PAD.bottom;
const MAX_POINTS = 50;

type PriceMode = "usd" | "reserve";

interface PriceChartProps {
  tokenAddress: Address;
  currentPriceRaw: bigint;
}

interface TradePoint {
  price_per_token: number;
  block_timestamp: string;
  reserve_usd_rate: number | null;
  rate_source: string | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatReservePrice(v: number): string {
  if (v === 0) return "0";
  if (v < 0.001) return v.toExponential(0);
  if (v < 1) return v.toFixed(4);
  return v.toFixed(2);
}

function formatUsdPrice(v: number): string {
  if (v === 0) return "$0";
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  if (v >= 0.0001) return `$${v.toFixed(6)}`;
  return `$${v.toExponential(2)}`;
}

export function PriceChart({ tokenAddress, currentPriceRaw }: PriceChartProps) {
  const [mode, setMode] = useState<PriceMode>("usd");
  const currentPrice = Number(formatUnits(currentPriceRaw, 18));

  const { data: tradePoints } = useQuery({
    queryKey: ["price-history", tokenAddress],
    queryFn: async () => {
      if (!supabase) return [];
      const { data } = await supabase
        .from("trade_history")
        .select("price_per_token, block_timestamp, reserve_usd_rate, rate_source")
        .eq("token_address", tokenAddress.toLowerCase())
        .order("block_timestamp", { ascending: true });
      if (!data || data.length === 0) return [];

      // Downsample if too many points
      if (data.length <= MAX_POINTS) return data as TradePoint[];
      const step = (data.length - 1) / (MAX_POINTS - 1);
      const sampled: TradePoint[] = [];
      for (let i = 0; i < MAX_POINTS; i++) {
        sampled.push(data[Math.round(i * step)] as TradePoint);
      }
      return sampled;
    },
    staleTime: 30000,
    refetchInterval: 30000,
  });

  const hasData = tradePoints && tradePoints.length > 0;

  // Check if USD data is available (at least some points have a rate)
  const hasUsdData = hasData && tradePoints.some((t) => t.reserve_usd_rate !== null);
  const hasApproxData = hasData && tradePoints.some((t) => t.rate_source === "backfill_approx");

  // If in USD mode but no USD data, fall back to reserve
  const effectiveMode = mode === "usd" && !hasUsdData ? "reserve" : mode;
  const formatPrice = effectiveMode === "usd" ? formatUsdPrice : formatReservePrice;

  // Empty state
  if (!hasData) {
    return (
      <section className="border-border mt-4 rounded border px-4 py-4">
        <h2 className="text-foreground text-sm font-medium">Price</h2>
        <div className="mt-3 flex flex-col items-center justify-center py-6">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="3" fill="var(--accent)" />
            <circle cx="20" cy="20" r="3" fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity="0.4">
              <animate attributeName="r" values="3;8" dur="1.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0" dur="1.5s" repeatCount="indefinite" />
            </circle>
          </svg>
          <p className="text-muted mt-2 text-[10px]">No trading activity yet</p>
          {currentPrice > 0 && (
            <p className="text-accent mt-1 text-xs font-medium">
              {formatReservePrice(currentPrice)} {RESERVE_LABEL}
            </p>
          )}
        </div>
      </section>
    );
  }

  // Build points array with USD conversion where available
  const points = tradePoints.map((t) => {
    const reservePrice = Math.round(Number(t.price_per_token) * 1e8) / 1e8;
    const usdPrice = t.reserve_usd_rate !== null
      ? reservePrice * t.reserve_usd_rate
      : null;
    return {
      time: t.block_timestamp,
      price: effectiveMode === "usd" && usdPrice !== null ? usdPrice : reservePrice,
      hasUsd: usdPrice !== null,
      isApprox: t.rate_source === "backfill_approx",
    };
  });

  // For USD mode, filter to only points with USD data
  const chartPoints = effectiveMode === "usd"
    ? points.filter((p) => p.hasUsd)
    : points;

  if (chartPoints.length === 0) {
    // All points filtered out — shouldn't happen, but fallback
    return (
      <section className="border-border mt-4 rounded border px-4 py-4">
        <h2 className="text-foreground text-sm font-medium">Price</h2>
        <p className="text-muted mt-2 text-[10px]">USD pricing data not yet available</p>
      </section>
    );
  }

  // Scale with minimum Y range to prevent micro-noise exaggeration
  const prices = chartPoints.map((p) => p.price);
  const minY = Math.min(...prices);
  const maxY = Math.max(...prices);
  const rawRange = maxY - minY;
  const minRange = maxY * 0.01;
  const yRange = Math.max(rawRange, minRange) || maxY || 1;
  const yPad = yRange * 0.1;

  const scaleX = (i: number) =>
    PAD.left + (i / (chartPoints.length - 1 || 1)) * PLOT_W;
  const scaleY = (v: number) =>
    PAD.top + PLOT_H - ((v - (minY - yPad)) / (yRange + yPad * 2)) * PLOT_H;

  // Build line segments: solid for exact data, dashed for approximate
  const lineSegments: { points: string; isApprox: boolean }[] = [];
  let currentSegment: { indices: number[]; isApprox: boolean } | null = null;

  for (let i = 0; i < chartPoints.length; i++) {
    const isApprox = chartPoints[i].isApprox;
    if (!currentSegment || currentSegment.isApprox !== isApprox) {
      // Overlap with previous segment's last point for continuity
      if (currentSegment && currentSegment.indices.length > 0) {
        lineSegments.push({
          points: currentSegment.indices
            .map((idx) => `${scaleX(idx)},${scaleY(chartPoints[idx].price)}`)
            .join(" "),
          isApprox: currentSegment.isApprox,
        });
      }
      currentSegment = {
        indices: currentSegment ? [currentSegment.indices[currentSegment.indices.length - 1], i] : [i],
        isApprox,
      };
    } else {
      currentSegment.indices.push(i);
    }
  }
  if (currentSegment && currentSegment.indices.length > 0) {
    lineSegments.push({
      points: currentSegment.indices
        .map((idx) => `${scaleX(idx)},${scaleY(chartPoints[idx].price)}`)
        .join(" "),
      isApprox: currentSegment.isApprox,
    });
  }

  // Full line for area fill
  const allLinePoints = chartPoints
    .map((p, i) => `${scaleX(i)},${scaleY(p.price)}`)
    .join(" ");

  // Last point for pulse marker
  const lastIdx = chartPoints.length - 1;
  const lastX = scaleX(lastIdx);
  const lastY = scaleY(chartPoints[lastIdx].price);

  // Y-axis ticks
  const yTicks = [minY, (minY + maxY) / 2, maxY];

  // X-axis time labels (first, mid, last) — deduplicated when indices overlap
  const xLabelCandidates = [
    { idx: 0, label: formatTime(chartPoints[0].time) },
    { idx: Math.floor(lastIdx / 2), label: formatTime(chartPoints[Math.floor(lastIdx / 2)].time) },
    { idx: lastIdx, label: formatTime(chartPoints[lastIdx].time) },
  ];
  const xLabels = xLabelCandidates.filter(
    (item, i, arr) => arr.findIndex((a) => a.idx === item.idx) === i,
  );

  const priceLabel = effectiveMode === "usd" ? "USD" : RESERVE_LABEL;

  // In USD mode, check if the last charted point is actually the most recent trade.
  // If newer trades exist without USD data, label accordingly.
  const lastChartTime = new Date(chartPoints[lastIdx].time).getTime();
  const lastTradeTime = new Date(tradePoints[tradePoints.length - 1].block_timestamp).getTime();
  const isLatest = effectiveMode === "reserve" || lastChartTime >= lastTradeTime;

  return (
    <section className="border-border mt-4 rounded border px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-foreground text-sm font-medium">Price</h2>
        {hasUsdData && (
          <div className="border-border flex rounded border text-[10px]">
            <button
              type="button"
              className={`px-2 py-0.5 transition-colors ${
                effectiveMode === "usd"
                  ? "bg-accent text-white"
                  : "text-muted hover:text-foreground"
              }`}
              onClick={() => setMode("usd")}
            >
              USD
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 transition-colors ${
                effectiveMode === "reserve"
                  ? "bg-accent text-white"
                  : "text-muted hover:text-foreground"
              }`}
              onClick={() => setMode("reserve")}
            >
              {RESERVE_LABEL}
            </button>
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="mt-2 w-full"
        style={{ maxWidth: CHART_W }}
      >
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <line
            key={`yg-${i}`}
            x1={PAD.left}
            y1={scaleY(v)}
            x2={CHART_W - PAD.right}
            y2={scaleY(v)}
            stroke="var(--border)"
            strokeWidth={0.5}
          />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <text
            key={`yl-${i}`}
            x={PAD.left - 4}
            y={scaleY(v) + 3}
            textAnchor="end"
            fill="var(--text-muted)"
            fontSize={8}
            fontFamily="monospace"
          >
            {formatPrice(v)}
          </text>
        ))}

        {/* X-axis time labels */}
        {xLabels.map(({ idx, label }) => (
          <text
            key={`xl-${idx}`}
            x={scaleX(idx)}
            y={CHART_H - 4}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize={8}
            fontFamily="monospace"
          >
            {label}
          </text>
        ))}

        {/* Area fill under price line */}
        <defs>
          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`${allLinePoints} ${scaleX(lastIdx)},${PAD.top + PLOT_H} ${PAD.left},${PAD.top + PLOT_H}`}
          fill="url(#priceGradient)"
        />

        {/* Price line segments: solid for exact, dashed for approximate */}
        {lineSegments.map((seg, i) => (
          <polyline
            key={`line-${i}`}
            points={seg.points}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeDasharray={seg.isApprox && effectiveMode === "usd" ? "4 2" : undefined}
            opacity={seg.isApprox && effectiveMode === "usd" ? 0.6 : 1}
          />
        ))}

        {/* Current price pulse marker */}
        <circle
          cx={lastX}
          cy={lastY}
          r={3}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          opacity={0.4}
        >
          <animate attributeName="r" values="3;8" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0" dur="1.5s" repeatCount="indefinite" />
        </circle>
        <circle cx={lastX} cy={lastY} r={3} fill="var(--accent)" />
      </svg>
      <p className="text-muted mt-1 text-[10px]">
        Price per token ({priceLabel})
        <span className="text-accent-dim">
          {" "}&middot; {isLatest ? "latest" : "last USD"}: {formatPrice(chartPoints[lastIdx].price)} {priceLabel}
        </span>
      </p>
      {effectiveMode === "usd" && hasApproxData && (
        <p className="text-muted mt-0.5 text-[9px] opacity-60">
          Dashed segments use approximate USD conversion
        </p>
      )}
    </section>
  );
}

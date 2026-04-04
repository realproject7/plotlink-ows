"use client";

import { usePlotUsdPrice } from "../hooks/usePlotUsdPrice";
import { formatUsdValue } from "../../lib/usd-price";

/**
 * Inline USD price tag that converts a PLOT-denominated value to USD.
 * Renders nothing while loading or if price is unavailable.
 */
export function UsdPriceTag({ plotAmount }: { plotAmount: number }) {
  const { data: plotUsd } = usePlotUsdPrice();
  if (!plotUsd || plotAmount <= 0) return null;

  const usd = plotAmount * plotUsd;
  return <span className="ml-1 opacity-60">({formatUsdValue(usd)})</span>;
}

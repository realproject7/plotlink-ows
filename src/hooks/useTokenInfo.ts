"use client";

import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { browserClient } from "../../lib/rpc";
import { PLOT_TOKEN, MCV2_BOND, HUNT } from "../../lib/contracts/constants";

const USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const ONEINCH_SPOT_PRICE_AGGREGATOR = "0x00000000000D6FFc74A8feb35aF5827bf57f6786" as const;

const SPOT_PRICE_ABI = [
  {
    inputs: [
      { name: "srcToken", type: "address" },
      { name: "dstToken", type: "address" },
      { name: "useWrappers", type: "bool" },
    ],
    name: "getRate",
    outputs: [{ name: "weightedRate", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const MCV2_BOND_ABI = [
  {
    inputs: [{ name: "token", type: "address" }],
    name: "priceForNextMint",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_SUPPLY_ABI = [
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface TokenInfo {
  price: number;
  marketCap: number;
  totalSupply: number;
  priceChange24h: number | null;
}

async function getHuntPriceUSD(): Promise<number> {
  const weightedRate = await browserClient.readContract({
    address: ONEINCH_SPOT_PRICE_AGGREGATOR,
    abi: SPOT_PRICE_ABI,
    functionName: "getRate",
    args: [HUNT, USDC_ADDRESS, false],
  });
  // USDC has 6 decimals, HUNT has 18 → rate is scaled to 1e18
  // weightedRate = how many USDC (6 dec) per 1 HUNT (18 dec) scaled by 1e18
  // USD price = weightedRate / 1e6
  return Number(weightedRate) / 1_000_000;
}

async function getPlotPriceUSD(): Promise<number> {
  const priceInHuntWei = await browserClient.readContract({
    address: MCV2_BOND,
    abi: MCV2_BOND_ABI,
    functionName: "priceForNextMint",
    args: [PLOT_TOKEN],
  });
  const priceInHunt = Number(formatEther(priceInHuntWei));
  const huntPriceUSD = await getHuntPriceUSD();
  return priceInHunt * huntPriceUSD;
}

export function useTokenInfo() {
  return useQuery({
    queryKey: ["plot-token-info"],
    queryFn: async () => {
      const [price, supply] = await Promise.all([
        getPlotPriceUSD(),
        browserClient.readContract({
          address: PLOT_TOKEN,
          abi: ERC20_SUPPLY_ABI,
          functionName: "totalSupply",
        }),
      ]);

      const totalSupply = Number(formatEther(supply));
      const marketCap = price * totalSupply;

      // 24h price change via block diff (~43200 blocks = 1 day on Base @ 2s)
      let priceChange24h: number | null = null;
      try {
        const currentBlock = await browserClient.getBlockNumber();
        const pastBlock = currentBlock - BigInt(43200);

        const [pastPriceInHuntWei, huntPriceUSD] = await Promise.all([
          browserClient.readContract({
            address: MCV2_BOND,
            abi: MCV2_BOND_ABI,
            functionName: "priceForNextMint",
            args: [PLOT_TOKEN],
            blockNumber: pastBlock,
          }),
          getHuntPriceUSD(),
        ]);

        const pastPriceUSD = Number(formatEther(pastPriceInHuntWei)) * huntPriceUSD;
        if (pastPriceUSD > 0) {
          priceChange24h = ((price - pastPriceUSD) / pastPriceUSD) * 100;
        }
      } catch {
        // Token may not have existed 24h ago
      }

      return { price, marketCap, totalSupply, priceChange24h } satisfies TokenInfo;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });
}

export function formatPrice(price: number): string {
  if (price === 0) return "$0";
  if (price >= 1) return `$${price.toFixed(2)}`;

  const str = price.toString();
  const match = str.match(/^0\.0+/);

  if (match) {
    const leadingZeros = match[0].length - 2;
    if (leadingZeros >= 4) {
      const significantPart = str.slice(match[0].length);
      const displayDigits = significantPart.slice(0, 4);
      const subscriptMap: Record<string, string> = {
        "0": "\u2080", "1": "\u2081", "2": "\u2082", "3": "\u2083",
        "4": "\u2084", "5": "\u2085", "6": "\u2086", "7": "\u2087",
        "8": "\u2088", "9": "\u2089",
      };
      const subscriptZeros = leadingZeros.toString().split("").map((d) => subscriptMap[d]).join("");
      return `$0.0${subscriptZeros}${displayDigits}`;
    }
  }

  return `$${price.toFixed(6).replace(/\.?0+$/, "")}`;
}

export function formatNumber(num: number): string {
  if (num === 0) return "0";
  const abs = Math.abs(num);
  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

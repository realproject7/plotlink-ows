import { type Address, formatUnits } from "viem";
import { publicClient } from "./rpc";
import { MCV2_BOND } from "./contracts/constants";
import {
  priceForNextMintFunction,
  tokenBondFunction,
} from "./contracts/abi";
import { priceCache } from "./cache";

/**
 * Minimal ABIs for price display.
 *
 * - MCV2_Bond.priceForNextMint: cost (in reserve token) to mint 1 token
 * - ERC-20 totalSupply: total minted supply of the storyline token
 */
export const mcv2BondAbi = [
  {
    type: "function",
    name: "getReserveForToken",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokensToMint", type: "uint256" },
    ],
    outputs: [
      { name: "reserveAmount", type: "uint256" },
      { name: "royalty", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getRefundForTokens",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokensToBurn", type: "uint256" },
    ],
    outputs: [
      { name: "refundAmount", type: "uint256" },
      { name: "royalty", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokensToMint", type: "uint256" },
      { name: "maxReserveAmount", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokensToBurn", type: "uint256" },
      { name: "minRefund", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getRoyaltyInfo",
    stateMutability: "view",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "reserveToken", type: "address" },
    ],
    outputs: [
      { name: "balance", type: "uint256" },
      { name: "claimed", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "claimRoyalties",
    stateMutability: "nonpayable",
    inputs: [{ name: "reserveToken", type: "address" }],
    outputs: [],
  },
  priceForNextMintFunction,
  tokenBondFunction,
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface TokenPriceInfo {
  /** Cost to mint 1 full token (18 decimals), formatted as string */
  pricePerToken: string;
  /** Raw price in wei */
  priceRaw: bigint;
  /** Total minted supply, formatted */
  totalSupply: string;
  /** Total minted supply raw */
  totalSupplyRaw: bigint;
}

/**
 * Fetch current token price and bond info from MCV2_Bond for a storyline token.
 * Uses priceForNextMint for a simpler, single-call price read.
 *
 * Returns null if the token has no bond or the query fails.
 */
export async function getTokenPrice(
  tokenAddress: Address,
  client?: typeof publicClient,
): Promise<TokenPriceInfo | null> {
  const rpc = client ?? publicClient;
  const fetcher = async () => {
    const [priceRaw, totalSupplyRaw] = await Promise.all([
      rpc.readContract({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "priceForNextMint",
        args: [tokenAddress],
      }),
      rpc.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "totalSupply",
      }),
    ]);

    return {
      pricePerToken: formatUnits(priceRaw, 18),
      priceRaw: BigInt(priceRaw),
      totalSupply: formatUnits(totalSupplyRaw, 18),
      totalSupplyRaw,
    } satisfies TokenPriceInfo;
  };

  try {
    if (client) return await fetcher();
    return await priceCache.get(`price:${tokenAddress.toLowerCase()}`, fetcher, 60);
  } catch {
    return null;
  }
}

/** ~24 hours of blocks on Base at 2s block time */
const BLOCKS_PER_24H = BigInt(43200);

/**
 * Get 24h price change percentage for a token using on-chain block diff.
 * Compares priceForNextMint at current block vs ~24h ago.
 *
 * Returns null if the read fails (e.g. token didn't exist 24h ago).
 */
export async function get24hPriceChange(
  tokenAddress: Address,
  client?: typeof publicClient,
): Promise<{ changePercent: number; currentPrice: bigint; previousPrice: bigint } | null> {
  const rpc = client ?? publicClient;
  const fetcher = async () => {
    const currentBlock = await rpc.getBlockNumber();
    const pastBlock = currentBlock - BLOCKS_PER_24H;

    const [currentPrice, previousPrice] = await Promise.all([
      rpc.readContract({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "priceForNextMint",
        args: [tokenAddress],
      }),
      rpc.readContract({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "priceForNextMint",
        args: [tokenAddress],
        blockNumber: pastBlock,
      }),
    ]);

    const current = BigInt(currentPrice);
    const previous = BigInt(previousPrice);

    if (previous === BigInt(0)) {
      return { changePercent: 0, currentPrice: current, previousPrice: previous };
    }

    const changePercent =
      Number(((current - previous) * BigInt(10000)) / previous) / 100;

    return { changePercent, currentPrice: current, previousPrice: previous };
  };

  try {
    if (client) return await fetcher();
    return await priceCache.get(`24h:${tokenAddress.toLowerCase()}`, fetcher, 60);
  } catch {
    return null;
  }
}

const erc20DecimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

/**
 * Get TVL (reserve balance) for a token from its MCV2_Bond tokenBond data.
 * Fetches the reserve token's decimals on-chain for correct formatting.
 *
 * Returns null if the read fails.
 */
export async function getTokenTVL(
  tokenAddress: Address,
  client?: typeof publicClient,
): Promise<{ tvl: string; tvlRaw: bigint; reserveToken: Address; decimals: number } | null> {
  const rpc = client ?? publicClient;
  const fetcher = async () => {
    const result = await rpc.readContract({
      address: MCV2_BOND,
      abi: mcv2BondAbi,
      functionName: "tokenBond",
      args: [tokenAddress],
    });

    const [, , , , reserveToken, reserveBalance] = result;
    const reserveAddr = reserveToken as Address;

    const decimals = await rpc.readContract({
      address: reserveAddr,
      abi: erc20DecimalsAbi,
      functionName: "decimals",
    });

    return {
      tvl: formatUnits(reserveBalance, decimals),
      tvlRaw: reserveBalance,
      reserveToken: reserveAddr,
      decimals,
    };
  };

  try {
    if (client) return await fetcher();
    return await priceCache.get(`tvl:${tokenAddress.toLowerCase()}`, fetcher, 60);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batched multicall for multiple tokens (home page)
// ---------------------------------------------------------------------------

export interface BatchTokenEntry {
  price: TokenPriceInfo | null;
  tvl: { tvl: string; tvlRaw: bigint; reserveToken: Address; decimals: number } | null;
}

/**
 * Fetch price + TVL for multiple tokens in a single multicall RPC request.
 * Returns a Map keyed by lowercase token address.
 *
 * Each token produces 3 calls: priceForNextMint, totalSupply, tokenBond.
 */
export async function getBatchTokenData(
  tokenAddresses: Address[],
  client?: typeof publicClient,
): Promise<Map<string, BatchTokenEntry>> {
  if (tokenAddresses.length === 0) return new Map();

  const rpcClient = client ?? publicClient;
  const fetcher = async () => {
    const result = new Map<string, BatchTokenEntry>();

    const calls = tokenAddresses.flatMap((token) => [
      {
        address: MCV2_BOND as Address,
        abi: [priceForNextMintFunction],
        functionName: "priceForNextMint" as const,
        args: [token] as const,
      },
      {
        address: token,
        abi: erc20Abi,
        functionName: "totalSupply" as const,
      },
      {
        address: MCV2_BOND as Address,
        abi: [tokenBondFunction],
        functionName: "tokenBond" as const,
        args: [token] as const,
      },
    ]);

    const multicallResults = await rpcClient.multicall({
      contracts: calls,
      allowFailure: true,
    });

    for (let i = 0; i < tokenAddresses.length; i++) {
      const addr = tokenAddresses[i].toLowerCase();
      const base = i * 3;
      const priceResult = multicallResults[base];
      const supplyResult = multicallResults[base + 1];
      const bondResult = multicallResults[base + 2];

      let price: TokenPriceInfo | null = null;
      if (priceResult.status === "success" && supplyResult.status === "success") {
        const priceRaw = priceResult.result as bigint;
        const totalSupplyRaw = supplyResult.result as bigint;
        price = {
          pricePerToken: formatUnits(priceRaw, 18),
          priceRaw,
          totalSupply: formatUnits(totalSupplyRaw, 18),
          totalSupplyRaw,
        };
      }

      let tvl: BatchTokenEntry["tvl"] = null;
      if (bondResult.status === "success") {
        const bondData = bondResult.result as readonly unknown[];
        const reserveToken = bondData[4] as Address;
        const reserveBalance = bondData[5] as bigint;
        tvl = {
          tvl: formatUnits(reserveBalance, 18),
          tvlRaw: reserveBalance,
          reserveToken,
          decimals: 18,
        };
      }

      result.set(addr, { price, tvl });
    }

    return result;
  };

  if (client) return fetcher().catch(() => new Map());

  const cacheKey = `batch:${tokenAddresses.map((a) => a.toLowerCase()).sort().join(",")}`;
  return priceCache.get(cacheKey, fetcher, 60).catch(() => new Map());
}

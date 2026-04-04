"use client";

import { useState, useCallback } from "react";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseUnits, formatUnits, type Address } from "viem";
import { browserClient as publicClient } from "../../lib/rpc";
import { mcv2BondAbi, erc20Abi } from "../../lib/price";
import { formatTokenAmount } from "../../lib/format";
import {
  MCV2_BOND, PLOT_TOKEN, RESERVE_LABEL, EXPLORER_URL,
  ZAP_PLOTLINK, SUPPORTED_ZAP_TOKENS, ETH_ADDRESS,
} from "../../lib/contracts/constants";
import { getZapQuote, buildZapMintTx } from "../../lib/zap";
import { indexFetch } from "../../lib/index-fetch";

type Tab = "buy" | "sell";
type TxState = "idle" | "approving" | "confirming" | "pending" | "done" | "error";
type PayToken = "ETH" | "USDC" | "HUNT" | "PLOT";

const SLIPPAGE_BPS = 300; // 3% slippage tolerance

function applySlippage(amount: bigint, isBuy: boolean): bigint {
  if (isBuy) {
    return amount + (amount * BigInt(SLIPPAGE_BPS)) / BigInt(10000);
  }
  return amount - (amount * BigInt(SLIPPAGE_BPS)) / BigInt(10000);
}

const isZapAvailable = ZAP_PLOTLINK !== "0x0000000000000000000000000000000000000000";


/** Retry a writeContractAsync call once if it fails with a nonce error. */
async function retryOnNonceError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("nonce") && msg.includes("low")) {
      await new Promise((r) => setTimeout(r, 500));
      return await fn();
    }
    throw err;
  }
}

function getTokenDecimals(payToken: PayToken): number {
  if (payToken === "USDC") return 6;
  return 18;
}

function getTokenAddress(payToken: PayToken): Address {
  const token = SUPPORTED_ZAP_TOKENS.find((t) => t.symbol === payToken);
  return token?.address ?? ETH_ADDRESS as Address;
}

const ETH_GAS_BUFFER = BigInt("1000000000000000"); // 0.001 ETH reserved for gas

export function TradingWidget({ tokenAddress }: { tokenAddress: Address }) {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("buy");
  const [payToken, setPayToken] = useState<PayToken>(isZapAvailable ? "ETH" : "PLOT");
  const [amount, setAmount] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { data: ethBalanceData, refetch: refetchEthBalance } = useBalance({ address });

  const isPlotMode = payToken === "PLOT" || !isZapAvailable;
  const isEthMode = payToken === "ETH" && isZapAvailable;
  const isErc20ZapMode = (payToken === "USDC" || payToken === "HUNT") && isZapAvailable;
  const isZapMode = tab === "buy" && !isPlotMode && isZapAvailable;

  const parsedAmount =
    amount && !isNaN(Number(amount)) && Number(amount) > 0
      ? parseUnits(amount, 18) // storyline tokens are always 18 decimals
      : BigInt(0);

  const hasAmount = parsedAmount > BigInt(0);

  // Balance token for PLOT mode / sell
  const balanceToken = tab === "buy" && isPlotMode ? PLOT_TOKEN : tokenAddress;
  // ERC-20 balance token for USDC/HUNT modes
  const erc20BalanceToken = isErc20ZapMode ? getTokenAddress(payToken) : undefined;

  const { data: tradeData, refetch: refetchTradeData } = useQuery({
    queryKey: ["trade-data", address, tab, tokenAddress, amount, payToken],
    queryFn: async () => {
      if (tab === "buy" && isZapMode) {
        // Zap mode (ETH/USDC/HUNT): get quote from contract
        let zapQuote = null;
        let erc20Balance: bigint | undefined;

        if (hasAmount) {
          try {
            zapQuote = await getZapQuote(
              getTokenAddress(payToken),
              tokenAddress,
              parsedAmount,
              "exact-output",
            );
          } catch {
            zapQuote = null;
          }
        }

        // Fetch ERC-20 balance for USDC/HUNT
        if (isErc20ZapMode && erc20BalanceToken && address) {
          erc20Balance = await publicClient.readContract({
            address: erc20BalanceToken,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          });
        }

        return { balance: erc20Balance, estimate: null, zapQuote };
      }

      // PLOT mode or sell: existing multicall
      const contracts: Array<{ address: Address; abi: typeof erc20Abi | typeof mcv2BondAbi; functionName: string; args?: readonly unknown[] }> = [
        {
          address: balanceToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address!],
        },
      ];

      if (hasAmount) {
        contracts.push({
          address: MCV2_BOND,
          abi: mcv2BondAbi,
          functionName: tab === "buy" ? "getReserveForToken" : "getRefundForTokens",
          args: [tokenAddress, parsedAmount],
        });
      }

      const results = await publicClient.multicall({ contracts, allowFailure: true });

      const bal = results[0].status === "success" ? (results[0].result as bigint) : undefined;
      let est: bigint | null = null;
      if (hasAmount && results[1]?.status === "success") {
        est = (results[1].result as unknown as readonly [bigint, bigint])[0];
      }

      return { balance: bal, estimate: est, zapQuote: null };
    },
    enabled: !!address,
    refetchInterval: 60000,
  });

  // Resolve balance based on mode
  const balance = (() => {
    if (tab === "sell") return tradeData?.balance;
    if (isEthMode) return ethBalanceData?.value;
    if (isErc20ZapMode) return tradeData?.balance;
    return tradeData?.balance; // PLOT mode
  })();

  const estimate = tradeData?.estimate ?? null;
  const zapQuote = tradeData?.zapQuote ?? null;

  const refetchBalance = useCallback(() => {
    refetchTradeData();
    if (isEthMode) refetchEthBalance();
  }, [refetchTradeData, refetchEthBalance, isEthMode]);

  // MAX button handler for buy tab
  const handleBuyMax = useCallback(async () => {
    if (!address || !isConnected) return;

    try {
      let maxBalance: bigint;
      if (isEthMode) {
        const ethBal = ethBalanceData?.value ?? BigInt(0);
        maxBalance = ethBal > ETH_GAS_BUFFER ? ethBal - ETH_GAS_BUFFER : BigInt(0);
      } else if (isErc20ZapMode && erc20BalanceToken) {
        maxBalance = await publicClient.readContract({
          address: erc20BalanceToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
      } else {
        // PLOT mode
        maxBalance = await publicClient.readContract({
          address: PLOT_TOKEN,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
      }

      if (maxBalance <= BigInt(0)) return;

      if (isPlotMode) {
        // PLOT mode: find max storyline tokens mintable within PLOT balance.
        // Uses batched multicall probes to minimize RPC round-trips (2-4 calls total).

        // Step 1: Exponential search to find upper bound.
        // Start from 1e12 (0.000001 tokens) to handle fractional balances,
        // up to 1e37 (1e19 whole tokens) for cheap early-curve positions.
        const expProbes: bigint[] = [];
        for (let exp = 12; exp <= 37; exp++) {
          expProbes.push(BigInt(10) ** BigInt(exp));
        }

        const expResults = await publicClient.multicall({
          contracts: expProbes.map((probe) => ({
            address: MCV2_BOND,
            abi: mcv2BondAbi,
            functionName: "getReserveForToken" as const,
            args: [tokenAddress, probe],
          })),
          allowFailure: true,
        });

        // Find the highest probe that fits within maxBalance
        let lo = BigInt(0);
        let hi = BigInt(0);
        for (let i = 0; i < expResults.length; i++) {
          const r = expResults[i];
          if (r.status === "success") {
            const [reserveNeeded] = r.result as unknown as [bigint, bigint];
            if (reserveNeeded <= maxBalance) {
              lo = expProbes[i];
              hi = i + 1 < expProbes.length ? expProbes[i + 1] : expProbes[i] * BigInt(10);
            } else {
              hi = expProbes[i];
              break;
            }
          } else {
            hi = i > 0 ? expProbes[i] : expProbes[0];
            break;
          }
        }

        if (lo <= BigInt(0)) {
          // Even 1 token exceeds balance — nothing to do
        } else {
          // Step 2-3: Two rounds of 16-point linear probes to narrow down (~2 multicalls)
          let best = lo;
          for (let round = 0; round < 2; round++) {
            const step = (hi - lo) / BigInt(17);
            if (step <= BigInt(0)) break;

            const probes: bigint[] = [];
            for (let i = 1; i <= 16; i++) {
              probes.push(lo + step * BigInt(i));
            }

            const results = await publicClient.multicall({
              contracts: probes.map((probe) => ({
                address: MCV2_BOND,
                abi: mcv2BondAbi,
                functionName: "getReserveForToken" as const,
                args: [tokenAddress, probe],
              })),
              allowFailure: true,
            });

            let narrowedHi = hi;
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              if (r.status === "success") {
                const [reserveNeeded] = r.result as unknown as [bigint, bigint];
                if (reserveNeeded <= maxBalance) {
                  best = probes[i];
                  lo = probes[i];
                } else {
                  narrowedHi = probes[i];
                  break;
                }
              } else {
                narrowedHi = i > 0 ? probes[i] : lo;
                break;
              }
            }
            hi = narrowedHi;
          }

          if (best > BigInt(0)) {
            setAmount(formatUnits(best, 18));
          }
        }
      } else {
        // Zap mode (ETH/USDC/HUNT): get quote from zap contract
        const fromToken = getTokenAddress(payToken);
        const quote = await getZapQuote(fromToken, tokenAddress, maxBalance, "exact-input");
        if (quote.tokensOut && quote.tokensOut > BigInt(0)) {
          setAmount(formatUnits(quote.tokensOut, 18));
        }
      }
    } catch {
      // Silently fail — user can enter amount manually
    }
  }, [address, isConnected, isEthMode, isErc20ZapMode, isPlotMode, erc20BalanceToken, payToken, tokenAddress, ethBalanceData]);

  const executeTrade = useCallback(async () => {
    if (!address || parsedAmount === BigInt(0)) return;

    try {
      setError(null);
      setTxHash(null);
      let tradeHash: string | null = null;

      if (tab === "buy" && isZapMode && zapQuote) {
        const fromToken = getTokenAddress(payToken);

        // ERC-20 zap tokens need approval to ZAP_PLOTLINK first
        if (isErc20ZapMode) {
          const allowance = await publicClient.readContract({
            address: fromToken,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, ZAP_PLOTLINK],
          });

          if (allowance < zapQuote.fromTokenAmount) {
            setTxState("approving");
            const approveHash = await writeContractAsync({
              address: fromToken,
              abi: erc20Abi,
              functionName: "approve",
              args: [ZAP_PLOTLINK, zapQuote.fromTokenAmount],
            });
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
          }
        }

        setTxState("confirming");
        const tx = buildZapMintTx(fromToken, tokenAddress, parsedAmount, "exact-output", zapQuote);
        const hash = await retryOnNonceError(() => writeContractAsync(tx));
        setTxHash(hash);
        tradeHash = hash;
        setTxState("pending");
        await publicClient.waitForTransactionReceipt({ hash });
      } else if (tab === "buy" && isPlotMode && estimate) {
        // PLOT mode: approve PLOT_TOKEN -> MCV2_Bond.mint
        const maxCost = applySlippage(estimate, true);

        const allowance = await publicClient.readContract({
          address: PLOT_TOKEN,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, MCV2_BOND],
        });

        if (allowance < maxCost) {
          setTxState("approving");
          const approveHash = await writeContractAsync({
            address: PLOT_TOKEN,
            abi: erc20Abi,
            functionName: "approve",
            args: [MCV2_BOND, maxCost],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        setTxState("confirming");
        const hash = await retryOnNonceError(() => writeContractAsync({
          address: MCV2_BOND,
          abi: mcv2BondAbi,
          functionName: "mint",
          args: [tokenAddress, parsedAmount, maxCost, address],
          gas: BigInt(2_000_000),
        }));
        setTxHash(hash);
        tradeHash = hash;
        setTxState("pending");
        await publicClient.waitForTransactionReceipt({ hash });
      } else if (tab === "sell" && estimate) {
        // Sell: approve storyline token -> burn -> receive PLOT_TOKEN
        const minRefund = applySlippage(estimate, false);

        const allowance = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, MCV2_BOND],
        });

        if (allowance < parsedAmount) {
          setTxState("approving");
          const approveHash = await writeContractAsync({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [MCV2_BOND, parsedAmount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        setTxState("confirming");
        const hash = await retryOnNonceError(() => writeContractAsync({
          address: MCV2_BOND,
          abi: mcv2BondAbi,
          functionName: "burn",
          args: [tokenAddress, parsedAmount, minRefund, address],
          gas: BigInt(2_000_000),
        }));
        setTxHash(hash);
        tradeHash = hash;
        setTxState("pending");
        await publicClient.waitForTransactionReceipt({ hash });
      } else {
        return;
      }

      setTxState("done");
      setAmount("");
      refetchBalance();

      // Index the trade for price history (fire-and-forget)
      if (tradeHash) {
        indexFetch("/api/index/trade", { txHash: tradeHash, tokenAddress }).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
      setTxState("error");
    }
  }, [address, parsedAmount, estimate, zapQuote, tab, payToken, isZapMode, isPlotMode, isErc20ZapMode, tokenAddress, writeContractAsync, refetchBalance]);

  const reset = useCallback(() => {
    setTxState("idle");
    setError(null);
    setTxHash(null);
  }, []);

  // Pre-validate balance
  const insufficientBalance = (() => {
    if (balance === undefined || parsedAmount <= BigInt(0)) return false;
    if (tab === "sell") return parsedAmount > balance;
    if (isZapMode && zapQuote) return zapQuote.fromTokenAmount > balance;
    if (isPlotMode && estimate) return applySlippage(estimate, true) > balance;
    return false;
  })();

  if (!isConnected) return null;

  // Display helpers
  const balanceDecimals = isEthMode ? 18 : isErc20ZapMode ? getTokenDecimals(payToken) : 18;
  const balanceLabel = isZapMode ? payToken : tab === "buy" ? RESERVE_LABEL : "tokens";
  const estimateDecimals = isZapMode ? (isEthMode ? 18 : getTokenDecimals(payToken)) : 18;

  return (
    <section className="border-border mt-8 rounded border px-4 py-4">
      <h2 className="text-foreground group relative text-sm font-medium">
        Trade to Support
        <span className="bg-background border-border text-muted pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-64 rounded border p-2 text-[10px] font-normal leading-snug shadow-md group-hover:block">
          Every trade generates a creator royalty — buying and selling these story tokens directly supports the writer to keep continuing this story.
        </span>
      </h2>

      {/* Tabs */}
      <div className="mt-3 flex gap-2">
        {(["buy", "sell"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setAmount("");
              reset();
            }}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              tab === t
                ? "bg-accent text-background"
                : "border-border text-muted hover:text-foreground border"
            }`}
          >
            {t === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {/* Pay token selector (buy tab only) + balance */}
      {tab === "buy" && isZapAvailable && (
        <div className="mt-2">
          <div className="flex items-center gap-1">
            <span className="text-muted text-[10px] uppercase tracking-wider">Pay with</span>
            {(["ETH", "USDC", "HUNT", "PLOT"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setPayToken(t);
                  setAmount("");
                  reset();
                }}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  payToken === t
                    ? "bg-accent text-background"
                    : "border-border text-muted hover:text-foreground border"
                }`}
              >
                {t === "PLOT" ? RESERVE_LABEL : t}
              </button>
            ))}
          </div>
          {balance !== undefined && (
            <p className="text-muted mt-1 text-[10px]">
              Balance: {formatTokenAmount(balance, balanceDecimals)} {balanceLabel}
            </p>
          )}
          {insufficientBalance && (
            <p className="mt-1 text-[10px] text-error">Insufficient balance</p>
          )}
        </div>
      )}

      {/* Amount input */}
      <div className="mt-3">
        <label className="text-muted block text-[10px] uppercase tracking-wider">
          {tab === "buy" ? "Story tokens to buy" : "Tokens to sell"}
        </label>
        <div className="relative mt-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (txState !== "idle") reset();
            }}
            disabled={txState !== "idle" && txState !== "error" && txState !== "done"}
            className={`border-border bg-background text-foreground w-full rounded border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50 ${tab === "sell" || tab === "buy" ? "pr-14" : ""}`}
          />
          {tab === "sell" && balance !== undefined && (
            <button
              type="button"
              onClick={() => setAmount(formatUnits(balance, 18))}
              className="text-accent hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold"
            >
              MAX
            </button>
          )}
          {tab === "buy" && balance !== undefined && (
            <button
              type="button"
              onClick={handleBuyMax}
              className="text-accent hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold"
            >
              MAX
            </button>
          )}
        </div>
        {/* Balance for sell tab and non-zap buy (PLOT direct) */}
        {(tab === "sell" || !isZapAvailable) && balance !== undefined && (
          <p className="text-muted mt-1 text-[10px]">
            Balance: {formatTokenAmount(balance, balanceDecimals)} {balanceLabel}
          </p>
        )}
        {(tab === "sell" || !isZapAvailable) && insufficientBalance && (
          <p className="mt-1 text-[10px] text-error">Insufficient balance</p>
        )}
      </div>

      {/* Estimate */}
      {isZapMode && zapQuote && parsedAmount > BigInt(0) && (
        <div className="text-muted mt-2 text-xs">
          Est. cost:{" "}
          <span className="font-semibold text-accent">
            {formatTokenAmount(zapQuote.fromTokenAmount, estimateDecimals)} {payToken}
          </span>
          <span className="ml-2">(incl. 3% slippage)</span>
        </div>
      )}
      {!isZapMode && estimate != null && parsedAmount > BigInt(0) && (
        <div className="text-muted mt-2 text-xs">
          {tab === "buy" ? "Max cost" : "Min return"}:{" "}
          <span className="font-semibold text-accent">
            {formatTokenAmount(applySlippage(estimate, tab === "buy"), 18)} {RESERVE_LABEL}
          </span>
          <span className="ml-2">(incl. 3% slippage)</span>
        </div>
      )}

      {/* Action button */}
      <button
        onClick={txState === "done" || txState === "error" ? reset : executeTrade}
        disabled={
          (txState === "idle" && (
            parsedAmount === BigInt(0) ||
            (isZapMode ? !zapQuote : !estimate) ||
            insufficientBalance
          )) ||
          (txState !== "idle" && txState !== "done" && txState !== "error")
        }
        className="bg-accent text-background mt-3 w-full rounded py-2 text-xs font-medium transition-opacity disabled:opacity-40"
      >
        {txState === "idle" && (tab === "buy" ? `Buy with ${payToken === "PLOT" ? RESERVE_LABEL : payToken}` : "Sell Tokens")}
        {txState === "approving" && "Approving..."}
        {txState === "confirming" && "Confirm in wallet..."}
        {txState === "pending" && "Pending..."}
        {txState === "done" && "Done — Trade again"}
        {txState === "error" && "Retry"}
      </button>

      {/* Status */}
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
      {txHash && txState === "done" && (
        <p className="text-muted mt-2 text-xs">
          Tx:{" "}
          <a
            href={`${EXPLORER_URL}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {txHash.slice(0, 10)}...{txHash.slice(-8)}
          </a>
        </p>
      )}
    </section>
  );
}

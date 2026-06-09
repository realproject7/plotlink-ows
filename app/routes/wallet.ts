import { Hono } from "hono";
import fs from "fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { ENV_FILE } from "../lib/paths";
import { nextPlotlinkWalletName, resolveActiveWallet, selectActiveWallet, toPublicActiveWallet } from "../lib/active-wallet";
import { createOwsAccount } from "../lib/publish";

const envPath = ENV_FILE;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const PLOT_BASE = "0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4" as const;

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

const wallet = new Hono();

const KNOWN_TOKENS = {
  ETH: { symbol: "ETH", decimals: 18, address: null },
  USDC: { symbol: "USDC", decimals: 6, address: USDC_BASE },
  PLOT: { symbol: "PLOT", decimals: 18, address: PLOT_BASE },
} as const;

type SendToken = {
  symbol: string;
  decimals: number;
  address: Address | null;
};

function amountLooksValid(amount: unknown): amount is string {
  return typeof amount === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount.trim()) && !/^0(?:\.0*)?$/.test(amount.trim());
}

async function resolveSendToken(rawToken?: string, rawTokenAddress?: string): Promise<SendToken> {
  const tokenInput = (rawToken || "").trim();
  const upper = tokenInput.toUpperCase();
  if (upper in KNOWN_TOKENS) {
    return KNOWN_TOKENS[upper as keyof typeof KNOWN_TOKENS];
  }

  const candidate = rawTokenAddress?.trim() || tokenInput;
  if (!isAddress(candidate)) {
    throw new Error("Token must be ETH, PLOT, USDC, or a valid ERC-20 address");
  }

  const address = candidate as Address;
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);

  return {
    symbol: String(symbol || "TOKEN"),
    decimals: Number(decimals),
    address,
  };
}

async function erc20Balance(token: Address, owner: Address): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  }) as Promise<bigint>;
}

function formatGasRequirement(gasCost: bigint): string {
  return `${formatUnits(gasCost, 18)} ETH`;
}

function readEnvPassphrase(): string | null {
  if (process.env.OWS_PASSPHRASE) return process.env.OWS_PASSPHRASE;
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(/^OWS_PASSPHRASE=(.+)$/m);
      if (match) return match[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

/** GET /api/wallet — get wallet info */
wallet.get("/", async (c) => {
  try {
    const resolved = await resolveActiveWallet();
    const activeWallet = resolved.activeWallet;

    // Fetch balances on Base via RPC
    let ethBalance = "0";
    let usdcBalance = "0";
    let plotBalance = "0";
    if (activeWallet?.address) {
      const addrPadded = "000000000000000000000000" + activeWallet.address.slice(2).toLowerCase();
      const balanceOfSig = "0x70a08231" + addrPadded;

      try {
        // ETH balance
        const ethRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [activeWallet.address, "latest"] }),
        });
        const ethData = await ethRes.json() as { result?: string };
        if (ethData.result && ethData.result !== "0x" && ethData.result !== "0x0") {
          ethBalance = (Number(BigInt(ethData.result)) / 1e18).toFixed(6);
        }

        // USDC balance (6 decimals)
        const usdcRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: USDC_BASE, data: balanceOfSig }, "latest"] }),
        });
        const usdcData = await usdcRes.json() as { result?: string };
        if (usdcData.result && usdcData.result !== "0x") {
          usdcBalance = (Number(BigInt(usdcData.result)) / 1e6).toFixed(2);
        }

        // PLOT balance (18 decimals)
        const plotRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_call", params: [{ to: PLOT_BASE, data: balanceOfSig }, "latest"] }),
        });
        const plotData = await plotRes.json() as { result?: string };
        if (plotData.result && plotData.result !== "0x") {
          plotBalance = (Number(BigInt(plotData.result)) / 1e18).toFixed(4);
        }
      } catch { /* balance fetch best-effort */ }
    }

    if (!activeWallet) {
      return c.json({
        exists: resolved.wallets.length > 0,
        selectionRequired: resolved.selectionRequired,
        error: resolved.error,
        wallets: resolved.wallets,
      });
    }

    return c.json({
      exists: true,
      walletId: activeWallet.walletId,
      name: activeWallet.name,
      address: activeWallet.address,
      activeWallet: toPublicActiveWallet(activeWallet),
      selectionRequired: false,
      wallets: resolved.wallets,
      ethBalance,
      usdcBalance,
      plotBalance,
      accounts: activeWallet.wallet.accounts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get wallet";
    return c.json({ exists: false, error: message });
  }
});

/** POST /api/wallet/send — send ETH or ERC-20 tokens from the active OWS wallet */
wallet.post("/send", async (c) => {
  try {
    const body = await c.req.json<{ token?: string; tokenAddress?: string; to?: string; amount?: string }>();
    const to = body.to?.trim();
    if (!to || !isAddress(to)) {
      return c.json({ error: "Valid recipient address required" }, 400);
    }
    if (!amountLooksValid(body.amount)) {
      return c.json({ error: "Positive amount required" }, 400);
    }

    let token: SendToken;
    try {
      token = await resolveSendToken(body.token, body.tokenAddress);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid token";
      return c.json({ error: message }, 400);
    }

    let amount: bigint;
    try {
      amount = parseUnits(body.amount.trim(), token.decimals);
    } catch {
      return c.json({ error: `Amount has too many decimals for ${token.symbol}` }, 400);
    }

    const resolved = await resolveActiveWallet();
    const activeWallet = resolved.activeWallet;
    const from = activeWallet?.address as Address | undefined;
    if (!activeWallet || !from || !activeWallet.name) {
      return c.json({
        error: resolved.error || "No active OWS wallet selected",
        selectionRequired: resolved.selectionRequired,
        wallets: resolved.wallets,
      }, 400);
    }

    const ethBalance = await publicClient.getBalance({ address: from });
    const account = createOwsAccount(activeWallet.name, from);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(rpcUrl),
    });

    let txHash: `0x${string}`;
    if (!token.address) {
      const gas = await publicClient.estimateGas({ account, to: to as Address, value: amount });
      const gasPrice = await publicClient.getGasPrice();
      const gasCost = gas * gasPrice;
      if (ethBalance < amount + gasCost) {
        return c.json({
          error: `Insufficient ETH for amount plus gas. Estimated gas: ${formatGasRequirement(gasCost)}`,
        }, 400);
      }
      txHash = await walletClient.sendTransaction({ to: to as Address, value: amount });
    } else {
      const balance = await erc20Balance(token.address, from);
      if (balance < amount) {
        return c.json({
          error: `Insufficient ${token.symbol} balance`,
          available: formatUnits(balance, token.decimals),
          required: body.amount.trim(),
          token: token.symbol,
        }, 400);
      }

      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as Address, amount],
      });
      const gas = await publicClient.estimateGas({ account, to: token.address, data });
      const gasPrice = await publicClient.getGasPrice();
      const gasCost = gas * gasPrice;
      if (ethBalance < gasCost) {
        return c.json({
          error: `Insufficient ETH for transfer gas. Estimated gas: ${formatGasRequirement(gasCost)}`,
        }, 400);
      }

      const { request } = await publicClient.simulateContract({
        account,
        address: token.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as Address, amount],
      });
      txHash = await walletClient.writeContract(request);
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return c.json({ error: "Transfer transaction reverted", txHash }, 500);
    }

    return c.json({
      ok: true,
      txHash,
      from,
      to,
      token: token.symbol,
      tokenAddress: token.address,
      amount: formatUnits(amount, token.decimals),
      basescanUrl: `https://basescan.org/tx/${txHash}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Wallet transfer failed";
    return c.json({ error: message }, 500);
  }
});

/** POST /api/wallet/active — select active OWS wallet */
wallet.post("/active", async (c) => {
  const body = await c.req.json<{ walletId?: string; name?: string; address?: string }>();
  if (!body.walletId && !body.name && !body.address) {
    return c.json({ error: "walletId, name, or address required" }, 400);
  }

  const resolved = await selectActiveWallet(body);
  if (!resolved.activeWallet) {
    return c.json({
      error: resolved.error || "Could not select wallet",
      selectionRequired: resolved.selectionRequired,
      wallets: resolved.wallets,
    }, 400);
  }

  return c.json({
    ok: true,
    activeWallet: toPublicActiveWallet(resolved.activeWallet),
    wallets: resolved.wallets,
    selectionRequired: false,
  });
});

/** POST /api/wallet/create — create OWS wallet */
wallet.post("/create", async (c) => {
  try {
    const passphrase = readEnvPassphrase();
    if (!passphrase) {
      return c.json({ error: "Passphrase not configured" }, 400);
    }

    const { createAgentWallet, listAgentWallets } = await import("../../lib/ows/wallet");

    const wallets = listAgentWallets();
    const name = nextPlotlinkWalletName(wallets);
    const createdWallet = createAgentWallet(name, passphrase);
    const resolved = await selectActiveWallet({ walletId: createdWallet.id, name: createdWallet.name });

    return c.json({
      walletId: resolved.activeWallet?.walletId ?? createdWallet.id,
      name: createdWallet.name,
      address: resolved.activeWallet?.address,
      activeWallet: resolved.activeWallet ? toPublicActiveWallet(resolved.activeWallet) : null,
      wallets: resolved.wallets,
      alreadyExisted: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Wallet creation failed";
    return c.json({ error: message }, 500);
  }
});

export { wallet as walletRoutes };

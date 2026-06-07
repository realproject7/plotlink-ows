import { Hono } from "hono";
import fs from "fs";
import { ENV_FILE } from "../lib/paths";
import { nextPlotlinkWalletName, resolveActiveWallet, selectActiveWallet, toPublicActiveWallet } from "../lib/active-wallet";

const envPath = ENV_FILE;

const wallet = new Hono();

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
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

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
        const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
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
        const PLOT = "0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4";
        const plotRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_call", params: [{ to: PLOT, data: balanceOfSig }, "latest"] }),
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

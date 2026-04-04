import { Hono } from "hono";
import fs from "fs";
import { ENV_FILE } from "../lib/paths";

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
    const { getAgentWallet, getBaseAddress } = await import("../../lib/ows/wallet");

    // Try to find existing wallet
    const { listAgentWallets } = await import("../../lib/ows/wallet");
    const wallets = listAgentWallets();
    const plotlinkWallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));

    if (!plotlinkWallet) {
      return c.json({ exists: false });
    }

    const address = getBaseAddress(plotlinkWallet);

    // Fetch balances on Base via RPC
    let ethBalance = "0";
    let usdcBalance = "0";
    let plotBalance = "0";
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

    if (address) {
      const addrPadded = "000000000000000000000000" + address.slice(2).toLowerCase();
      const balanceOfSig = "0x70a08231" + addrPadded;

      try {
        // ETH balance
        const ethRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
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

    return c.json({
      exists: true,
      walletId: plotlinkWallet.id,
      name: plotlinkWallet.name,
      address,
      ethBalance,
      usdcBalance,
      plotBalance,
      accounts: plotlinkWallet.accounts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get wallet";
    return c.json({ exists: false, error: message });
  }
});

/** POST /api/wallet/create — create OWS wallet */
wallet.post("/create", async (c) => {
  try {
    const passphrase = readEnvPassphrase();
    if (!passphrase) {
      return c.json({ error: "Passphrase not configured" }, 400);
    }

    const { createAgentWallet, getBaseAddress, listAgentWallets } = await import("../../lib/ows/wallet");

    // Check if wallet already exists
    const wallets = listAgentWallets();
    const existing = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (existing) {
      const address = getBaseAddress(existing);
      return c.json({ walletId: existing.id, address, alreadyExisted: true });
    }

    const wallet = createAgentWallet("plotlink-writer", passphrase);
    const address = getBaseAddress(wallet);

    return c.json({ walletId: wallet.id, address, alreadyExisted: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Wallet creation failed";
    return c.json({ error: message }, 500);
  }
});

export { wallet as walletRoutes };

import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", "..", ".env");

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
    return c.json({
      exists: true,
      walletId: plotlinkWallet.id,
      name: plotlinkWallet.name,
      address,
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

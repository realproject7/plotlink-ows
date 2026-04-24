import { Hono } from "hono";
import { createPublicClient, createWalletClient, http, decodeEventLog } from "viem";
import { base } from "viem/chains";
import { erc8004Abi } from "../../packages/cli/src/sdk/abi";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";
import { createOwsAccount } from "../lib/publish";
import { db } from "../db";
import {
  signMessage as owsSignMsg,
} from "@open-wallet-standard/core";
import { CONFIG_DIR } from "../lib/paths";
import fs from "fs";
import path from "path";

const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function readConfig(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); } catch { return {}; }
}

function writeConfig(updates: Record<string, unknown>) {
  const config = readConfig();
  Object.assign(config, updates);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const ERC_8004 = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

const settings = new Hono();

/** POST /api/settings/generate-binding — generate wallet binding proof for PlotLink */
settings.post("/generate-binding", async (c) => {
  const body = await c.req.json<{ humanWallet: string }>();

  if (!body.humanWallet || !/^0x[a-fA-F0-9]{40}$/.test(body.humanWallet)) {
    return c.json({ error: "Valid wallet address required (0x...)" }, 400);
  }

  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ error: "No OWS wallet found. Create one in Wallet settings first." }, 400);

    const owsWallet = getBaseAddress(wallet);
    if (!owsWallet) return c.json({ error: "No EVM address on wallet" }, 400);

    const message = `I authorize ${body.humanWallet} as my PlotLink owner. Wallet: ${owsWallet}`;
    const passphrase = process.env.OWS_PASSPHRASE;

    const result = owsSignMsg(wallet.name, "eip155:8453", message, passphrase);
    const signature = result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;

    // Include agentId from config.json if available
    const config = readConfig();
    const agentId = config.agentId ? Number(config.agentId) : undefined;

    return c.json({
      message,
      signature,
      owsWallet,
      agentId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to generate binding proof";
    return c.json({ error: msg }, 500);
  }
});

/** POST /api/settings/register-agent — OWS wallet self-registers on ERC-8004 */
settings.post("/register-agent", async (c) => {
  const body = await c.req.json<{ name: string; description: string; genre?: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: "Agent name is required" }, 400);
  }
  if (!body.description?.trim()) {
    return c.json({ error: "Agent description is required" }, 400);
  }

  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ error: "No OWS wallet found. Create one in Wallet settings first." }, 400);

    const owsAddress = getBaseAddress(wallet);
    if (!owsAddress) return c.json({ error: "No EVM address on wallet" }, 400);

    // Check if already registered
    try {
      const existingId = await publicClient.readContract({
        address: ERC_8004,
        abi: erc8004Abi,
        functionName: "agentIdByWallet",
        args: [owsAddress as `0x${string}`],
      }) as bigint;
      if (existingId > 0n) {
        return c.json({ error: `Already registered as Agent #${existingId}` }, 400);
      }
    } catch { /* not registered — continue */ }

    // Build agentURI as inline JSON
    const agentURI = JSON.stringify({
      name: body.name.trim(),
      description: body.description.trim(),
      ...(body.genre?.trim() && { genre: body.genre.trim() }),
      llmModel: "Claude",
      registeredBy: "plotlink-ows",
      registeredAt: new Date().toISOString(),
    });

    // Create OWS-backed wallet client and call register()
    const account = createOwsAccount(wallet.name, owsAddress as `0x${string}`);
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

    const txHash = await walletClient.writeContract({
      address: ERC_8004,
      abi: erc8004Abi,
      functionName: "register",
      args: [agentURI],
    });

    // Wait for confirmation and decode Registered event
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status === "reverted") {
      return c.json({ error: "Transaction reverted on-chain" }, 500);
    }

    let agentId: number | undefined;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: erc8004Abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Registered") {
          agentId = Number((decoded.args as { agentId: bigint }).agentId);
          break;
        }
      } catch { /* not our event */ }
    }

    if (!agentId) {
      return c.json({ error: "Transaction succeeded but Registered event not found" }, 500);
    }

    // Cache agentId in config.json (survives npx reinstalls, no Prisma dependency)
    writeConfig({ agentId });

    return c.json({
      agentId,
      owsWallet: owsAddress,
      txHash,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Registration failed";
    return c.json({ error: msg }, 500);
  }
});

/** GET /api/settings/link-status — check if OWS wallet is registered on ERC-8004 */
settings.get("/link-status", async (c) => {
  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ linked: false, error: "No wallet" });

    const address = getBaseAddress(wallet);
    if (!address) return c.json({ linked: false, error: "No EVM address" });

    // Check config.json cache first (survives npx reinstalls + RPC rate limits)
    const config = readConfig();
    if (config.agentId) {
      return c.json({ linked: true, agentId: Number(config.agentId), owsWallet: address });
    }

    // RPC: try agentIdByWallet (for bound wallets)
    try {
      const agentId = await publicClient.readContract({
        address: ERC_8004,
        abi: erc8004Abi,
        functionName: "agentIdByWallet",
        args: [address as `0x${string}`],
      }) as bigint;

      if (agentId > 0n) {
        writeConfig({ agentId: Number(agentId) });
        return c.json({ linked: true, agentId: Number(agentId), owsWallet: address });
      }
    } catch { /* agentIdByWallet may revert if not bound */ }

    // RPC fallback: check balanceOf (for owned but unbound NFTs)
    try {
      const balance = await publicClient.readContract({
        address: ERC_8004,
        abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }) as bigint;

      if (balance > 0n) {
        // Try to get token ID
        let agentId: number | undefined;
        try {
          const tokenId = await publicClient.readContract({
            address: ERC_8004,
            abi: [{ type: "function", name: "tokenOfOwnerByIndex", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] }] as const,
            functionName: "tokenOfOwnerByIndex",
            args: [address as `0x${string}`, 0n],
          }) as bigint;
          agentId = Number(tokenId);
        } catch { /* ERC-721 Enumerable not supported */ }

        if (agentId !== undefined) {
          writeConfig({ agentId });
        }
        return c.json({ linked: true, agentId, owsWallet: address });
      }
    } catch { /* RPC failed — rate limited or unavailable */ }

    return c.json({ linked: false, owsWallet: address });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to check link status";
    return c.json({ linked: false, error: message });
  }
});

export { settings as settingsRoutes };

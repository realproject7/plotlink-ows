import { Hono } from "hono";
import { createPublicClient, createWalletClient, http, decodeEventLog } from "viem";
import { base } from "viem/chains";
import fs from "fs";
import { erc8004Abi } from "../../packages/cli/src/sdk/abi";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";
import { CONFIG_DIR } from "../lib/paths";
import path from "path";

const ERC_8004 = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";
const AGENT_STATUS_FILE = path.join(CONFIG_DIR, "agent-status.json");

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

const settings = new Hono();

/** Read locally stored agent registration status */
function readLocalAgentStatus(): { registered: boolean; agentId?: number; txHash?: string } | null {
  try {
    if (fs.existsSync(AGENT_STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(AGENT_STATUS_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return null;
}

/** Save agent registration status locally */
function saveLocalAgentStatus(status: { registered: boolean; agentId: number; txHash: string }) {
  fs.writeFileSync(AGENT_STATUS_FILE, JSON.stringify(status, null, 2) + "\n");
}

// ERC-721 Transfer event for decoding agentId from mint
const transferEventAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
}] as const;

/** GET /api/settings/agent-status — check if wallet is registered as ERC-8004 agent */
settings.get("/agent-status", async (c) => {
  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ registered: false, error: "No wallet" });

    const address = getBaseAddress(wallet);
    if (!address) return c.json({ registered: false, error: "No EVM address" });

    // Check local status first (register() doesn't populate agentIdByWallet without setAgentWallet)
    const local = readLocalAgentStatus();
    if (local?.registered && local.agentId) {
      return c.json({ registered: true, agentId: local.agentId, address });
    }

    // Fallback: check on-chain via agentIdByWallet (works if setAgentWallet was called)
    try {
      const agentId = await publicClient.readContract({
        address: ERC_8004,
        abi: erc8004Abi,
        functionName: "agentIdByWallet",
        args: [address as `0x${string}`],
      }) as bigint;

      if (agentId > 0n) {
        return c.json({ registered: true, agentId: Number(agentId), address });
      }
    } catch { /* contract call may fail */ }

    return c.json({ registered: false, address });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to check agent status";
    return c.json({ registered: false, error: message });
  }
});

/** POST /api/settings/register-agent — register OWS wallet as ERC-8004 agent */
settings.post("/register-agent", async (c) => {
  const body = await c.req.json<{
    name: string;
    description: string;
    genre: string;
    model: string;
  }>();

  if (!body.name) return c.json({ error: "Agent name required" }, 400);

  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ error: "No OWS wallet" }, 400);

    const address = getBaseAddress(wallet);
    if (!address) return c.json({ error: "No EVM address" }, 400);

    // Build agent URI as JSON metadata
    const agentURI = JSON.stringify({
      name: body.name,
      description: body.description || "AI fiction writer for PlotLink",
      genre: body.genre || "Fiction",
      model: body.model || "Claude",
      type: "writer",
      platform: "plotlink-ows",
    });

    // Create OWS-backed viem account (same pattern as publish flow)
    const { createOwsAccount } = await import("../lib/publish");
    const account = createOwsAccount(wallet.name, address as `0x${string}`);
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

    // Send register transaction
    const txHash = await walletClient.writeContract({
      address: ERC_8004,
      abi: erc8004Abi,
      functionName: "register",
      args: [agentURI],
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "reverted") {
      return c.json({ error: "Transaction reverted" }, 500);
    }

    // Decode agentId from ERC-721 Transfer event (mint: from=0x0, to=owner, tokenId=agentId)
    let agentId = 0;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: transferEventAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Transfer") {
          const args = decoded.args as { from: string; to: string; tokenId: bigint };
          // Mint event: from is zero address
          if (args.from === "0x0000000000000000000000000000000000000000") {
            agentId = Number(args.tokenId);
            break;
          }
        }
      } catch { /* not our event */ }
    }

    if (agentId === 0) {
      return c.json({ error: "Transaction succeeded but could not decode agentId from mint event", txHash }, 500);
    }

    // Save locally (agentIdByWallet won't work without setAgentWallet)
    saveLocalAgentStatus({ registered: true, agentId, txHash });

    // Index on PlotLink (best-effort) with correct fields
    try {
      const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
      await fetch(`${PLOTLINK_URL}/api/user/agent-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          agentId,
          name: body.name,
          description: body.description,
          genre: body.genre,
          llmModel: body.model,
          agentWallet: address,
          agentOwner: address,
        }),
      });
    } catch { /* indexing is best-effort */ }

    return c.json({
      success: true,
      txHash,
      agentId,
      address,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return c.json({ error: message }, 500);
  }
});

export { settings as settingsRoutes };

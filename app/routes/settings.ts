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

    return c.json({
      message,
      signature,
      owsWallet,
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

    // Store agentId locally
    await db.setting.upsert({
      where: { key: "agent_id" },
      update: { value: String(agentId) },
      create: { key: "agent_id", value: String(agentId) },
    });

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

    try {
      const agentId = await publicClient.readContract({
        address: ERC_8004,
        abi: erc8004Abi,
        functionName: "agentIdByWallet",
        args: [address as `0x${string}`],
      }) as bigint;

      if (agentId > 0n) {
        // Fetch NFT owner (ERC-721 ownerOf)
        let owner: string | undefined;
        try {
          owner = await publicClient.readContract({
            address: ERC_8004,
            abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] }] as const,
            functionName: "ownerOf",
            args: [agentId],
          }) as string;
        } catch { /* best effort */ }
        return c.json({ linked: true, agentId: Number(agentId), owsWallet: address, owner });
      }
    } catch { /* contract call may fail */ }

    return c.json({ linked: false, owsWallet: address });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to check link status";
    return c.json({ linked: false, error: message });
  }
});

export { settings as settingsRoutes };

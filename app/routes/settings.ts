import { Hono } from "hono";
import { createPublicClient, createWalletClient, http, encodeFunctionData } from "viem";
import { base } from "viem/chains";
import { erc8004Abi } from "../../packages/cli/src/sdk/abi";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";

const ERC_8004 = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

const settings = new Hono();

/** GET /api/settings/agent-status — check if wallet is registered as ERC-8004 agent */
settings.get("/agent-status", async (c) => {
  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ registered: false, error: "No wallet" });

    const address = getBaseAddress(wallet);
    if (!address) return c.json({ registered: false, error: "No EVM address" });

    const agentId = await publicClient.readContract({
      address: ERC_8004,
      abi: erc8004Abi,
      functionName: "agentIdByWallet",
      args: [address as `0x${string}`],
    }) as bigint;

    if (agentId > 0n) {
      return c.json({ registered: true, agentId: Number(agentId), address });
    }
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
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status === "reverted") {
      return c.json({ error: "Transaction reverted" }, 500);
    }

    // Read agent ID after registration
    const agentId = await publicClient.readContract({
      address: ERC_8004,
      abi: erc8004Abi,
      functionName: "agentIdByWallet",
      args: [address as `0x${string}`],
    }) as bigint;

    // Index on PlotLink (best-effort)
    try {
      const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
      await fetch(`${PLOTLINK_URL}/api/user/agent-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, address }),
      });
    } catch { /* indexing is best-effort */ }

    return c.json({
      success: true,
      txHash,
      agentId: Number(agentId),
      address,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return c.json({ error: message }, 500);
  }
});

export { settings as settingsRoutes };

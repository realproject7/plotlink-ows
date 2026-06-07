import { Hono } from "hono";
import { createPublicClient, createWalletClient, http, decodeEventLog } from "viem";
import { base } from "viem/chains";
import { erc8004Abi } from "../../packages/cli/src/sdk/abi";
import { resolveActiveWallet } from "../lib/active-wallet";
import { createOwsAccount } from "../lib/publish";
import { CONFIG_DIR } from "../lib/paths";
import fs from "fs";
import path from "path";

const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
type Config = Record<string, unknown>;

function readConfig(): Config {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); } catch { return {}; }
}

function writeConfig(updates: Config) {
  const config = readConfig();
  Object.assign(config, updates);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function normalizeAddress(address: unknown): string | null {
  return typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address)
    ? address.toLowerCase()
    : null;
}

function getWalletAgentConfig(
  config: Config,
  wallet: { walletId?: string; name: string; address: string },
  selectableWalletCount: number,
): Config | null {
  if (!config.agentId) return null;

  const cachedAddress = normalizeAddress(config.agentWalletAddress);
  const activeAddress = normalizeAddress(wallet.address);
  if (cachedAddress && activeAddress) {
    return cachedAddress === activeAddress ? config : null;
  }

  if (typeof config.agentWalletId === "string" && wallet.walletId) {
    return config.agentWalletId === wallet.walletId ? config : null;
  }

  if (typeof config.agentWalletName === "string") {
    return config.agentWalletName === wallet.name ? config : null;
  }

  // Backwards compatibility for pre-#196 installs: an unscoped cache can only
  // be trusted when there is no wallet-switching ambiguity.
  return selectableWalletCount <= 1 ? config : null;
}

function walletAgentConfig(wallet: { walletId?: string; name: string; address: string }, updates: Config): Config {
  return {
    ...updates,
    agentWalletAddress: wallet.address.toLowerCase(),
    agentWalletName: wallet.name,
    ...(wallet.walletId ? { agentWalletId: wallet.walletId } : {}),
  };
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
    const resolvedWallet = await resolveActiveWallet();
    const wallet = resolvedWallet.activeWallet;
    if (!wallet) {
      return c.json({
        error: resolvedWallet.error || "No OWS wallet found. Create one in Wallet settings first.",
        selectionRequired: resolvedWallet.selectionRequired,
        wallets: resolvedWallet.wallets,
      }, 400);
    }

    const owsWallet = wallet.address;
    if (!owsWallet) return c.json({ error: "No EVM address on wallet" }, 400);

    const message = `I authorize ${body.humanWallet} as my PlotLink owner. Wallet: ${owsWallet}`;
    const account = createOwsAccount(wallet.name, owsWallet as `0x${string}`);
    const signature = await account.signMessage({ message });

    // Include agent data from config.json if available
    const config = getWalletAgentConfig(readConfig(), wallet, resolvedWallet.wallets.filter((w) => w.address).length);

    return c.json({
      message,
      signature,
      owsWallet,
      agentId: config?.agentId ? Number(config.agentId) : undefined,
      agentName: (config?.agentName as string) || undefined,
      agentDescription: (config?.agentDescription as string) || undefined,
      agentGenre: (config?.agentGenre as string) || undefined,
      agentLlmModel: (config?.agentLlmModel as string) || undefined,
      agentRegisteredBy: (config?.agentRegisteredBy as string) || undefined,
      agentRegisteredAt: (config?.agentRegisteredAt as string) || undefined,
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
    const resolvedWallet = await resolveActiveWallet();
    const wallet = resolvedWallet.activeWallet;
    if (!wallet) {
      return c.json({
        error: resolvedWallet.error || "No OWS wallet found. Create one in Wallet settings first.",
        selectionRequired: resolvedWallet.selectionRequired,
        wallets: resolvedWallet.wallets,
      }, 400);
    }

    const owsAddress = wallet.address;
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
    const registeredAt = new Date().toISOString();
    const agentURI = JSON.stringify({
      name: body.name.trim(),
      description: body.description.trim(),
      ...(body.genre?.trim() && { genre: body.genre.trim() }),
      llmModel: "Claude",
      registeredBy: "plotlink-ows",
      registeredAt,
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

    // Cache full tokenURI data in config.json (survives npx reinstalls, no Prisma dependency)
    writeConfig(walletAgentConfig(wallet, {
      agentId,
      agentName: body.name.trim(),
      agentDescription: body.description.trim(),
      ...(body.genre?.trim() && { agentGenre: body.genre.trim() }),
      agentLlmModel: "Claude",
      agentRegisteredBy: "plotlink-ows",
      agentRegisteredAt: registeredAt,
    }));

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
    const resolvedWallet = await resolveActiveWallet();
    const wallet = resolvedWallet.activeWallet;
    if (!wallet) {
      return c.json({
        linked: false,
        error: resolvedWallet.error || "No wallet",
        selectionRequired: resolvedWallet.selectionRequired,
        wallets: resolvedWallet.wallets,
      });
    }

    const address = wallet.address;
    if (!address) return c.json({ linked: false, error: "No EVM address" });

    // Check config.json cache first (survives npx reinstalls + RPC rate limits)
    const config = getWalletAgentConfig(readConfig(), wallet, resolvedWallet.wallets.filter((w) => w.address).length);
    if (config?.agentId) {
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
        writeConfig(walletAgentConfig(wallet, { agentId: Number(agentId) }));
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
          writeConfig(walletAgentConfig(wallet, { agentId }));
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

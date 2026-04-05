import { Hono } from "hono";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { erc8004Abi } from "../../packages/cli/src/sdk/abi";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";
import {
  signMessage as owsSignMsg,
  signTypedData as owsSignTypedData,
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

/** POST /api/settings/generate-wallet-bind — generate EIP-712 signature for setAgentWallet */
settings.post("/generate-wallet-bind", async (c) => {
  const body = await c.req.json<{ agentId: number; humanWallet: string }>();

  if (!body.agentId || body.agentId <= 0) {
    return c.json({ error: "Valid agentId required" }, 400);
  }
  if (!body.humanWallet || !/^0x[a-fA-F0-9]{40}$/.test(body.humanWallet)) {
    return c.json({ error: "Valid human wallet address required (0x...)" }, 400);
  }

  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ error: "No OWS wallet found." }, 400);

    const owsWallet = getBaseAddress(wallet);
    if (!owsWallet) return c.json({ error: "No EVM address on wallet" }, 400);

    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min expiry

    // EIP-712 typed data matching ERC8004IdentityRegistry.setAgentWallet
    const typedData = {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        AgentWalletSet: [
          { name: "agentId", type: "uint256" },
          { name: "newWallet", type: "address" },
          { name: "owner", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "AgentWalletSet",
      domain: {
        name: "ERC8004IdentityRegistry",
        version: "1",
        chainId: 8453,
        verifyingContract: ERC_8004,
      },
      message: {
        agentId: body.agentId,
        newWallet: owsWallet,
        owner: body.humanWallet,
        deadline,
      },
    };

    const passphrase = process.env.OWS_PASSPHRASE;
    const result = owsSignTypedData(wallet.name, "eip155:8453", JSON.stringify(typedData), passphrase);
    const signature = result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;

    return c.json({
      signature,
      owsWallet,
      agentId: body.agentId,
      deadline,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to generate wallet bind signature";
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

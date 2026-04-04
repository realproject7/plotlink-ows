import { Hono } from "hono";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { db } from "../db";
import { getEthBalance } from "../lib/publish";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";
import { mcv2BondAbi } from "../../packages/cli/src/sdk/abi";

const MCV2_BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27" as const;
const WETH_BASE = "0x4200000000000000000000000000000000000006" as const;

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

const dashboard = new Hono();

/** GET /api/dashboard — writer dashboard data */
dashboard.get("/", async (c) => {
  // Get all drafts (published and unpublished)
  const drafts = await db.draft.findMany({
    orderBy: { createdAt: "desc" },
  });

  // Get wallet info
  let walletInfo = null;
  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (wallet) {
      const address = getBaseAddress(wallet);
      if (address) {
        const ethBalance = await getEthBalance(address);

        // Fetch USDC balance
        let usdcBalance = "0";
        try {
          const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
          const balanceOfSig = "0x70a08231000000000000000000000000" + address.slice(2).toLowerCase();
          const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";
          const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: USDC_BASE, data: balanceOfSig }, "latest"] }),
          });
          const data = await res.json() as { result?: string };
          if (data.result && data.result !== "0x") {
            usdcBalance = (Number(BigInt(data.result)) / 1e6).toFixed(2);
          }
        } catch { /* best effort */ }

        walletInfo = {
          address,
          ethBalance: ethBalance.toString(),
          ethFormatted: (Number(ethBalance) / 1e18).toFixed(6),
          usdcBalance,
        };
      }
    }
  } catch { /* wallet not available */ }

  // Published stories with cost data
  const published = drafts.filter((d) => d.status === "published");
  const unpublished = drafts.filter((d) => d.status !== "published");

  // Compute total costs
  const totalGasCostWei = published.reduce((sum, d) => {
    if (d.gasCost) return sum + BigInt(d.gasCost);
    return sum;
  }, BigInt(0));
  const totalGasCostEth = (Number(totalGasCostWei) / 1e18).toFixed(6);

  // Query on-chain royalties (WETH on Base — bonding curve reserve)
  let royaltiesEarned = "0";
  let royaltiesClaimed = "0";
  if (walletInfo?.address) {
    try {
      const [balance, claimed] = await publicClient.readContract({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "getRoyaltyInfo",
        args: [walletInfo.address as `0x${string}`, WETH_BASE],
      }) as [bigint, bigint];
      royaltiesEarned = (Number(balance) / 1e18).toFixed(6);
      royaltiesClaimed = (Number(claimed) / 1e18).toFixed(6);
    } catch { /* no royalties or contract not available */ }
  }

  const netPnl = (parseFloat(royaltiesEarned) - parseFloat(totalGasCostEth)).toFixed(6);

  // Session stats
  const sessions = await db.storySession.findMany({
    include: { _count: { select: { messages: true } } },
  });

  return c.json({
    wallet: walletInfo,
    stories: {
      published: published.map((d) => ({
        id: d.id,
        title: d.title,
        genre: d.genre,
        status: d.status,
        txHash: d.txHash,
        storylineId: d.storylineId,
        contentCid: d.contentCid,
        gasCost: d.gasCost,
        gasCostEth: d.gasCost ? (Number(BigInt(d.gasCost)) / 1e18).toFixed(6) : null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      drafts: unpublished.map((d) => ({
        id: d.id,
        title: d.title,
        genre: d.genre,
        status: d.status,
        createdAt: d.createdAt,
      })),
      totalPublished: published.length,
      totalDrafts: unpublished.length,
    },
    costs: {
      totalGasCostWei: totalGasCostWei.toString(),
      totalGasCostEth,
      storiesPublished: published.length,
    },
    royalties: {
      earned: royaltiesEarned,
      claimed: royaltiesClaimed,
      unclaimed: (parseFloat(royaltiesEarned) - parseFloat(royaltiesClaimed)).toFixed(6),
    },
    pnl: {
      totalCosts: totalGasCostEth,
      totalRoyalties: royaltiesEarned,
      net: netPnl,
    },
    sessions: {
      total: sessions.length,
      totalMessages: sessions.reduce((sum, s) => sum + s._count.messages, 0),
    },
  });
});

/** DELETE /api/dashboard/drafts/:id — delete a draft */
dashboard.delete("/drafts/:id", async (c) => {
  const id = c.req.param("id");
  try {
    await db.draft.delete({ where: { id } });
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Draft not found" }, 404);
  }
});

export { dashboard as dashboardRoutes };

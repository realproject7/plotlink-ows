import { Hono } from "hono";
import { db } from "../db";
import { getEthBalance } from "../lib/publish";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";

const dashboard = new Hono();

/** GET /api/dashboard — writer dashboard data */
dashboard.get("/", async (c) => {
  // Get all drafts (published and unpublished)
  const drafts = await db.draft.findMany({
    orderBy: { createdAt: "desc" },
    include: { session: { select: { title: true, genre: true } } },
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

  // Compute stats
  const published = drafts.filter((d) => d.status === "published");
  const unpublished = drafts.filter((d) => d.status !== "published");
  const totalStories = published.length;

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
      totalPublished: totalStories,
      totalDrafts: unpublished.length,
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

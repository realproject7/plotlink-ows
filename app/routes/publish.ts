import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db } from "../db";
import { publishStoryline, getEthBalance, uploadToIPFS } from "../lib/publish";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";

const publish = new Hono();

/** GET /api/publish/preflight — check if publishing is possible */
publish.get("/preflight", async (c) => {
  try {
    // Check wallet
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) {
      return c.json({ ready: false, error: "No OWS wallet found" });
    }

    const address = getBaseAddress(wallet);
    if (!address) {
      return c.json({ ready: false, error: "No EVM address on wallet" });
    }

    // Check ETH balance for gas
    const balance = await getEthBalance(address);
    const hasGas = balance > BigInt(0);

    // Check Filebase config
    const hasFilebase = !!(process.env.FILEBASE_ACCESS_KEY && process.env.FILEBASE_SECRET_KEY);

    return c.json({
      ready: hasGas && hasFilebase,
      address,
      ethBalance: balance.toString(),
      hasGas,
      hasFilebase,
      error: !hasGas ? "No ETH for gas fees" : !hasFilebase ? "Filebase not configured" : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Preflight check failed";
    return c.json({ ready: false, error: message });
  }
});

/** POST /api/publish/:draftId — publish a draft on-chain (streams progress) */
publish.post("/:draftId", async (c) => {
  const draftId = c.req.param("draftId");

  const draft = await db.draft.findUnique({ where: { id: draftId } });
  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.status === "published") return c.json({ error: "Already published" }, 409);

  // Get wallet
  const wallets = listAgentWallets();
  const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
  if (!wallet) return c.json({ error: "No OWS wallet" }, 400);

  return streamSSE(c, async (stream) => {
    try {
      const result = await publishStoryline(
        wallet.name,
        draft.title,
        draft.content,
        draft.genre || undefined,
        async (progress) => {
          await stream.writeSSE({ data: JSON.stringify(progress) });
        },
      );

      // Update draft status
      await db.draft.update({
        where: { id: draftId },
        data: { status: "published" },
      });

      await stream.writeSSE({
        data: JSON.stringify({
          step: "done",
          message: "Published!",
          txHash: result.txHash,
          contentCid: result.contentCid,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      await stream.writeSSE({
        data: JSON.stringify({ step: "error", message, error: message }),
      });
    }
  });
});

export { publish as publishRoutes };

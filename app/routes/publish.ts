import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db } from "../db";
import { publishStoryline, getEthBalance, getCreationFee } from "../lib/publish";
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

    // Check ETH balance for gas + creation fee
    const balance = await getEthBalance(address);
    let creationFee = BigInt(0);
    try { creationFee = await getCreationFee(); } catch { /* estimation may fail */ }
    const estimatedGas = BigInt(300000) * BigInt(100000000); // ~300k gas * ~0.1 gwei (Base is cheap)
    const requiredBalance = creationFee + estimatedGas;
    const hasEnoughEth = balance >= requiredBalance;

    // Check Filebase config
    const hasFilebase = !!(process.env.FILEBASE_ACCESS_KEY && process.env.FILEBASE_SECRET_KEY);

    return c.json({
      ready: hasEnoughEth && hasFilebase,
      address,
      ethBalance: balance.toString(),
      creationFee: creationFee.toString(),
      requiredBalance: requiredBalance.toString(),
      hasEnoughEth,
      hasFilebase,
      error: !hasEnoughEth
        ? `Insufficient ETH. Need ~${(Number(requiredBalance) / 1e18).toFixed(6)} ETH (creation fee + gas)`
        : !hasFilebase ? "Filebase not configured" : null,
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

      // Only mark published after tx confirmed (publishStoryline waits for confirmation)
      await db.draft.update({
        where: { id: draftId },
        data: { status: "published" },
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

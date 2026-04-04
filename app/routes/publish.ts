import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db } from "../db";
import { publishStoryline, publishPlot, getEthBalance, estimatePublishCost } from "../lib/publish";
import { keccak256, toBytes } from "viem";
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

    // Check ETH balance against real estimated cost
    const balance = await getEthBalance(address);
    let totalCost: bigint | null = null;
    let creationFee = BigInt(0);
    let estimationFailed = false;
    try {
      const dummyCid = "QmDummy";
      const dummyHash = keccak256(toBytes("estimation"));
      const estimate = await estimatePublishCost(address, "Test", dummyCid, dummyHash);
      totalCost = estimate.totalCost;
      creationFee = estimate.creationFee;
    } catch {
      estimationFailed = true;
    }
    // Fail closed: if estimation fails, block publishing
    const requiredBalance = totalCost ?? BigInt(0);
    const hasEnoughEth = !estimationFailed && totalCost !== null && balance >= requiredBalance;

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
      estimationFailed,
      error: estimationFailed
        ? "Could not estimate publish cost — check RPC and contract config"
        : !hasEnoughEth
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
        data: {
          status: "published",
          txHash: result.txHash,
          storylineId: result.storylineId,
          contentCid: result.contentCid,
          gasCost: result.gasCost,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      await stream.writeSSE({
        data: JSON.stringify({ step: "error", message, error: message }),
      });
    }
  });
});

/** POST /api/publish/file — publish a story file on-chain (streams progress) */
publish.post("/file", async (c) => {
  const body = await c.req.json<{
    storyName: string;
    fileName: string;
    title: string;
    content: string;
    genre?: string;
    storylineId?: number;
  }>();

  if (!body.title || !body.content) {
    return c.json({ error: "title and content required" }, 400);
  }

  // Get wallet
  const wallets = listAgentWallets();
  const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
  if (!wallet) return c.json({ error: "No OWS wallet" }, 400);

  // Determine if this is genesis (createStoryline) or plot (chainPlot)
  const isPlot = body.fileName.match(/^plot-\d+\.md$/);

  return streamSSE(c, async (stream) => {
    try {
      let result;
      if (isPlot && body.storylineId) {
        // Chain plot to existing storyline
        result = await publishPlot(
          wallet.name,
          body.storylineId,
          body.title,
          body.content,
          body.genre,
          async (progress) => {
            await stream.writeSSE({ data: JSON.stringify(progress) });
          },
        );
      } else {
        // Create new storyline (genesis or first file)
        result = await publishStoryline(
          wallet.name,
          body.title,
          body.content,
          body.genre,
          async (progress) => {
            await stream.writeSSE({ data: JSON.stringify(progress) });
          },
        );
      }

      await stream.writeSSE({
        data: JSON.stringify({
          step: "done",
          txHash: result.txHash,
          storylineId: result.storylineId,
          contentCid: result.contentCid,
          gasCost: result.gasCost,
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

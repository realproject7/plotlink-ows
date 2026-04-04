import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
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

  // Enforce character limits
  const isGenesis = body.fileName === "genesis.md";
  const isPlot = /^plot-\d+\.md$/.test(body.fileName);
  const charLimit = isGenesis ? 1000 : isPlot ? 10000 : null;
  if (charLimit && body.content.length > charLimit) {
    return c.json({
      error: `Content exceeds ${charLimit.toLocaleString()} character limit (${body.content.length.toLocaleString()} chars). Reduce content before publishing.`,
    }, 400);
  }

  // Get wallet
  let wallets;
  try {
    wallets = listAgentWallets();
  } catch (err) {
    console.error("[publish/file] listAgentWallets error:", err);
    return c.json({ error: `OWS wallet error: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
  const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
  if (!wallet) return c.json({ error: "No OWS wallet" }, 400);

  console.log("[publish/file] Starting publish for", body.storyName, body.fileName, "wallet:", wallet.name);

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

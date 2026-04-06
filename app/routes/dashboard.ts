import { Hono } from "hono";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import fs from "fs";
import path from "path";
import { getEthBalance } from "../lib/publish";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";
import { mcv2BondAbi } from "../../packages/cli/src/sdk/abi";
import { STORIES_DIR, readPublishStatus } from "./stories";

const MCV2_BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27" as const;
// Reserve token for PlotLink bonding curves (PLOT token on Base mainnet)
const RESERVE_TOKEN = "0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4" as const;

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

const dashboard = new Hono();

/** GET /api/dashboard — writer dashboard data */
dashboard.get("/", async (c) => {
  // Scan stories/ for publish status
  interface PublishedFile {
    storyName: string;
    file: string;
    storyTitle: string;
    storyGenre: string | null;
    plotCount: number;
    status?: string;
    txHash?: string;
    storylineId?: number;
    contentCid?: string;
    publishedAt?: string;
    gasCost?: string;
  }
  const publishedFiles: PublishedFile[] = [];
  let totalFiles = 0;
  let totalStories = 0;

  if (fs.existsSync(STORIES_DIR)) {
    const dirs = fs.readdirSync(STORIES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_example");
    totalStories = dirs.length;

    for (const dir of dirs) {
      const storyDir = path.join(STORIES_DIR, dir.name);
      const status = readPublishStatus(storyDir);
      const mdFiles = fs.readdirSync(storyDir).filter((f) => f.endsWith(".md"));
      totalFiles += mdFiles.length;

      // Read story title and genre from structure.md or genesis.md
      let storyTitle = dir.name;
      let storyGenre: string | null = null;
      try {
        const structPath = path.join(storyDir, "structure.md");
        const genesisPath = path.join(storyDir, "genesis.md");
        if (fs.existsSync(structPath)) {
          const content = fs.readFileSync(structPath, "utf-8");
          const titleMatch = content.match(/^#\s+(.+)$/m);
          if (titleMatch) storyTitle = titleMatch[1];
          const genreMatch = content.match(/genre[:\s]+(.+)/i);
          if (genreMatch) storyGenre = genreMatch[1].trim();
        } else if (fs.existsSync(genesisPath)) {
          const content = fs.readFileSync(genesisPath, "utf-8");
          const titleMatch = content.match(/^#\s+(.+)$/m);
          if (titleMatch) storyTitle = titleMatch[1];
        }
      } catch { /* best effort */ }

      const plotCount = mdFiles.filter((f) => /^plot-\d+\.md$/.test(f)).length;

      for (const [file, info] of Object.entries(status)) {
        if (info.status === "published" || info.status === "published-not-indexed") {
          publishedFiles.push({ storyName: dir.name, file, storyTitle, storyGenre, plotCount, ...info });
        }
      }
    }
  }

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

  // Compute total costs from published files
  const totalGasCostWei = publishedFiles.reduce((sum, f) => {
    if (f.gasCost) return sum + BigInt(f.gasCost);
    return sum;
  }, BigInt(0));
  const totalGasCostEth = (Number(totalGasCostWei) / 1e18).toFixed(6);

  // Query on-chain royalties (WETH on Base — bonding curve reserve)
  let royaltiesEarned = "0";
  let royaltiesClaimed = "0";
  if (walletInfo?.address) {
    try {
      // getRoyaltyInfo returns (unclaimed, totalClaimed)
      const [unclaimed, totalClaimed] = await publicClient.readContract({
        address: MCV2_BOND,
        abi: mcv2BondAbi,
        functionName: "getRoyaltyInfo",
        args: [walletInfo.address as `0x${string}`, RESERVE_TOKEN],
      }) as [bigint, bigint];
      // Total earned = unclaimed + previously claimed
      royaltiesEarned = (Number(unclaimed + totalClaimed) / 1e18).toFixed(6);
      royaltiesClaimed = (Number(totalClaimed) / 1e18).toFixed(6);
    } catch { /* no royalties or contract not available */ }
  }

  // Fetch ETH/USD price for common-unit P&L
  let ethUsdPrice = 0;
  try {
    const priceRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const priceData = await priceRes.json() as { ethereum?: { usd?: number } };
    ethUsdPrice = priceData.ethereum?.usd ?? 0;
  } catch { /* price fetch best-effort */ }

  const totalCostUsd = parseFloat(totalGasCostEth) * ethUsdPrice;

  // Get PLOT/USD via existing price helper (HUNT-backed derivation)
  let plotUsdPrice = 0;
  try {
    const { getPlotUsdPrice } = await import("../../lib/usd-price");
    const price = await getPlotUsdPrice();
    if (price) plotUsdPrice = price;
  } catch { /* price estimation best-effort */ }

  const totalRoyaltiesUsd = parseFloat(royaltiesEarned) * plotUsdPrice;
  const netPnlUsd = totalRoyaltiesUsd - totalCostUsd;

  return c.json({
    wallet: walletInfo,
    stories: {
      published: publishedFiles.map((f) => ({
        id: `${f.storyName}/${f.file}`,
        title: f.storyTitle,
        genre: f.storyGenre,
        status: f.status || "published",
        storyName: f.storyName,
        file: f.file,
        plotCount: f.plotCount,
        txHash: f.txHash,
        storylineId: f.storylineId,
        contentCid: f.contentCid,
        gasCost: f.gasCost,
        gasCostEth: f.gasCost ? (Number(BigInt(f.gasCost)) / 1e18).toFixed(6) : null,
        gasCostUsd: f.gasCost && ethUsdPrice ? ((Number(BigInt(f.gasCost)) / 1e18) * ethUsdPrice).toFixed(2) : null,
        createdAt: f.publishedAt || null,
      })),
      totalPublished: publishedFiles.length,
      totalStories,
      totalFiles,
      pendingFiles: totalFiles - publishedFiles.length,
    },
    costs: {
      totalGasCostWei: totalGasCostWei.toString(),
      totalGasCostEth,
      totalCostUsd: totalCostUsd.toFixed(2),
      ethUsdPrice,
      storiesPublished: publishedFiles.length,
    },
    royalties: {
      earned: royaltiesEarned,
      claimed: royaltiesClaimed,
      unclaimed: (parseFloat(royaltiesEarned) - parseFloat(royaltiesClaimed)).toFixed(6),
      token: "PLOT",
    },
    pnl: {
      totalCostsEth: totalGasCostEth,
      totalCostsUsd: totalCostUsd.toFixed(2),
      totalRoyaltiesPlot: royaltiesEarned,
      totalRoyaltiesUsd: totalRoyaltiesUsd.toFixed(2),
      netPnlUsd: netPnlUsd.toFixed(2),
      plotUsdPrice: plotUsdPrice.toFixed(4),
    },
  });
});

export { dashboard as dashboardRoutes };

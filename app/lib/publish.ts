/**
 * PlotLink publish flow — uploads content to IPFS and publishes on-chain via OWS wallet.
 * Uses the existing CLI SDK for ABI/constants and OWS wallet for signing.
 */
import { createPublicClient, http, encodeFunctionData, keccak256, toBytes, type Hex } from "viem";
import { base } from "viem/chains";
import { STORY_FACTORY_ABI } from "../../packages/cli/src/sdk/abi";
import { uploadWithRetry } from "../../packages/cli/src/sdk/ipfs";
import { signAndSendAgent } from "../../lib/ows/wallet";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "..", "..", "agent.config.json");

// Contract addresses (Base mainnet)
const STORY_FACTORY = "0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

function getFilebaseConfig() {
  return {
    accessKey: process.env.FILEBASE_ACCESS_KEY || "",
    secretKey: process.env.FILEBASE_SECRET_KEY || "",
    bucket: process.env.FILEBASE_BUCKET || "",
  };
}

export interface PublishResult {
  txHash: string;
  contentCid: string;
  storylineId?: number;
}

export interface PublishProgress {
  step: "uploading" | "estimating" | "signing" | "broadcasting" | "confirming" | "done" | "error";
  message: string;
  txHash?: string;
  contentCid?: string;
  storylineId?: number;
  error?: string;
}

/**
 * Upload story content to IPFS via Filebase.
 */
export async function uploadToIPFS(content: string, title: string, genre?: string): Promise<string> {
  const filebaseConfig = getFilebaseConfig();
  if (!filebaseConfig.accessKey || !filebaseConfig.secretKey) {
    throw new Error("Filebase not configured. Set FILEBASE_ACCESS_KEY and FILEBASE_SECRET_KEY in .env");
  }

  const metadata = JSON.stringify({ title, genre, content });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const key = `plotlink/storylines/${Date.now()}-${slug}.json`;

  const cid = await uploadWithRetry(metadata, key, filebaseConfig);
  return cid;
}

/**
 * Estimate gas for createStoryline transaction.
 */
export async function estimatePublishGas(
  walletAddress: string,
  title: string,
  contentCid: string,
  contentHash: Hex,
): Promise<{ gas: bigint; gasPrice: bigint; totalCost: bigint }> {
  const gas = await publicClient.estimateGas({
    account: walletAddress as `0x${string}`,
    to: STORY_FACTORY as `0x${string}`,
    data: encodeFunctionData({
      abi: STORY_FACTORY_ABI,
      functionName: "createStoryline",
      args: [title, contentCid, contentHash, true],
    }),
  });

  const gasPrice = await publicClient.getGasPrice();
  return { gas, gasPrice, totalCost: gas * gasPrice };
}

/**
 * Check ETH balance on Base for gas fees.
 */
export async function getEthBalance(address: string): Promise<bigint> {
  return publicClient.getBalance({ address: address as `0x${string}` });
}

/**
 * Publish a new storyline to PlotLink on-chain.
 * Signs transaction with OWS wallet and broadcasts to Base.
 */
export async function publishStoryline(
  walletName: string,
  title: string,
  content: string,
  genre: string | undefined,
  onProgress: (progress: PublishProgress) => void,
): Promise<PublishResult> {
  // Step 1: Upload to IPFS
  onProgress({ step: "uploading", message: "Uploading story to IPFS..." });
  const contentCid = await uploadToIPFS(content, title, genre);

  // Step 2: Compute content hash
  const contentHash = keccak256(toBytes(content));

  // Step 3: Build transaction
  onProgress({ step: "estimating", message: "Estimating gas..." });
  const calldata = encodeFunctionData({
    abi: STORY_FACTORY_ABI,
    functionName: "createStoryline",
    args: [title, contentCid, contentHash, true],
  });

  // Step 4: Sign and send via OWS
  onProgress({ step: "signing", message: "Signing transaction with OWS wallet..." });
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

  // Build raw transaction hex (to + data + value)
  // OWS signAndSend handles nonce, gas, and broadcasting
  const txHex = JSON.stringify({
    to: STORY_FACTORY,
    data: calldata,
    value: "0x0", // createStoryline may require creation fee
  });

  onProgress({ step: "broadcasting", message: "Broadcasting transaction..." });
  const result = signAndSendAgent(walletName, txHex, undefined, rpcUrl);

  onProgress({
    step: "done",
    message: "Story published!",
    txHash: result.txHash,
    contentCid,
  });

  return { txHash: result.txHash, contentCid };
}

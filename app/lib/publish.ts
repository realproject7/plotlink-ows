/**
 * PlotLink publish flow — uploads content to IPFS and publishes on-chain via OWS wallet.
 */
import { createPublicClient, http, encodeFunctionData, keccak256, toBytes, decodeEventLog, type Hex } from "viem";
import { base } from "viem/chains";
import { STORY_FACTORY_ABI, mcv2BondAbi } from "../../packages/cli/src/sdk/abi";
import { uploadWithRetry } from "../../packages/cli/src/sdk/ipfs";
import { signAndSendAgent } from "../../lib/ows/wallet";

// Contract addresses (Base mainnet)
const STORY_FACTORY = "0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf" as const;
const MCV2_BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27" as const;

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
 * Get the MCV2 Bond creation fee required for createStoryline.
 */
export async function getCreationFee(): Promise<bigint> {
  const fee = await publicClient.readContract({
    address: MCV2_BOND,
    abi: mcv2BondAbi,
    functionName: "creationFee",
  }) as bigint;
  return fee;
}

/**
 * Estimate total cost for publishing (creation fee + gas).
 */
export async function estimatePublishCost(
  walletAddress: string,
  title: string,
  contentCid: string,
  contentHash: Hex,
): Promise<{ creationFee: bigint; gasEstimate: bigint; gasPrice: bigint; totalCost: bigint }> {
  const creationFee = await getCreationFee();

  const gas = await publicClient.estimateGas({
    account: walletAddress as `0x${string}`,
    to: STORY_FACTORY,
    value: creationFee,
    data: encodeFunctionData({
      abi: STORY_FACTORY_ABI,
      functionName: "createStoryline",
      args: [title, contentCid, contentHash, true],
    }),
  });

  const gasPrice = await publicClient.getGasPrice();
  const gasCost = gas * gasPrice;

  return {
    creationFee,
    gasEstimate: gas,
    gasPrice,
    totalCost: creationFee + gasCost,
  };
}

/**
 * Check ETH balance on Base.
 */
export async function getEthBalance(address: string): Promise<bigint> {
  return publicClient.getBalance({ address: address as `0x${string}` });
}

/**
 * Wait for transaction confirmation and decode storylineId from event.
 */
async function waitForConfirmation(txHash: string): Promise<number | undefined> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  // Decode StorylineCreated event to get storylineId
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: STORY_FACTORY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "StorylineCreated") {
        return Number((decoded.args as { storylineId: bigint }).storylineId);
      }
    } catch { /* not our event */ }
  }
  return undefined;
}

/**
 * Publish a new storyline to PlotLink on-chain.
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

  // Step 2: Compute content hash + get creation fee
  const contentHash = keccak256(toBytes(content));

  onProgress({ step: "estimating", message: "Fetching creation fee and estimating gas..." });
  const creationFee = await getCreationFee();

  // Step 3: Build transaction with creation fee as value
  const calldata = encodeFunctionData({
    abi: STORY_FACTORY_ABI,
    functionName: "createStoryline",
    args: [title, contentCid, contentHash, true],
  });

  // Step 4: Sign and send via OWS
  onProgress({ step: "signing", message: "Signing transaction with OWS wallet..." });
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

  const txHex = JSON.stringify({
    to: STORY_FACTORY,
    data: calldata,
    value: `0x${creationFee.toString(16)}`,
  });

  onProgress({ step: "broadcasting", message: "Broadcasting transaction..." });
  const result = signAndSendAgent(walletName, txHex, undefined, rpcUrl);

  // Step 5: Wait for confirmation and decode storylineId
  onProgress({ step: "confirming", message: "Waiting for confirmation...", txHash: result.txHash, contentCid });
  const storylineId = await waitForConfirmation(result.txHash);

  onProgress({
    step: "done",
    message: storylineId ? `Published! Storyline #${storylineId}` : "Published!",
    txHash: result.txHash,
    contentCid,
    storylineId,
  });

  return { txHash: result.txHash, contentCid, storylineId };
}

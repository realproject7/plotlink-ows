/**
 * PlotLink publish flow — uploads content to IPFS and publishes on-chain via OWS wallet.
 */
import { createPublicClient, http, encodeFunctionData, keccak256, toBytes, decodeEventLog, type Hex } from "viem";
import { base } from "viem/chains";
import { STORY_FACTORY_ABI, mcv2BondAbi } from "../../packages/cli/src/sdk/abi";
import { signAndSendAgent } from "../../lib/ows/wallet";

// Contract addresses (Base mainnet)
const STORY_FACTORY = "0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf" as const;
const MCV2_BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27" as const;

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org"),
});

export interface PublishResult {
  txHash: string;
  contentCid: string;
  storylineId?: number;
  gasCost?: string;
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
 * Upload story content to IPFS via PlotLink's API (plotlink.xyz/api/upload).
 * PlotLink handles Filebase credentials server-side.
 */
export async function uploadToIPFS(content: string, title: string, genre?: string): Promise<string> {
  const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
  const metadata = JSON.stringify({ title, genre, content });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const key = `plotlink/storylines/${Date.now()}-${slug}.json`;

  const res = await fetch(`${PLOTLINK_URL}/api/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: metadata, key }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(err.error || `Upload failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { cid: string };
  return data.cid;
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
async function waitForConfirmation(txHash: string): Promise<{ storylineId: number; gasCost: string }> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  if (receipt.status === "reverted") {
    throw new Error("Transaction reverted on-chain");
  }

  // Compute actual total cost: gasUsed * effectiveGasPrice + tx value (creation fee)
  const gasOnly = receipt.gasUsed * receipt.effectiveGasPrice;
  const txValue = receipt.logs.length > 0 ? BigInt(0) : BigInt(0); // value is in the tx itself
  // Include creation fee from tx value — read from the original transaction
  let creationFeeUsed = BigInt(0);
  try {
    const tx = await publicClient.getTransaction({ hash: txHash as `0x${string}` });
    creationFeeUsed = tx.value;
  } catch { /* best effort */ }
  const gasCost = (gasOnly + creationFeeUsed).toString();

  // Decode StorylineCreated event to get storylineId
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: STORY_FACTORY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "StorylineCreated") {
        return { storylineId: Number((decoded.args as { storylineId: bigint }).storylineId), gasCost };
      }
    } catch { /* not our event */ }
  }
  throw new Error("Transaction succeeded but StorylineCreated event not found");
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
  const passphrase = process.env.OWS_PASSPHRASE;
  const result = signAndSendAgent(walletName, txHex, passphrase, rpcUrl);

  // Step 5: Wait for confirmation and decode storylineId
  onProgress({ step: "confirming", message: "Waiting for confirmation...", txHash: result.txHash, contentCid });
  const confirmation = await waitForConfirmation(result.txHash);

  onProgress({
    step: "done",
    message: `Published! Storyline #${confirmation.storylineId}`,
    txHash: result.txHash,
    contentCid,
    storylineId: confirmation.storylineId,
  });

  // Index on PlotLink (best-effort — story appears on plotlink.xyz)
  try {
    const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
    await fetch(`${PLOTLINK_URL}/api/index/storyline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash: result.txHash, content, genre }),
    });
  } catch { /* indexing is best-effort */ }

  return { txHash: result.txHash, contentCid, storylineId: confirmation.storylineId, gasCost: confirmation.gasCost };
}

/**
 * Chain a new plot to an existing storyline on-chain.
 */
export async function publishPlot(
  walletName: string,
  storylineId: number,
  title: string,
  content: string,
  genre: string | undefined,
  onProgress: (progress: PublishProgress) => void,
): Promise<PublishResult> {
  // Step 1: Upload to IPFS
  onProgress({ step: "uploading", message: "Uploading plot to IPFS..." });
  const contentCid = await uploadToIPFS(content, title, genre);

  // Step 2: Compute content hash
  const contentHash = keccak256(toBytes(content));

  // Step 3: Build chainPlot transaction (no value needed)
  onProgress({ step: "estimating", message: "Building transaction..." });
  const calldata = encodeFunctionData({
    abi: STORY_FACTORY_ABI,
    functionName: "chainPlot",
    args: [BigInt(storylineId), title, contentCid, contentHash],
  });

  // Step 4: Sign and send via OWS
  onProgress({ step: "signing", message: "Signing transaction with OWS wallet..." });
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

  const txHex = JSON.stringify({
    to: STORY_FACTORY,
    data: calldata,
    value: "0x0",
  });

  onProgress({ step: "broadcasting", message: "Broadcasting transaction..." });
  const passphrase = process.env.OWS_PASSPHRASE;
  const result = signAndSendAgent(walletName, txHex, passphrase, rpcUrl);

  // Step 5: Wait for confirmation
  onProgress({ step: "confirming", message: "Waiting for confirmation...", txHash: result.txHash, contentCid });
  const confirmation = await waitForConfirmation(result.txHash);

  onProgress({
    step: "done",
    message: `Plot chained to storyline #${storylineId}`,
    txHash: result.txHash,
    contentCid,
    storylineId,
  });

  // Index on PlotLink (best-effort — plot appears on plotlink.xyz)
  try {
    const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
    await fetch(`${PLOTLINK_URL}/api/index/plot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash: result.txHash }),
    });
  } catch { /* indexing is best-effort */ }

  return { txHash: result.txHash, contentCid, storylineId, gasCost: confirmation.gasCost };
}

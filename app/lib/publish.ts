/**
 * PlotLink publish flow — uploads content to IPFS and publishes on-chain via OWS wallet.
 */
import { createPublicClient, createWalletClient, http, keccak256, toBytes, decodeEventLog, serializeTransaction, type Hex } from "viem";
import { base } from "viem/chains";
import { toAccount } from "viem/accounts";
import { storyFactoryAbi, mcv2BondAbi } from "../../packages/cli/src/sdk/abi";
import {
  signTransaction as owsSignTx,
  signMessage as owsSignMsg,
} from "@open-wallet-standard/core";

// Contract addresses (Base mainnet)
const STORY_FACTORY = "0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf" as const;
const MCV2_BOND = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27" as const;

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";
const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

/** Parse OWS signature into viem-compatible r,s,v */
function parseEvmSignature(sigHex: string, recoveryId?: number): { r: Hex; s: Hex; v: bigint } {
  const sig = sigHex.startsWith("0x") ? sigHex.slice(2) : sigHex;
  const r = `0x${sig.slice(0, 64)}` as Hex;
  const s = `0x${sig.slice(64, 128)}` as Hex;
  // recovery id from OWS or from the last byte of signature
  const v = recoveryId !== undefined ? BigInt(recoveryId + 27) : BigInt(parseInt(sig.slice(128, 130), 16));
  return { r, s, v };
}

/** Create a viem-compatible account backed by OWS wallet (same pattern as claw-on-chain) */
export function createOwsAccount(walletName: string, address: `0x${string}`) {
  const passphrase = process.env.OWS_PASSPHRASE;
  return toAccount({
    address,
    signMessage: async ({ message }) => {
      const msg = typeof message === "string" ? message : typeof message.raw === "string" ? message.raw : Buffer.from(message.raw).toString("hex");
      const result = owsSignMsg(walletName, "eip155:8453", msg, passphrase);
      return (result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`) as Hex;
    },
    signTransaction: async (tx) => {
      const unsigned = serializeTransaction(tx);
      const hexWithout0x = unsigned.startsWith("0x") ? unsigned.slice(2) : unsigned;
      const result = owsSignTx(walletName, "eip155:8453", hexWithout0x, passphrase);
      const sig = parseEvmSignature(result.signature, result.recoveryId);
      return serializeTransaction(tx, sig);
    },
    signTypedData: async () => { throw new Error("signTypedData not implemented"); },
  });
}

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
      abi: storyFactoryAbi,
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
 * Wait for tx confirmation and compute gas cost.
 */
async function waitForReceipt(txHash: string) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  if (receipt.status === "reverted") {
    throw new Error("Transaction reverted on-chain");
  }

  // Compute actual total cost: gasUsed * effectiveGasPrice + tx value (creation fee)
  const gasOnly = receipt.gasUsed * receipt.effectiveGasPrice;
  let creationFeeUsed = BigInt(0);
  try {
    const tx = await publicClient.getTransaction({ hash: txHash as `0x${string}` });
    creationFeeUsed = tx.value;
  } catch { /* best effort */ }
  const gasCost = (gasOnly + creationFeeUsed).toString();

  return { receipt, gasCost };
}

/**
 * Wait for storyline creation confirmation — decodes StorylineCreated event.
 */
async function waitForStorylineConfirmation(txHash: string): Promise<{ storylineId: number; gasCost: string }> {
  const { receipt, gasCost } = await waitForReceipt(txHash);

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: storyFactoryAbi,
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
 * Wait for plot chain confirmation — decodes PlotChained event.
 */
async function waitForPlotConfirmation(txHash: string): Promise<{ plotIndex: number; gasCost: string }> {
  const { receipt, gasCost } = await waitForReceipt(txHash);

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: storyFactoryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "PlotChained") {
        return { plotIndex: Number((decoded.args as { plotIndex: bigint }).plotIndex), gasCost };
      }
    } catch { /* not our event */ }
  }
  // If we can't find PlotChained but receipt succeeded, still return (best effort)
  return { plotIndex: -1, gasCost };
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

  // Step 3: Create OWS-backed viem wallet client
  onProgress({ step: "signing", message: "Signing transaction with OWS wallet..." });
  const { listAgentWallets, getBaseAddress } = await import("../../lib/ows/wallet");
  const wallets = listAgentWallets();
  const owsWallet = wallets.find((w) => w.name === walletName);
  if (!owsWallet) throw new Error("OWS wallet not found");
  const address = getBaseAddress(owsWallet);
  if (!address) throw new Error("No EVM address on wallet");

  const account = createOwsAccount(walletName, address as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  // Step 4: Write contract via viem (handles signing + broadcasting)
  onProgress({ step: "broadcasting", message: "Broadcasting transaction..." });
  const txHash = await walletClient.writeContract({
    address: STORY_FACTORY,
    abi: storyFactoryAbi,
    functionName: "createStoryline",
    args: [title, contentCid, contentHash, true],
    value: creationFee,
  });

  // Step 5: Wait for confirmation and decode storylineId
  onProgress({ step: "confirming", message: "Waiting for confirmation...", txHash, contentCid });
  const confirmation = await waitForStorylineConfirmation(txHash);

  onProgress({
    step: "done",
    message: `Published! Storyline #${confirmation.storylineId}`,
    txHash,
    contentCid,
    storylineId: confirmation.storylineId,
  });

  // Index on PlotLink (best-effort — story appears on plotlink.xyz)
  try {
    const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
    await fetch(`${PLOTLINK_URL}/api/index/storyline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash, content, genre }),
    });
  } catch { /* indexing is best-effort */ }

  return { txHash, contentCid, storylineId: confirmation.storylineId, gasCost: confirmation.gasCost };
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

  // Step 3: Create OWS-backed viem wallet client
  onProgress({ step: "signing", message: "Signing transaction with OWS wallet..." });
  const { listAgentWallets, getBaseAddress } = await import("../../lib/ows/wallet");
  const wallets = listAgentWallets();
  const owsWallet = wallets.find((w) => w.name === walletName);
  if (!owsWallet) throw new Error("OWS wallet not found");
  const address = getBaseAddress(owsWallet);
  if (!address) throw new Error("No EVM address on wallet");

  const account = createOwsAccount(walletName, address as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  // Step 4: Write contract via viem
  onProgress({ step: "broadcasting", message: "Broadcasting transaction..." });
  const txHash = await walletClient.writeContract({
    address: STORY_FACTORY,
    abi: storyFactoryAbi,
    functionName: "chainPlot",
    args: [BigInt(storylineId), title, contentCid, contentHash],
  });

  // Step 5: Wait for plot confirmation
  onProgress({ step: "confirming", message: "Waiting for confirmation...", txHash, contentCid });
  const confirmation = await waitForPlotConfirmation(txHash);

  onProgress({
    step: "done",
    message: `Plot chained to storyline #${storylineId}`,
    txHash,
    contentCid,
    storylineId,
  });

  // Index on PlotLink (best-effort — plot appears on plotlink.xyz)
  try {
    const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
    await fetch(`${PLOTLINK_URL}/api/index/plot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash }),
    });
  } catch { /* indexing is best-effort */ }

  return { txHash, contentCid, storylineId, gasCost: confirmation.gasCost };
}

import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  keccak256,
  toHex,
  decodeEventLog,
  formatUnits,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

import { storyFactoryAbi, erc8004Abi, mcv2BondAbi } from "./abi.js";

// Named ABI event references (avoid fragile array indexing)
const StorylineCreatedEvent = storyFactoryAbi.find(
  (item) => item.type === "event" && item.name === "StorylineCreated",
)!;
const PlotChainedEvent = storyFactoryAbi.find(
  (item) => item.type === "event" && item.name === "PlotChained",
)!;
import {
  STORY_FACTORY_ADDRESS,
  STORY_FACTORY_MAINNET_ADDRESS,
  MCV2_BOND_ADDRESS,
  MCV2_BOND_MAINNET_ADDRESS,
  ERC8004_REGISTRY_ADDRESS,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  DEPLOYMENT_BLOCK,
  DEPLOYMENT_BLOCK_MAINNET,
  SUPPORTED_CHAIN_IDS,
} from "./constants.js";
import { uploadWithRetry, type FilebaseConfig } from "./ipfs.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the PlotLink SDK client.
 */
export interface PlotLinkConfig {
  /** Hex-encoded private key (with or without 0x prefix). */
  privateKey: string;
  /** JSON-RPC URL for the Base chain. */
  rpcUrl: string;
  /** Optional additional RPC URLs for fallback rotation (tried in order after rpcUrl). */
  rpcUrls?: string[];
  /** Chain ID — defaults to 84532 (Base Sepolia). */
  chainId?: number;
  /** Override StoryFactory contract address. */
  storyFactoryAddress?: Address;
  /** Override MCV2_Bond contract address. */
  mcv2BondAddress?: Address;
  /** Override ERC-8004 Registry contract address. */
  erc8004RegistryAddress?: Address;
  /**
   * Filebase credentials for IPFS uploads.
   * Required for createStoryline() and chainPlot().
   * If omitted, those methods will throw when called.
   */
  filebase?: FilebaseConfig;
}

export interface CreateStorylineResult {
  storylineId: bigint;
  txHash: Hex;
  contentCid: string;
}

export interface ChainPlotResult {
  txHash: Hex;
  contentCid: string;
}

export interface StorylineInfo {
  creator: Address;
  tokenAddress: Address;
  title: string;
  hasDeadline: boolean;
  openingCID: string;
  openingHash: Hex;
}

export interface PlotInfo {
  storylineId: bigint;
  plotIndex: bigint;
  writer: Address;
  contentCID: string;
  contentHash: Hex;
}

export interface RegisterAgentResult {
  agentId: bigint;
  txHash: Hex;
}

export interface SetAgentWalletResult {
  txHash: Hex;
}

export interface RoyaltyInfo {
  balance: bigint;
  claimed: bigint;
}

export interface TokenPriceInfo {
  /** Cost (in reserve token wei) to mint 1 unit of the storyline token. */
  priceRaw: bigint;
  /** priceRaw formatted with 18 decimals. */
  priceFormatted: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * PlotLink SDK client for interacting with the PlotLink protocol on Base.
 *
 * Provides methods for storyline management, plot chaining, agent registration,
 * and royalty claims. Uses viem for contract interactions and Filebase for
 * IPFS content uploads.
 *
 * @example
 * ```ts
 * const client = new PlotLink({
 *   privateKey: "0x...",
 *   rpcUrl: "https://sepolia.base.org",
 *   filebase: { accessKey: "...", secretKey: "...", bucket: "my-bucket" },
 * });
 *
 * const { storylineId } = await client.createStoryline(
 *   "My Story",
 *   "Once upon a time...",
 *   "Fantasy",
 * );
 * ```
 */
export class PlotLink {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly address: Address;

  readonly storyFactory: Address;
  readonly mcv2Bond: Address;
  private readonly erc8004Registry: Address;
  private readonly filebase: FilebaseConfig | undefined;
  private readonly chain: Chain;
  private readonly deploymentBlock: bigint;

  constructor(config: PlotLinkConfig) {
    const chainId = config.chainId ?? BASE_SEPOLIA_CHAIN_ID;
    if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
      throw new Error(
        `Unsupported chainId: ${chainId}. PlotLink SDK supports Base (8453) and Base Sepolia (84532).`,
      );
    }
    const isMainnet = chainId === BASE_MAINNET_CHAIN_ID;
    this.chain = isMainnet ? base : baseSepolia;
    this.deploymentBlock = isMainnet ? DEPLOYMENT_BLOCK_MAINNET : DEPLOYMENT_BLOCK;

    const normalizedKey = config.privateKey.startsWith("0x")
      ? config.privateKey
      : `0x${config.privateKey}`;
    const account = privateKeyToAccount(normalizedKey as Hex);

    const allUrls = [config.rpcUrl, ...(config.rpcUrls ?? [])];
    const transport =
      allUrls.length > 1
        ? fallback(allUrls.map((url) => http(url, { timeout: 10_000, retryCount: 1 })), { rank: false })
        : http(config.rpcUrl);

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport,
    });

    this.walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport,
    });

    this.address = account.address;
    this.storyFactory =
      config.storyFactoryAddress ?? (isMainnet ? STORY_FACTORY_MAINNET_ADDRESS : STORY_FACTORY_ADDRESS);
    this.mcv2Bond = config.mcv2BondAddress ?? (isMainnet ? MCV2_BOND_MAINNET_ADDRESS : MCV2_BOND_ADDRESS);
    this.erc8004Registry =
      config.erc8004RegistryAddress ?? ERC8004_REGISTRY_ADDRESS;
    this.filebase = config.filebase;
  }

  // -------------------------------------------------------------------------
  // Storyline methods
  // -------------------------------------------------------------------------

  /**
   * Create a new storyline.
   *
   * Uploads the opening content to IPFS via Filebase, computes its keccak256
   * hash, and calls StoryFactory.createStoryline() on-chain.
   *
   * @param title - Storyline title
   * @param content - Opening plot content (plain text)
   * @param genre - Genre label (stored off-chain; used for agent URI composition)
   * @param hasDeadline - Whether the storyline has a sunset deadline (default: true, mandatory 7-day)
   * @returns The storyline ID, transaction hash, and IPFS CID
   */
  async createStoryline(
    title: string,
    content: string,
    genre: string,
    hasDeadline = true,
  ): Promise<CreateStorylineResult> {
    this.requireFilebase();
    validateNonEmpty("title", title);
    validateNonEmpty("content", content);
    validateNonEmpty("genre", genre);
    validateTitle(title);
    validateContentLength(content);

    const metadata = JSON.stringify({ title, genre, content });
    const key = `plotlink/storylines/${Date.now()}-${slugify(title)}.json`;
    const contentCid = await uploadWithRetry(metadata, key, this.filebase!);
    const contentHash = hashContent(content);

    // MCV2_Bond requires a creation fee as msg.value when minting a new token
    const creationFee = await this.publicClient.readContract({
      address: this.mcv2Bond,
      abi: mcv2BondAbi,
      functionName: "creationFee",
    }) as bigint;

    const { request } = await this.publicClient.simulateContract({
      account: this.walletClient.account!,
      address: this.storyFactory,
      abi: storyFactoryAbi,
      functionName: "createStoryline",
      args: [title, contentCid, contentHash, hasDeadline],
      value: creationFee,
    });

    const txHash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    // Decode StorylineCreated event to get the storylineId
    let storylineId = BigInt(0);
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: storyFactoryAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "StorylineCreated") {
          storylineId = (decoded.args as { storylineId: bigint }).storylineId;
          break;
        }
      } catch {
        // Skip logs from other contracts
      }
    }

    return { storylineId, txHash, contentCid };
  }

  /**
   * Chain a new plot onto an existing storyline.
   *
   * Uploads content to IPFS and calls StoryFactory.chainPlot() on-chain.
   *
   * @param storylineId - The storyline to chain onto
   * @param content - Plot content (plain text)
   * @param title - Optional chapter title (defaults to empty string)
   * @returns Transaction hash and IPFS CID
   */
  async chainPlot(
    storylineId: bigint,
    content: string,
    title = "",
  ): Promise<ChainPlotResult> {
    this.requireFilebase();
    validateNonEmpty("content", content);
    validateContentLength(content);

    const key = `plotlink/plots/${storylineId}-${Date.now()}.txt`;
    const contentCid = await uploadWithRetry(content, key, this.filebase!);
    const contentHash = hashContent(content);

    const { request } = await this.publicClient.simulateContract({
      account: this.walletClient.account!,
      address: this.storyFactory,
      abi: storyFactoryAbi,
      functionName: "chainPlot",
      args: [storylineId, title, contentCid, contentHash],
    });

    const txHash = await this.walletClient.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return { txHash, contentCid };
  }

  /**
   * Read storyline data from the StorylineCreated event logs.
   *
   * Fetches the creation event for the given storyline ID to retrieve
   * on-chain metadata (title, token address, opening CID, etc.).
   *
   * @param storylineId - The storyline ID to look up
   * @returns Storyline info or null if not found
   */
  async getStoryline(storylineId: bigint): Promise<StorylineInfo | null> {
    const logs = await this.getLogsPaginated({
      address: this.storyFactory,
      event: StorylineCreatedEvent,
      args: { storylineId },
    });

    if (logs.length === 0) return null;

    const log = logs[0] as { args: Record<string, unknown> };
    const args = log.args as {
      writer: Address;
      tokenAddress: Address;
      title: string;
      hasDeadline: boolean;
      openingCID: string;
      openingHash: Hex;
    };

    return {
      creator: args.writer,
      tokenAddress: args.tokenAddress,
      title: args.title,
      hasDeadline: args.hasDeadline,
      openingCID: args.openingCID,
      openingHash: args.openingHash,
    };
  }

  /**
   * Read all plots for a storyline from PlotChained event logs.
   *
   * @param storylineId - The storyline ID to query
   * @returns Array of plot info objects, ordered by plot index
   */
  async getPlots(storylineId: bigint): Promise<PlotInfo[]> {
    const logs = await this.getLogsPaginated({
      address: this.storyFactory,
      event: PlotChainedEvent,
      args: { storylineId },
    });

    return logs.map((log) => {
      const args = (log as { args: Record<string, unknown> }).args as {
        storylineId: bigint;
        plotIndex: bigint;
        writer: Address;
        contentCID: string;
        contentHash: Hex;
      };
      return {
        storylineId: args.storylineId,
        plotIndex: args.plotIndex,
        writer: args.writer,
        contentCID: args.contentCID,
        contentHash: args.contentHash,
      };
    });
  }

  /**
   * Read storyline struct directly from contract storage.
   * Uses readContract instead of getLogs, avoiding RPC block-range limits.
   * Does not include title or openingCID (those are only in event logs).
   */
  async getStorylineStruct(storylineId: bigint): Promise<{
    writer: Address;
    token: Address;
    plotCount: number;
    lastPlotTime: number;
    hasDeadline: boolean;
  } | null> {
    try {
      const result = await this.publicClient.readContract({
        address: this.storyFactory,
        abi: storyFactoryAbi,
        functionName: "storylines",
        args: [storylineId],
      });
      const [writer, token, plotCount, lastPlotTime, hasDeadline] = result as [Address, Address, number, number, boolean];
      return { writer, token, plotCount, lastPlotTime, hasDeadline };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Agent methods
  // -------------------------------------------------------------------------

  /**
   * Register an AI agent on the ERC-8004 Agent Identity Registry.
   *
   * Constructs a JSON agent URI from the provided metadata and calls
   * `register(agentURI)` on the ERC-8004 registry contract.
   *
   * @param name - Agent display name
   * @param description - Short description of the agent
   * @param genre - Primary genre the agent writes in
   * @param model - LLM model identifier (e.g. "Claude Opus 4")
   * @returns Agent ID and transaction hash
   */
  async registerAgent(
    name: string,
    description: string,
    genre: string,
    model: string,
  ): Promise<RegisterAgentResult> {
    validateNonEmpty("name", name);
    validateNonEmpty("description", description);
    validateNonEmpty("genre", genre);
    validateNonEmpty("model", model);

    const agentURI = JSON.stringify({ name, description, genre, model });

    const { request } = await this.publicClient.simulateContract({
      account: this.walletClient.account!,
      address: this.erc8004Registry,
      abi: erc8004Abi,
      functionName: "register",
      args: [agentURI],
    });

    const txHash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    // Decode Registered event to get the agentId
    let agentId = BigInt(0);
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: erc8004Abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Registered") {
          agentId = (decoded.args as { agentId: bigint }).agentId;
          break;
        }
      } catch {
        // Skip logs from other contracts
      }
    }

    return { agentId, txHash };
  }

  /**
   * Set (or rotate) the wallet for a registered agent.
   *
   * Builds an EIP-712 `AgentWalletSet` signature using the agent wallet's
   * private key and submits the `setAgentWallet` transaction from the SDK's
   * configured (owner) wallet.
   *
   * @param agentId - The on-chain agent ID (from registerAgent)
   * @param newWallet - The new wallet address to assign
   * @param agentWalletPrivateKey - Hex-encoded private key of the agent wallet (signer)
   * @returns Transaction hash
   */
  async setAgentWallet(
    agentId: bigint,
    newWallet: Address,
    agentWalletPrivateKey: string,
  ): Promise<SetAgentWalletResult> {
    const normalizedKey = agentWalletPrivateKey.startsWith("0x")
      ? agentWalletPrivateKey
      : `0x${agentWalletPrivateKey}`;
    const agentAccount = privateKeyToAccount(normalizedKey as Hex);

    // Deadline: 1 hour from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const domain = {
      name: "ERC8004IdentityRegistry",
      version: "1",
      chainId: this.chain.id,
      verifyingContract: this.erc8004Registry,
    } as const;

    const types = {
      AgentWalletSet: [
        { name: "agentId", type: "uint256" },
        { name: "newWallet", type: "address" },
        { name: "owner", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    } as const;

    const message = {
      agentId,
      newWallet,
      owner: this.address,
      deadline,
    } as const;

    const signature = await agentAccount.signTypedData({
      domain,
      types,
      primaryType: "AgentWalletSet",
      message,
    });

    const { request } = await this.publicClient.simulateContract({
      account: this.walletClient.account!,
      address: this.erc8004Registry,
      abi: erc8004Abi,
      functionName: "setAgentWallet",
      args: [agentId, newWallet, deadline, signature],
    });

    const txHash = await this.walletClient.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return { txHash };
  }

  // -------------------------------------------------------------------------
  // Royalty methods
  // -------------------------------------------------------------------------

  /**
   * Get royalty info for a beneficiary on a given reserve token.
   *
   * @param beneficiary - The royalty beneficiary (usually the bond creator)
   * @param reserveToken - The reserve token address (e.g. WETH on testnet, $PLOT on mainnet)
   * @returns Balance (unclaimed) and claimed royalty amounts
   */
  async getRoyaltyInfo(beneficiary: Address, reserveToken: Address): Promise<RoyaltyInfo> {
    const [balance, claimed] = await this.publicClient.readContract({
      address: this.mcv2Bond,
      abi: mcv2BondAbi,
      functionName: "getRoyaltyInfo",
      args: [beneficiary, reserveToken],
    }) as [bigint, bigint];

    return { balance, claimed };
  }

  /**
   * Claim accumulated royalties for a reserve token from the MCV2_Bond
   * bonding curve contract.
   *
   * @param reserveToken - The reserve token address (e.g. WETH on testnet, $PLOT on mainnet)
   * @returns Transaction hash
   */
  async claimRoyalties(reserveToken: Address): Promise<Hex> {
    const { request } = await this.publicClient.simulateContract({
      account: this.walletClient.account!,
      address: this.mcv2Bond,
      abi: mcv2BondAbi,
      functionName: "claimRoyalties",
      args: [reserveToken],
    });

    const txHash = await this.walletClient.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return txHash;
  }

  // -------------------------------------------------------------------------
  // Price methods
  // -------------------------------------------------------------------------

  /**
   * Get the current bonding-curve price for a storyline token.
   *
   * Calls MCV2_Bond.priceForNextMint() to get the cost (in reserve token)
   * to mint 1 unit of the given storyline token.
   *
   * @param tokenAddress - The storyline's ERC-20 token address
   * @returns Price info or null if the token has no bond / query fails
   */
  async getTokenPrice(tokenAddress: Address): Promise<TokenPriceInfo | null> {
    try {
      const result = await this.publicClient.readContract({
        address: this.mcv2Bond,
        abi: mcv2BondAbi,
        functionName: "priceForNextMint",
        args: [tokenAddress],
      });

      const priceRaw = BigInt(result as bigint);
      return {
        priceRaw,
        priceFormatted: formatUnits(priceRaw, 18),
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private requireFilebase(): void {
    if (!this.filebase) {
      throw new Error(
        "Filebase config required for IPFS uploads. " +
          "Pass { filebase: { accessKey, secretKey, bucket } } to the PlotLink constructor.",
      );
    }
  }

  /**
   * Paginated getLogs that chunks requests into RPC-safe ranges.
   * Public RPCs typically limit eth_getLogs to 10,000 blocks per request.
   */
  private async getLogsPaginated(params: {
    address: Address;
    event: (typeof storyFactoryAbi)[number] & { type: "event" };
    args?: Record<string, unknown>;
  }): Promise<unknown[]> {
    const MAX_RANGE = BigInt(9_999);
    const latestBlock = await this.publicClient.getBlockNumber();
    const from = this.deploymentBlock;
    const allLogs: unknown[] = [];

    for (let start = from; start <= latestBlock; start += MAX_RANGE + 1n) {
      const end = start + MAX_RANGE > latestBlock ? latestBlock : start + MAX_RANGE;
      const logs = await this.publicClient.getLogs({
        address: params.address,
        event: params.event,
        args: params.args,
        fromBlock: start,
        toBlock: end,
      } as Parameters<typeof this.publicClient.getLogs>[0]);
      allLogs.push(...logs);
    }

    return allLogs;
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Validate that a required string parameter is non-empty.
 */
function validateNonEmpty(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${name}" must be a non-empty string.`);
  }
}

// Content limits — mirrored from lib/content.ts in the web app
const MAX_TITLE_LENGTH = 60;
const MIN_CONTENT_LENGTH = 500;
const MAX_CONTENT_LENGTH = 10_000;

function validateTitle(title: string): void {
  const charCount = [...title].length;
  if (charCount > MAX_TITLE_LENGTH) {
    throw new Error(
      `Title must be ${MAX_TITLE_LENGTH} characters or less (currently: ${charCount})`,
    );
  }
}

function validateContentLength(content: string): void {
  const charCount = [...content].length;
  if (charCount < MIN_CONTENT_LENGTH || charCount > MAX_CONTENT_LENGTH) {
    throw new Error(
      `Content must be between ${MIN_CONTENT_LENGTH} and ${MAX_CONTENT_LENGTH} characters (currently: ${charCount})`,
    );
  }
}

/**
 * Compute keccak256 hash of content, matching the on-chain contentHash.
 * Same encoding as the web app's hashContent (lib/content.ts).
 */
function hashContent(content: string): Hex {
  return keccak256(toHex(content));
}

/**
 * Simple slugify for S3 keys.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

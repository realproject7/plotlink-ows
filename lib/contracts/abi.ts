/**
 * StoryFactory contract ABIs — event signatures and write functions.
 *
 * Source: proposal §4.1 (events), §4.3 (StoryFactory interface).
 * Contract address: see constants.ts (TBD until deployment).
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const plotChainedEvent = {
  type: "event",
  name: "PlotChained",
  inputs: [
    { name: "storylineId", type: "uint256", indexed: true },
    { name: "plotIndex", type: "uint256", indexed: true },
    { name: "writer", type: "address", indexed: true },
    { name: "title", type: "string", indexed: false },
    { name: "contentCID", type: "string", indexed: false },
    { name: "contentHash", type: "bytes32", indexed: false },
  ],
} as const;

export const storylineCreatedEvent = {
  type: "event",
  name: "StorylineCreated",
  inputs: [
    { name: "storylineId", type: "uint256", indexed: true },
    { name: "writer", type: "address", indexed: true },
    { name: "tokenAddress", type: "address", indexed: false },
    { name: "title", type: "string", indexed: false },
    { name: "hasDeadline", type: "bool", indexed: false },
    { name: "openingCID", type: "string", indexed: false },
    { name: "openingHash", type: "bytes32", indexed: false },
  ],
} as const;

export const donationEvent = {
  type: "event",
  name: "Donation",
  inputs: [
    { name: "storylineId", type: "uint256", indexed: true },
    { name: "donor", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
} as const;

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export const createStorylineFunction = {
  type: "function",
  name: "createStoryline",
  stateMutability: "payable",
  inputs: [
    { name: "title", type: "string" },
    { name: "openingCID", type: "string" },
    { name: "openingHash", type: "bytes32" },
    { name: "hasDeadline", type: "bool" },
  ],
  outputs: [{ name: "storylineId", type: "uint256" }],
} as const;

export const chainPlotFunction = {
  type: "function",
  name: "chainPlot",
  stateMutability: "nonpayable",
  inputs: [
    { name: "storylineId", type: "uint256" },
    { name: "title", type: "string" },
    { name: "contentCID", type: "string" },
    { name: "contentHash", type: "bytes32" },
  ],
  outputs: [],
} as const;

export const donateFunction = {
  type: "function",
  name: "donate",
  stateMutability: "nonpayable",
  inputs: [
    { name: "storylineId", type: "uint256" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [],
} as const;

// ---------------------------------------------------------------------------
// MCV2_Bond events (from MCV2_Bond.sol upstream)
// ---------------------------------------------------------------------------

export const mcv2MintEvent = {
  type: "event",
  name: "Mint",
  inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "receiver", type: "address", indexed: false },
    { name: "amountMinted", type: "uint256", indexed: false },
    { name: "reserveToken", type: "address", indexed: true },
    { name: "reserveAmount", type: "uint256", indexed: false },
  ],
} as const;

export const mcv2BurnEvent = {
  type: "event",
  name: "Burn",
  inputs: [
    { name: "token", type: "address", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "receiver", type: "address", indexed: false },
    { name: "amountBurned", type: "uint256", indexed: false },
    { name: "reserveToken", type: "address", indexed: true },
    { name: "refundAmount", type: "uint256", indexed: false },
  ],
} as const;

export const mcv2BondEventAbi = [mcv2MintEvent, mcv2BurnEvent] as const;

// ---------------------------------------------------------------------------
// MCV2_Bond view functions
// ---------------------------------------------------------------------------

/** Current cost (in reserve token) to mint 1 unit of the given token. */
export const priceForNextMintFunction = {
  type: "function",
  name: "priceForNextMint",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{ name: "", type: "uint128" }],
} as const;

/** 1inch Spot Price Aggregator: get exchange rate between two tokens. */
export const spotPriceAbi = [
  {
    inputs: [
      { name: "srcToken", type: "address" },
      { name: "dstToken", type: "address" },
      { name: "useWrappers", type: "bool" },
    ],
    name: "getRate",
    outputs: [{ name: "weightedRate", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** Full bond info for a token: creator, royalties, creation time, reserve. */
export const tokenBondFunction = {
  type: "function",
  name: "tokenBond",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [
    { name: "creator", type: "address" },
    { name: "mintRoyalty", type: "uint16" },
    { name: "burnRoyalty", type: "uint16" },
    { name: "createdAt", type: "uint40" },
    { name: "reserveToken", type: "address" },
    { name: "reserveBalance", type: "uint256" },
  ],
} as const;

// ---------------------------------------------------------------------------
// Combined ABI (for viem contract instances)
// ---------------------------------------------------------------------------

export const curveUpdatedEvent = {
  type: "event",
  name: "CurveUpdated",
  inputs: [{ name: "newStepCount", type: "uint256", indexed: false }],
} as const;

export const hasSunsetFunction = {
  type: "function",
  name: "hasSunset",
  stateMutability: "view",
  inputs: [{ name: "storylineId", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
} as const;

export const updateCurveFunction = {
  type: "function",
  name: "updateCurve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "newRanges", type: "uint128[]" },
    { name: "newPrices", type: "uint128[]" },
  ],
  outputs: [],
} as const;

export const ownerFunction = {
  type: "function",
  name: "owner",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "address" }],
} as const;

export const storyFactoryAbi = [
  plotChainedEvent,
  storylineCreatedEvent,
  donationEvent,
  curveUpdatedEvent,
  createStorylineFunction,
  chainPlotFunction,
  donateFunction,
  hasSunsetFunction,
  updateCurveFunction,
  ownerFunction,
] as const;

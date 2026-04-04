import { http, createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import type { Wallet } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  baseAccount,
  trustWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createFallbackTransport } from "./rpc";
import { DATA_SUFFIX } from "./builder-code";

const IS_MAINNET = process.env.NEXT_PUBLIC_CHAIN_ID === "8453";
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "placeholder";

// Custom Farcaster wallet — manual fallback when auto-connect fails
const farcasterWallet = (): Wallet => ({
  id: "farcaster",
  name: "Farcaster",
  iconUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' fill='%23855DCD'%3E%3Cpath d='M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z'/%3E%3Cpath d='M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V351.111H328.889V253.333H128.889Z'/%3E%3Cpath d='M671.111 253.333V351.111H693.333V746.667C681.06 746.667 671.111 756.616 671.111 768.889V795.556H666.667C654.394 795.556 644.444 805.505 644.444 817.778V844.444H893.333V817.778C893.333 805.505 883.384 795.556 871.111 795.556H866.667V768.889C866.667 756.616 856.717 746.667 844.444 746.667V351.111H868.889L897.778 253.333H671.111Z'/%3E%3C/svg%3E",
  iconBackground: "#855DCD",
  createConnector: () => farcasterMiniApp(),
});

// RainbowKit wallet list
const walletConnectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        farcasterWallet,
        metaMaskWallet,
        baseAccount,
        trustWallet,
        rainbowWallet,
        walletConnectWallet,
      ],
    },
  ],
  {
    appName: "PlotLink",
    projectId,
  },
);

const connectors = walletConnectors;

export const config = createConfig({
  chains: [base, baseSepolia],
  connectors,
  transports: {
    [base.id]: IS_MAINNET ? createFallbackTransport() : http(),
    [baseSepolia.id]: IS_MAINNET ? http() : createFallbackTransport(),
  },
  ssr: true,
  ...(DATA_SUFFIX ? { dataSuffix: DATA_SUFFIX } : {}),
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}

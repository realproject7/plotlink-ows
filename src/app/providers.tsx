"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import { config } from "../../lib/wagmi";
import { useState } from "react";

import "@rainbow-me/rainbowkit/styles.css";

// PlotLink-themed RainbowKit theme using CSS vars
const plotlinkTheme: Theme = {
  blurs: {
    modalOverlay: "blur(4px)",
  },
  colors: {
    accentColor: "var(--accent)",
    accentColorForeground: "var(--bg)",
    actionButtonBorder: "var(--border)",
    actionButtonBorderMobile: "var(--border)",
    actionButtonSecondaryBackground: "transparent",
    closeButton: "var(--text)",
    closeButtonBackground: "transparent",
    connectButtonBackground: "transparent",
    connectButtonBackgroundError: "transparent",
    connectButtonInnerBackground: "transparent",
    connectButtonText: "var(--text)",
    connectButtonTextError: "var(--error)",
    connectionIndicator: "var(--accent)",
    downloadBottomCardBackground: "var(--bg)",
    downloadTopCardBackground: "var(--accent)",
    error: "var(--error)",
    generalBorder: "var(--border)",
    generalBorderDim: "var(--border)",
    menuItemBackground: "var(--bg-surface)",
    modalBackdrop: "rgba(44, 24, 16, 0.4)",
    modalBackground: "var(--bg)",
    modalBorder: "var(--border)",
    modalText: "var(--text)",
    modalTextDim: "var(--text-muted)",
    modalTextSecondary: "var(--text-muted)",
    profileAction: "var(--bg-surface)",
    profileActionHover: "var(--accent)",
    profileForeground: "var(--bg)",
    selectedOptionBorder: "var(--accent)",
    standby: "var(--accent)",
  },
  fonts: {
    body: "ui-monospace, 'Geist Mono', monospace",
  },
  radii: {
    actionButton: "4px",
    connectButton: "4px",
    menuButton: "4px",
    modal: "8px",
    modalMobile: "8px",
  },
  shadows: {
    connectButton: "none",
    dialog: "0 4px 24px rgba(44, 24, 16, 0.15)",
    profileDetailsAction: "none",
    selectedOption: "0 2px 8px rgba(44, 24, 16, 0.1)",
    selectedWallet: "0 2px 8px rgba(44, 24, 16, 0.1)",
    walletLogo: "none",
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={plotlinkTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

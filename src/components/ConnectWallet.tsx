"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { isFarcasterMiniApp } from "../../lib/farcaster-detect";
import { truncateAddress } from "../../lib/utils";
import { useConnectedIdentity } from "../hooks/useConnectedIdentity";

interface ConnectWalletProps {
  onNavigate?: () => void;
  /** Compact mode for mobile top nav — shows only PFP + short ID */
  compact?: boolean;
}

export function ConnectWallet({ onNavigate, compact }: ConnectWalletProps = {}) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const autoConnectAttempted = useRef(false);
  const [inMiniApp, setInMiniApp] = useState(false);
  const { profile } = useConnectedIdentity();

  // Detect Farcaster mini app context once on mount
  useEffect(() => {
    isFarcasterMiniApp().then(setInMiniApp);
  }, []);

  // Auto-connect with the Farcaster connector when inside a mini app
  useEffect(() => {
    if (!inMiniApp) return;
    if (autoConnectAttempted.current || isConnected) return;
    autoConnectAttempted.current = true;

    const farcasterConnector = connectors.find((c) => c.type === "farcasterMiniApp");
    if (!farcasterConnector) return;

    connect({ connector: farcasterConnector });
  }, [inMiniApp, connectors, connect, isConnected]);

  // Connected state
  if (isConnected && address) {
    const displayAddr = truncateAddress(address);

    // Compact mode: bordered box for mobile top nav (matches hamburger box height)
    if (compact) {
      return (
        <Link
          href={`/profile/${address}`}
          onClick={onNavigate}
          className="border-border text-accent inline-flex h-7 items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium hover:opacity-80 transition-opacity"
        >
          {profile?.pfpUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.pfpUrl}
              alt=""
              width={16}
              height={16}
              className="rounded-full"
            />
          )}
          {displayAddr}
        </Link>
      );
    }

    // Full mode: pill with PFP + @username or truncated address
    return (
      <Link
        href={`/profile/${address}`}
        onClick={onNavigate}
        className="border-border text-accent inline-flex items-center gap-1.5 rounded border px-3 py-1 text-xs font-medium hover:opacity-80 transition-opacity"
      >
        {profile?.pfpUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.pfpUrl}
            alt=""
            width={18}
            height={18}
            className="rounded-full"
          />
        )}
        {displayAddr}
      </Link>
    );
  }

  // Disconnected state: RainbowKit modal
  return (
    <ConnectButton.Custom>
      {({ openConnectModal, mounted }) => {
        const ready = mounted;

        return (
          <div
            {...(!ready && {
              "aria-hidden": true,
              style: {
                opacity: 0,
                pointerEvents: "none" as const,
                userSelect: "none" as const,
              },
            })}
          >
            <button
              onClick={openConnectModal}
              type="button"
              className={
                compact
                  ? "border-border text-accent hover:bg-accent hover:text-background flex h-7 items-center rounded border px-2 py-1 text-xs font-medium transition-colors"
                  : "border-border text-accent hover:bg-accent hover:text-background rounded border px-3 py-1 text-xs font-medium transition-colors"
              }
            >
              {compact ? "Connect" : "connect wallet"}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/**
 * Disconnect button for use on the profile page.
 * Only renders when the viewer is viewing their own profile.
 */
export function DisconnectButton() {
  const { disconnect } = useDisconnect();

  return (
    <button
      onClick={() => disconnect()}
      className="text-muted hover:text-error border-border rounded border px-2 py-0.5 text-[10px] transition-colors"
    >
      disconnect
    </button>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { ConnectWallet } from "../../../components/ConnectWallet";

export default function WriterRedirect() {
  const router = useRouter();
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected && address) {
      router.replace(`/profile/${address}?tab=stories`);
    }
  }, [isConnected, address, router]);

  if (!isConnected) {
    return (
      <div className="flex min-h-[calc(100vh-2.75rem)] flex-col items-center justify-center gap-4 px-6">
        <p className="text-muted text-sm">
          Connect your wallet to view your dashboard.
        </p>
        <ConnectWallet />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-2.75rem)] items-center justify-center">
      <p className="text-muted text-sm">Redirecting to profile...</p>
    </div>
  );
}

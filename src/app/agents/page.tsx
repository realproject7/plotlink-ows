"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { ConnectWallet } from "../../components/ConnectWallet";
import { AgentRegister } from "../../components/AgentRegister";
import { AgentManage } from "../../components/AgentManage";
import { AgentBuild } from "../../components/AgentBuild";
import { AgentDashboard } from "../../components/AgentDashboard";
import { erc8004Abi } from "../../../lib/contracts/erc8004";
import { ERC8004_REGISTRY } from "../../../lib/contracts/constants";
import { getAgentUserFromDB, checkUserExists, cacheAgentById } from "../../../lib/actions";

type Tab = "register" | "build" | "dashboard";

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsPageInner />
    </Suspense>
  );
}

function AgentsPageInner() {
  const { isConnected, address } = useAccount();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "register";
  const [tab, setTab] = useState<Tab>(
    ["register", "build", "dashboard"].includes(initialTab) ? initialTab : "register",
  );

  // DB-first: check if user has cached agent data
  const { data: dbUser, isLoading: dbLoading } = useQuery({
    queryKey: ["db-user-agent", address],
    queryFn: () => getAgentUserFromDB(address!),
    enabled: !!address,
  });

  const dbAgentId = dbUser?.agent_id;
  const dbIsOwner = dbAgentId != null && dbUser?.agent_owner?.toLowerCase() === address?.toLowerCase();
  const dbIsAgentWallet = dbAgentId != null && dbUser?.agent_wallet?.toLowerCase() === address?.toLowerCase();
  const dbDetected = dbAgentId != null;

  // Check if user exists in DB at all (even without agent_id)
  const { data: userExists, isLoading: userExistsLoading } = useQuery({
    queryKey: ["user-exists", address],
    queryFn: () => checkUserExists(address!),
    enabled: !!address && !dbLoading && !dbDetected,
  });

  // RPC fallback: only for completely unknown wallets (no DB record at all)
  // Known users with agent_id=NULL are definitively non-agents — zero RPC calls
  // External registrations are detected via profile refresh (/api/user/onboard)
  const needsRpcFallback = !dbLoading && !dbDetected && !userExistsLoading && userExists === false && !!address;

  const { data: rpcAgentId, isLoading: rpcWalletLoading } = useReadContract({
    address: ERC8004_REGISTRY,
    abi: erc8004Abi,
    functionName: "agentIdByWallet",
    args: address ? [address] : undefined,
    query: { enabled: needsRpcFallback },
  });

  const { data: rpcBalance, isLoading: rpcBalanceLoading } = useReadContract({
    address: ERC8004_REGISTRY,
    abi: erc8004Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: needsRpcFallback },
  });

  const rpcHasNft = rpcBalance !== undefined && rpcBalance > BigInt(0);
  const { data: rpcOwnedToken, isLoading: rpcTokenLoading } = useReadContract({
    address: ERC8004_REGISTRY,
    abi: erc8004Abi,
    functionName: "tokenOfOwnerByIndex",
    args: address ? [address, BigInt(0)] : undefined,
    query: { enabled: needsRpcFallback && rpcHasNft },
  });

  const rpcIsAgentWallet = rpcAgentId !== undefined && rpcAgentId > BigInt(0);
  const rpcIsOwner = rpcHasNft && rpcOwnedToken !== undefined;

  // Combine DB + RPC results
  let detectedAgentId: bigint | undefined;
  let detectedRole: "owner" | "agentWallet" | undefined;

  if (dbDetected) {
    detectedAgentId = BigInt(dbAgentId!);
    detectedRole = dbIsOwner ? "owner" : dbIsAgentWallet ? "agentWallet" : "owner";
  } else if (rpcIsOwner) {
    detectedAgentId = rpcOwnedToken;
    detectedRole = "owner";
  } else if (rpcIsAgentWallet) {
    detectedAgentId = rpcAgentId;
    detectedRole = "agentWallet";
  }

  const hasExistingAgent = detectedAgentId !== undefined && detectedRole !== undefined;
  const detectLoading = dbLoading || (!dbDetected && userExistsLoading) || (needsRpcFallback && (rpcWalletLoading || rpcBalanceLoading || (rpcHasNft && rpcTokenLoading)));

  // Auto-cache: when RPC fallback detects an agent not in DB, persist it
  const cachedRef = useRef(false);
  useEffect(() => {
    if (!dbDetected && hasExistingAgent && address && detectedAgentId && !cachedRef.current) {
      cachedRef.current = true;
      cacheAgentById(address, detectedAgentId.toString()).catch(() =>
        cacheAgentById(address, detectedAgentId.toString()).catch(() => {}),
      );
    }
  }, [dbDetected, hasExistingAgent, address, detectedAgentId]);

  const firstTabLabel = hasExistingAgent ? "Manage" : "Register";

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      {/* Hero section */}
      <div className="mb-10">
        <h1 className="font-body text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Your AI Writes.{" "}
          <span className="text-accent">You Earn.</span>
        </h1>
        <p className="text-muted mt-3 max-w-md text-sm leading-relaxed">
          Bring any AI. PlotLink publishes the fiction, handles the trading, and sends you royalties.
          Anyone can be a writer.
        </p>

        {/* Terminal session — the journey */}
        <div className="border-border bg-surface mt-6 overflow-hidden rounded-lg border">
          {/* Terminal title bar */}
          <div className="border-border flex items-center gap-1.5 border-b px-3 py-1.5">
            <span className="bg-muted/40 h-2 w-2 rounded-full" />
            <span className="bg-muted/40 h-2 w-2 rounded-full" />
            <span className="bg-muted/40 h-2 w-2 rounded-full" />
            <span className="text-muted ml-2 text-[10px] font-mono">plotlink</span>
          </div>
          {/* Terminal body */}
          <div className="space-y-3 px-4 py-4 font-mono text-xs leading-relaxed sm:px-5 sm:text-[13px]">
            <div>
              <span className="text-muted">$</span>{" "}
              <span className="text-foreground">plotlink create</span>{" "}
              <span className="text-muted">--agent my-ai</span>
            </div>
            <div className="text-muted pl-3 sm:pl-4">
              &#x2713; Agent registered &middot; writing first chapter...
            </div>
            <div>
              <span className="text-muted">$</span>{" "}
              <span className="text-foreground">plotlink publish</span>
            </div>
            <div className="text-muted pl-3 sm:pl-4">
              &#x2713; Story live on-chain &middot; readers trading
            </div>
            <div>
              <span className="text-muted">$</span>{" "}
              <span className="text-foreground">plotlink earnings</span>
            </div>
            <div className="pl-3 sm:pl-4">
              <span className="text-accent">+0.042 ETH</span>{" "}
              <span className="text-muted">royalties earned this week</span>
              <span className="text-accent ml-0.5 inline-block w-[2px] h-[1em] align-middle bg-current animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="mt-8 flex gap-2 border-b border-[var(--border)] pb-2">
        {(["register", "build", "dashboard"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t === "register" ? firstTabLabel : t === "build" ? "Build" : "Dashboard"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "register" && (
        !isConnected ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <p className="text-muted text-sm">Connect your wallet to register or manage an agent.</p>
            <ConnectWallet />
          </div>
        ) : detectLoading ? (
          <div className="mt-6 py-8 text-center">
            <p className="text-muted text-sm">Detecting agent status...</p>
          </div>
        ) : hasExistingAgent ? (
          <AgentManage agentId={detectedAgentId!} role={detectedRole!} />
        ) : (
          <AgentRegister />
        )
      )}
      {tab === "build" && <AgentBuild />}
      {tab === "dashboard" && (
        !isConnected ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <p className="text-muted text-sm">Connect your wallet to view your agent dashboard.</p>
            <ConnectWallet />
          </div>
        ) : (
          <AgentDashboard />
        )
      )}
    </div>
  );
}

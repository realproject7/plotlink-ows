"use client";

import { useEffect, useRef } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { erc8004Abi } from "../../lib/contracts/erc8004";
import { ERC8004_REGISTRY } from "../../lib/contracts/constants";
import { getAgentUserFromDB, checkUserExists, cacheAgentById } from "../../lib/actions";

export function AgentDashboard() {
  const { address } = useAccount();

  // DB-first: check cached agent data
  const { data: dbUser, isLoading: dbLoading } = useQuery({
    queryKey: ["db-user-dashboard", address],
    queryFn: () => getAgentUserFromDB(address!),
    enabled: !!address,
  });

  const dbAgentId = dbUser?.agent_id;
  const dbDetected = dbAgentId != null;
  const dbIsOwner = dbDetected && dbUser?.agent_owner?.toLowerCase() === address?.toLowerCase();
  const dbIsAgentWallet = dbDetected && dbUser?.agent_wallet?.toLowerCase() === address?.toLowerCase();
  const dbAgentWallet = dbUser?.agent_wallet;

  // Check if user exists in DB at all (even without agent_id)
  const { data: userExists, isLoading: userExistsLoading } = useQuery({
    queryKey: ["user-exists-dashboard", address],
    queryFn: () => checkUserExists(address!),
    enabled: !!address && !dbLoading && !dbDetected,
  });

  // RPC fallback: only for completely unknown wallets (no DB record at all)
  // Known users with agent_id=NULL are definitively non-agents — zero RPC calls
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

  const rpcIsOwner = rpcHasNft && rpcOwnedToken !== undefined;
  const { data: rpcBoundWallet } = useReadContract({
    address: ERC8004_REGISTRY,
    abi: erc8004Abi,
    functionName: "getAgentWallet",
    args: rpcOwnedToken !== undefined ? [rpcOwnedToken] : undefined,
    query: { enabled: needsRpcFallback && rpcIsOwner },
  });

  const rpcIsAgentWallet = rpcAgentId !== undefined && rpcAgentId > BigInt(0);

  // Combine DB + RPC
  let agentId: bigint | undefined;
  let isOwner = false;
  let isAgentWallet = false;
  let writerAddress: string | undefined = address;

  if (dbDetected) {
    agentId = BigInt(dbAgentId!);
    isOwner = dbIsOwner;
    isAgentWallet = dbIsAgentWallet;
    // For owner, use cached agent_wallet for storyline lookup
    if (dbIsOwner && dbAgentWallet) {
      writerAddress = dbAgentWallet;
    }
  } else if (rpcIsOwner) {
    agentId = rpcOwnedToken;
    isOwner = true;
    const hasValidRpcWallet = rpcBoundWallet && rpcBoundWallet !== "0x0000000000000000000000000000000000000000";
    if (hasValidRpcWallet) writerAddress = rpcBoundWallet as string;
  } else if (rpcIsAgentWallet) {
    agentId = rpcAgentId;
    isAgentWallet = true;
  }

  const isAgent = agentId !== undefined;
  const detectLoading = dbLoading || (!dbDetected && userExistsLoading) || (needsRpcFallback && (rpcWalletLoading || rpcBalanceLoading || (rpcHasNft && rpcTokenLoading)));

  // Auto-cache: when RPC fallback detects an agent not in DB, persist it
  const cachedRef = useRef(false);
  useEffect(() => {
    if (!dbDetected && isAgent && address && agentId && !cachedRef.current) {
      cachedRef.current = true;
      cacheAgentById(address, agentId.toString()).catch(() =>
        cacheAgentById(address, agentId.toString()).catch(() => {}),
      );
    }
  }, [dbDetected, isAgent, address, agentId]);

  // Fetch agent's storylines from Supabase
  const { data: storylines, isLoading: storylinesLoading } = useQuery({
    queryKey: ["agent-storylines", writerAddress],
    queryFn: async () => {
      if (!writerAddress) return [];
      const res = await fetch(`/api/storyline/by-writer?writer=${writerAddress}&type=agent`);
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ storyline_id: number; title: string; token_address: string; plot_count: number }>>;
    },
    enabled: !!writerAddress && isAgent,
  });

  if (detectLoading) {
    return (
      <div className="mt-6 py-8 text-center">
        <p className="text-muted text-sm">Loading agent status...</p>
      </div>
    );
  }

  if (!isAgent) {
    return (
      <div className="mt-6 py-8 text-center">
        <p className="text-muted text-sm mb-2">This wallet is not registered as an agent.</p>
        <p className="text-muted text-xs">
          Switch to the <span className="text-accent font-medium">Register</span> tab to register your agent.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="border-accent/30 bg-accent/5 rounded border px-4 py-3 mb-6">
        <p className="text-accent text-sm font-medium">Agent #{agentId!.toString()}</p>
        <p className="text-muted mt-1 text-xs">
          {isOwner && isAgentWallet
            ? "Connected as owner + agent wallet"
            : isOwner
              ? "Connected as owner"
              : "Connected as agent wallet"}
        </p>
        <p className="text-muted text-xs font-mono">
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </p>
      </div>

      <h3 className="text-foreground text-sm font-bold mb-3">Your Storylines</h3>

      {storylinesLoading ? (
        <p className="text-muted text-xs py-4">Loading storylines...</p>
      ) : !storylines || storylines.length === 0 ? (
        <div className="border-border rounded border p-6 text-center">
          <p className="text-muted text-sm mb-2">No storylines yet.</p>
          <Link href="/create" className="text-accent text-xs hover:underline">
            Create your first storyline
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {storylines.map((s) => (
            <Link
              key={s.storyline_id}
              href={`/story/${s.storyline_id}`}
              className="border-border hover:border-accent flex items-center justify-between rounded border p-3 transition-colors"
            >
              <div>
                <p className="text-foreground text-sm font-medium">{s.title}</p>
                <p className="text-muted text-xs mt-0.5">
                  {s.plot_count} plot{s.plot_count !== 1 ? "s" : ""}
                </p>
              </div>
              <span className="text-muted text-xs">#{s.storyline_id}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

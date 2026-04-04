import React, { useState, useEffect } from "react";

const API_BASE = "http://localhost:7777";

interface WalletInfo {
  exists: boolean;
  walletId?: string;
  name?: string;
  address?: string;
  usdcBalance?: string;
  error?: string;
}

export function WalletCard({ token }: { token: string }) {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

  const loadWallet = () => {
    authFetch(`${API_BASE}/api/wallet`)
      .then((r) => r.json())
      .then((data) => setWallet(data))
      .catch(() => setWallet({ exists: false, error: "Failed to load wallet" }));
  };

  useEffect(() => { loadWallet(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/wallet/create`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Creation failed");
      loadWallet();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create wallet");
    }
    setCreating(false);
  };

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div className="border-border rounded border p-4">
      <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">OWS Wallet</h3>

      {!wallet && <p className="text-muted text-xs">loading...</p>}

      {wallet && !wallet.exists && (
        <div className="space-y-3">
          <p className="text-muted text-xs">No wallet created yet. Create one to enable autonomous transactions.</p>
          {error && <p className="text-error text-xs">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={creating}
            className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 rounded border px-4 py-2 text-xs font-medium transition-colors"
          >
            {creating ? "creating..." : "create wallet"}
          </button>
        </div>
      )}

      {wallet && wallet.exists && wallet.address && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-muted text-[10px] uppercase tracking-wider">Address (Base)</span>
            <span className={`rounded border px-1.5 py-0.5 text-[9px] ${wallet.usdcBalance && parseFloat(wallet.usdcBalance) > 0 ? "border-accent/30 text-accent" : "border-accent-dim/30 text-accent-dim"}`}>
              {wallet.usdcBalance && parseFloat(wallet.usdcBalance) > 0 ? "active" : "no balance"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <code className="text-foreground bg-surface rounded px-2 py-1 text-xs font-mono">{truncate(wallet.address)}</code>
            <button onClick={copyAddress} className="text-muted hover:text-accent text-xs transition-colors">
              {copied ? "copied" : "copy"}
            </button>
          </div>

          <div className="border-border space-y-1 border-t pt-3">
            <div className="flex justify-between text-xs">
              <span className="text-muted">USDC Balance</span>
              <span className="text-foreground font-medium">${wallet.usdcBalance || "0.00"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Network</span>
              <span className="text-foreground">Base</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Wallet ID</span>
              <span className="text-foreground font-mono text-[10px]">{wallet.walletId?.slice(0, 12)}...</span>
            </div>
          </div>

          {/* Fund wallet */}
          <div className="border-border border-t pt-3">
            <p className="text-muted mb-2 text-[10px] font-medium uppercase tracking-wider">Fund Wallet</p>
            <p className="text-muted text-[10px]">Send USDC on Base to:</p>
            <code className="text-foreground bg-surface mt-1 block break-all rounded px-2 py-1.5 text-[10px] font-mono">{wallet.address}</code>
          </div>
        </div>
      )}
    </div>
  );
}

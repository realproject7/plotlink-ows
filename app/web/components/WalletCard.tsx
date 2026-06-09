import React, { useCallback, useState, useEffect } from "react";

const API_BASE = "http://localhost:7777";

interface WalletInfo {
  exists: boolean;
  walletId?: string;
  name?: string;
  address?: string;
  activeWallet?: WalletChoice;
  wallets?: WalletChoice[];
  selectionRequired?: boolean;
  ethBalance?: string;
  usdcBalance?: string;
  plotBalance?: string;
  error?: string;
}

interface WalletChoice {
  walletId?: string;
  name: string;
  address?: string;
  normalizedAddress?: string;
  source: "ows";
  label: string;
  recognized: boolean;
  active: boolean;
}

export function WalletCard({ token }: { token: string }) {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendToken, setSendToken] = useState<"ETH" | "PLOT" | "USDC">("ETH");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendConfirming, setSendConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ txHash: string; amount: string; token: string; basescanUrl?: string } | null>(null);

  const authFetch = useCallback((url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }),
  [token]);

  const loadWallet = useCallback(() => {
    authFetch(`${API_BASE}/api/wallet`)
      .then((r) => r.json())
      .then((data) => setWallet(data))
      .catch(() => setWallet({ exists: false, error: "Failed to load wallet" }));
  }, [authFetch]);

  useEffect(() => { loadWallet(); }, [loadWallet]);

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

  const handleSwitch = async (choice: WalletChoice) => {
    setSwitching(choice.walletId || choice.name);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/wallet/active`, {
        method: "POST",
        body: JSON.stringify({
          walletId: choice.walletId,
          name: choice.name,
          address: choice.normalizedAddress || choice.address,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Wallet switch failed");
      loadWallet();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to switch wallet");
    }
    setSwitching(null);
  };

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const selectedBalance = sendToken === "ETH" ? wallet?.ethBalance : sendToken === "PLOT" ? wallet?.plotBalance : wallet?.usdcBalance;

  const resetSendDraft = () => {
    setSendTo("");
    setSendAmount("");
    setSendConfirming(false);
    setSendError(null);
  };

  const handleSendReview = () => {
    setSendError(null);
    setSendResult(null);
    if (!sendTo.trim()) {
      setSendError("Recipient address required");
      return;
    }
    if (!sendAmount.trim() || Number(sendAmount) <= 0) {
      setSendError("Positive amount required");
      return;
    }
    setSendConfirming(true);
  };

  const handleSend = async () => {
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const res = await authFetch(`${API_BASE}/api/wallet/send`, {
        method: "POST",
        body: JSON.stringify({ token: sendToken, to: sendTo.trim(), amount: sendAmount.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transfer failed");
      setSendResult({ txHash: data.txHash, amount: data.amount, token: data.token, basescanUrl: data.basescanUrl });
      resetSendDraft();
      loadWallet();
    } catch (err: unknown) {
      setSendError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-border rounded border p-4">
      <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">OWS Wallet</h3>

      {!wallet && <p className="text-muted text-xs">loading...</p>}

      {wallet && !wallet.exists && (
        <div className="space-y-3">
          <p className="text-muted text-xs">{wallet.error || "No wallet created yet. Create one to enable autonomous transactions."}</p>
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

      {wallet?.selectionRequired && wallet.wallets && wallet.wallets.length > 0 && (
        <div className="mb-4 space-y-3 rounded border border-amber-600/30 bg-amber-950/10 p-3">
          <p className="text-xs text-amber-700">Multiple OWS wallets found. Select the wallet OWS should use for publishing and signing.</p>
          {wallet.wallets.map((choice) => (
            <div key={choice.walletId || choice.name} className="border-border flex items-center justify-between gap-3 rounded border p-2">
              <div className="min-w-0">
                <p className="text-foreground truncate text-xs font-medium">{choice.name}</p>
                <p className="text-muted truncate text-[10px] font-mono">{choice.address || "No EVM address"}</p>
              </div>
              <button
                onClick={() => handleSwitch(choice)}
                disabled={!choice.address || switching === (choice.walletId || choice.name)}
                className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 rounded border px-2 py-1 text-[10px] font-medium transition-colors"
              >
                {switching === (choice.walletId || choice.name) ? "switching..." : "use"}
              </button>
            </div>
          ))}
          {error && <p className="text-error text-xs">{error}</p>}
        </div>
      )}

      {wallet && wallet.exists && wallet.address && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-muted text-[10px] uppercase tracking-wider">Active Wallet (Base)</span>
            <span className={`rounded border px-1.5 py-0.5 text-[9px] ${wallet.ethBalance && parseFloat(wallet.ethBalance) > 0 ? "border-accent/30 text-accent" : "border-accent-dim/30 text-accent-dim"}`}>
              {wallet.ethBalance && parseFloat(wallet.ethBalance) > 0 ? "active" : "no balance"}
            </span>
          </div>

          {wallet.name && (
            <div className="flex justify-between text-xs">
              <span className="text-muted">Name</span>
              <span className="text-foreground truncate pl-3 font-mono text-[10px]">{wallet.name}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <code className="text-foreground bg-surface rounded px-2 py-1 text-xs font-mono">{truncate(wallet.address)}</code>
            <button onClick={copyAddress} className="text-muted hover:text-accent text-xs transition-colors">
              {copied ? "copied" : "copy"}
            </button>
          </div>

          <div className="border-border space-y-1 border-t pt-3">
            <div className="flex justify-between text-xs">
              <span className="text-muted">ETH</span>
              <span className="text-foreground font-medium">{wallet.ethBalance || "0.000000"} ETH</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">USDC</span>
              <span className="text-foreground font-medium">${wallet.usdcBalance || "0.00"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">PLOT</span>
              <span className="text-foreground font-medium">{wallet.plotBalance || "0.0000"} PLOT</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Network</span>
              <span className="text-foreground">Base</span>
            </div>
          </div>

          <div className="border-border border-t pt-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-muted text-[10px] font-medium uppercase tracking-wider">Send / Withdraw</p>
                <p className="text-muted text-[10px]">Send ETH, PLOT, or USDC from this OWS wallet on Base.</p>
              </div>
              <button
                onClick={() => {
                  setSendOpen((open) => !open);
                  setSendResult(null);
                  setSendError(null);
                  setSendConfirming(false);
                }}
                className="border-accent text-accent hover:bg-accent/10 rounded border px-3 py-1.5 text-[10px] font-bold transition-colors"
              >
                {sendOpen ? "close" : "send"}
              </button>
            </div>

            {sendOpen && (
              <div className="mt-3 space-y-3 rounded border border-border bg-surface p-3">
                <div className="grid grid-cols-3 gap-2">
                  {(["ETH", "PLOT", "USDC"] as const).map((symbol) => (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() => {
                        setSendToken(symbol);
                        setSendConfirming(false);
                        setSendError(null);
                      }}
                      className={sendToken === symbol
                        ? "bg-accent text-background rounded px-2 py-1.5 text-[10px] font-bold"
                        : "border-border text-muted hover:text-accent rounded border px-2 py-1.5 text-[10px]"}
                    >
                      {symbol}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted">Available</span>
                  <span className="text-foreground">{selectedBalance || "0"} {sendToken}</span>
                </div>

                <label className="block space-y-1 text-[10px]">
                  <span className="text-muted uppercase tracking-wider">Recipient</span>
                  <input
                    value={sendTo}
                    onChange={(e) => {
                      setSendTo(e.target.value);
                      setSendConfirming(false);
                    }}
                    placeholder="0x..."
                    className="border-border bg-background text-foreground w-full rounded border px-2 py-1.5 font-mono text-xs"
                  />
                </label>

                <label className="block space-y-1 text-[10px]">
                  <span className="text-muted uppercase tracking-wider">Amount</span>
                  <input
                    value={sendAmount}
                    onChange={(e) => {
                      setSendAmount(e.target.value);
                      setSendConfirming(false);
                    }}
                    inputMode="decimal"
                    placeholder="0.0"
                    className="border-border bg-background text-foreground w-full rounded border px-2 py-1.5 font-mono text-xs"
                  />
                </label>

                {!sendConfirming ? (
                  <button
                    type="button"
                    onClick={handleSendReview}
                    className="bg-accent text-background hover:bg-accent/90 rounded px-3 py-1.5 text-[10px] font-bold transition-colors"
                  >
                    Review send
                  </button>
                ) : (
                  <div className="space-y-2 rounded border border-amber-600/30 bg-amber-950/10 p-3">
                    <p className="text-xs text-amber-700">
                      Confirm sending {sendAmount} {sendToken} to <span className="font-mono">{truncate(sendTo)}</span> on Base.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSend}
                        disabled={sending}
                        className="bg-accent text-background hover:bg-accent/90 disabled:opacity-40 rounded px-3 py-1.5 text-[10px] font-bold transition-colors"
                      >
                        {sending ? "Sending..." : "Confirm send"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSendConfirming(false)}
                        disabled={sending}
                        className="border-border text-muted hover:text-accent rounded border px-3 py-1.5 text-[10px] transition-colors"
                      >
                        edit
                      </button>
                    </div>
                  </div>
                )}

                {sendError && <p className="text-error text-[10px]">{sendError}</p>}
                {sendResult && (
                  <p className="text-accent text-[10px]">
                    Sent {sendResult.amount} {sendResult.token} ·{" "}
                    <a href={sendResult.basescanUrl || `https://basescan.org/tx/${sendResult.txHash}`} target="_blank" rel="noopener noreferrer" className="underline">
                      view tx
                    </a>
                  </p>
                )}
              </div>
            )}
          </div>

          {wallet.wallets && wallet.wallets.length > 1 && (
            <div className="border-border space-y-2 border-t pt-3">
              <p className="text-muted text-[10px] font-medium uppercase tracking-wider">Switch Wallet</p>
              {wallet.wallets.map((choice) => (
                <div key={choice.walletId || choice.name} className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className={choice.active ? "text-accent truncate font-medium" : "text-foreground truncate"}>
                      {choice.name}{choice.active ? " (active)" : ""}
                    </p>
                    <p className="text-muted truncate text-[10px] font-mono">{choice.address || "No EVM address"}</p>
                  </div>
                  {!choice.active && (
                    <button
                      onClick={() => handleSwitch(choice)}
                      disabled={!choice.address || switching === (choice.walletId || choice.name)}
                      className="border-border text-muted hover:border-accent hover:text-accent disabled:opacity-40 rounded border px-2 py-1 text-[10px] transition-colors"
                    >
                      {switching === (choice.walletId || choice.name) ? "..." : "use"}
                    </button>
                  )}
                </div>
              ))}
              {error && <p className="text-error text-xs">{error}</p>}
            </div>
          )}

          {/* Fund wallet */}
          <div className="border-border border-t pt-3">
            <p className="text-muted mb-2 text-[10px] font-medium uppercase tracking-wider">Fund Wallet</p>
            <p className="text-muted text-[10px]">Send ETH on Base for gas (~$0.01 per publish):</p>
            <code className="text-foreground bg-surface mt-1 block break-all rounded px-2 py-1.5 text-[10px] font-mono">{wallet.address}</code>
          </div>
        </div>
      )}

      {wallet?.exists && (
        <button
          onClick={handleCreate}
          disabled={creating}
          className="border-border text-muted hover:border-accent hover:text-accent disabled:opacity-40 mt-4 rounded border px-3 py-1.5 text-[10px] font-medium transition-colors"
        >
          {creating ? "creating..." : "create another wallet"}
        </button>
      )}
    </div>
  );
}

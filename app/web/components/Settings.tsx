import React, { useState, useEffect, useCallback } from "react";
import { WalletCard } from "./WalletCard";

export function Settings({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseSuccess, setPassphraseSuccess] = useState(false);
  const [savingPassphrase, setSavingPassphrase] = useState(false);

  // Link to PlotLink
  const [linkStatus, setLinkStatus] = useState<{ linked: boolean; agentId?: number; owsWallet?: string; owner?: string } | null>(null);
  const [humanWallet, setHumanWallet] = useState("");
  const [bindingResult, setBindingResult] = useState<{ message: string; signature: string; owsWallet: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"signature" | "wallet" | null>(null);

  const authFetch = useCallback((url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }),
  [token]);

  // Check link status on mount
  useEffect(() => {
    authFetch("/api/settings/link-status")
      .then((r) => r.json())
      .then((data) => setLinkStatus(data))
      .catch(() => setLinkStatus({ linked: false }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerateBinding = async () => {
    if (!humanWallet.trim() || !/^0x[a-fA-F0-9]{40}$/.test(humanWallet)) {
      setBindingError("Enter a valid wallet address (0x...)");
      return;
    }
    setGenerating(true);
    setBindingError(null);
    setBindingResult(null);
    try {
      const res = await authFetch("/api/settings/generate-binding", {
        method: "POST",
        body: JSON.stringify({ humanWallet }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate binding code");
      setBindingResult(data);
    } catch (err: unknown) {
      setBindingError(err instanceof Error ? err.message : "Failed to generate binding code");
    }
    setGenerating(false);
  };

  const copyToClipboard = async (text: string, field: "signature" | "wallet") => {
    await navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleResetPassphrase = async () => {
    setPassphraseError(null);
    setPassphraseSuccess(false);
    if (!newPassphrase || newPassphrase.length < 4) {
      setPassphraseError("Passphrase must be at least 4 characters");
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      setPassphraseError("Passphrases do not match");
      return;
    }
    setSavingPassphrase(true);
    try {
      const res = await authFetch("/api/auth/reset-passphrase", {
        method: "POST",
        body: JSON.stringify({ passphrase: newPassphrase }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Reset failed");
      }
      setPassphraseSuccess(true);
      setNewPassphrase("");
      setConfirmPassphrase("");
      setTimeout(() => setPassphraseSuccess(false), 3000);
    } catch (err: unknown) {
      setPassphraseError(err instanceof Error ? err.message : "Reset failed");
    }
    setSavingPassphrase(false);
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <h2 className="text-accent text-lg font-bold">Settings</h2>

      {/* Link to PlotLink */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Link to PlotLink</h3>
        {linkStatus?.linked ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: "#00ff88" }}>Linked to PlotLink</span>
              <span className="text-muted text-xs">Agent #{linkStatus.agentId}</span>
            </div>
            {linkStatus.owner && (
              <p className="text-muted text-xs font-mono">
                Owner: {linkStatus.owner.slice(0, 6)}...{linkStatus.owner.slice(-4)}
              </p>
            )}
            <p className="text-muted text-xs">
              <a href={`https://plotlink.xyz/agents/${linkStatus.agentId}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                View agent profile on plotlink.xyz
              </a>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-muted text-xs">
              Connect this AI writer wallet to your PlotLink account. After linking, your stories will show as &quot;{"{your name}'s AI Writer"}&quot; on plotlink.xyz.
            </p>
            <div className="text-muted text-xs space-y-1 pl-3">
              <p>1. Enter your PlotLink wallet address below</p>
              <p>2. Click &quot;Generate Binding Code&quot;</p>
              <p>3. Copy the code and paste it on plotlink.xyz &rarr; Agents &rarr; Link AI Writer</p>
            </div>

            <input
              value={humanWallet}
              onChange={(e) => setHumanWallet(e.target.value)}
              placeholder="Your PlotLink wallet address (0x...)"
              className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent font-mono"
            />

            {bindingError && <p className="text-error text-xs">{bindingError}</p>}

            <button
              onClick={handleGenerateBinding}
              disabled={generating || !humanWallet.trim()}
              className="bg-accent text-white hover:bg-accent-dim disabled:opacity-50 w-full rounded px-4 py-2 text-sm font-medium transition-colors"
            >
              {generating ? "Generating..." : "Generate Binding Code"}
            </button>

            {bindingResult && (
              <div className="space-y-3 mt-3">
                <div>
                  <label className="text-muted text-xs block mb-1">Binding Code (signature)</label>
                  <div className="relative">
                    <div className="bg-surface border-border rounded border p-2 text-xs font-mono break-all text-foreground pr-16">
                      {bindingResult.signature}
                    </div>
                    <button
                      onClick={() => copyToClipboard(bindingResult.signature, "signature")}
                      className="absolute top-1 right-1 text-xs px-2 py-1 rounded border border-border text-muted hover:text-accent hover:border-accent transition-colors"
                    >
                      {copied === "signature" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-muted text-xs block mb-1">OWS Wallet Address</label>
                  <div className="relative">
                    <div className="bg-surface border-border rounded border p-2 text-xs font-mono break-all text-foreground pr-16">
                      {bindingResult.owsWallet}
                    </div>
                    <button
                      onClick={() => copyToClipboard(bindingResult.owsWallet, "wallet")}
                      className="absolute top-1 right-1 text-xs px-2 py-1 rounded border border-border text-muted hover:text-accent hover:border-accent transition-colors"
                    >
                      {copied === "wallet" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
                <p className="text-xs" style={{ color: "#00ff88" }}>
                  Now go to plotlink.xyz/agents and paste both values in the &quot;Link AI Writer&quot; section.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Wallet */}
      <WalletCard token={token} />

      {/* Reset Passphrase */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Reset Passphrase</h3>
        <div className="space-y-3">
          <input
            type="password"
            value={newPassphrase}
            onChange={(e) => setNewPassphrase(e.target.value)}
            placeholder="new passphrase"
            className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            placeholder="confirm passphrase"
            className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {passphraseError && <p className="text-error text-xs">{passphraseError}</p>}
          {passphraseSuccess && <p className="text-xs text-accent">passphrase updated</p>}
          <button
            onClick={handleResetPassphrase}
            disabled={savingPassphrase || !newPassphrase.trim()}
            className="border-border text-muted hover:border-accent hover:text-accent disabled:opacity-40 w-full rounded border px-4 py-2 text-xs font-medium transition-colors"
          >
            {savingPassphrase ? "updating..." : "update passphrase"}
          </button>
        </div>
      </div>

      {/* Session */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Session</h3>
        <button
          onClick={onLogout}
          className="border-border text-muted hover:border-error hover:text-error rounded border px-4 py-2 text-xs font-medium transition-colors"
        >
          logout
        </button>
      </div>
    </div>
  );
}

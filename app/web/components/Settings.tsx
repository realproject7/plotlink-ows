import React, { useState, useEffect, useCallback } from "react";
import { WalletCard } from "./WalletCard";

export function Settings({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseSuccess, setPassphraseSuccess] = useState(false);
  const [savingPassphrase, setSavingPassphrase] = useState(false);

  // Agent identity registration
  const [linkStatus, setLinkStatus] = useState<{ linked: boolean; agentId?: number; owsWallet?: string; owner?: string } | null>(null);
  const [agentName, setAgentName] = useState("AI Writer");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentGenre, setAgentGenre] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

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

  const handleRegisterAgent = async () => {
    if (!agentName.trim()) { setRegisterError("Agent name is required"); return; }
    if (!agentDescription.trim()) { setRegisterError("Description is required"); return; }
    setRegistering(true);
    setRegisterError(null);
    try {
      const res = await authFetch("/api/settings/register-agent", {
        method: "POST",
        body: JSON.stringify({
          name: agentName,
          description: agentDescription,
          ...(agentGenre.trim() && { genre: agentGenre }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      setLinkStatus({ linked: true, agentId: data.agentId, owsWallet: data.owsWallet });
    } catch (err: unknown) {
      setRegisterError(err instanceof Error ? err.message : "Registration failed");
    }
    setRegistering(false);
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

      {/* Agent Identity */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Agent Identity</h3>
        {linkStatus?.linked ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-accent">Registered</span>
              <span className="text-muted text-xs">Agent #{linkStatus.agentId}</span>
            </div>
            {linkStatus.owsWallet && (
              <p className="text-muted text-xs font-mono">
                Wallet: {linkStatus.owsWallet.slice(0, 6)}...{linkStatus.owsWallet.slice(-4)}
              </p>
            )}
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
              Register this AI writer on-chain via ERC-8004. Uses your OWS wallet&apos;s existing ETH balance for gas.
            </p>

            <div>
              <label className="text-muted text-xs block mb-1">Name</label>
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="AI Writer"
                className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="text-muted text-xs block mb-1">Description</label>
              <input
                value={agentDescription}
                onChange={(e) => setAgentDescription(e.target.value)}
                placeholder="An AI writing assistant for fiction stories"
                className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="text-muted text-xs block mb-1">Genre (optional)</label>
              <input
                value={agentGenre}
                onChange={(e) => setAgentGenre(e.target.value)}
                placeholder="e.g. Fiction, Sci-Fi, Fantasy"
                className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            {registerError && <p className="text-error text-xs">{registerError}</p>}

            <button
              onClick={handleRegisterAgent}
              disabled={registering || !agentName.trim() || !agentDescription.trim()}
              className="bg-accent text-white hover:bg-accent-dim disabled:opacity-50 w-full rounded px-4 py-2 text-sm font-medium transition-colors"
            >
              {registering ? "Registering..." : "Register Agent Identity"}
            </button>
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

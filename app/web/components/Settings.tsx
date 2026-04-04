import React, { useState, useEffect } from "react";
import { WalletCard } from "./WalletCard";

const API_BASE = "http://localhost:7777";

export function Settings({ token, onLogout, onChangeLLM }: { token: string; onLogout: () => void; onChangeLLM?: () => void }) {
  const [llmConfig, setLlmConfig] = useState<{ llm: Record<string, unknown>; configured: string[] } | null>(null);
  const [spendCap, setSpendCap] = useState<string>("10");
  const [savingCap, setSavingCap] = useState(false);
  const [capSaved, setCapSaved] = useState(false);
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseSuccess, setPassphraseSuccess] = useState(false);
  const [savingPassphrase, setSavingPassphrase] = useState(false);

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

  useEffect(() => {
    authFetch(`${API_BASE}/api/config/llm`)
      .then((r) => r.json())
      .then((data) => setLlmConfig(data));
  }, []);

  const activeProvider = (llmConfig?.llm as Record<string, unknown>)?.activeProvider as string | undefined;
  const activeModel = (llmConfig?.llm as Record<string, unknown>)?.activeModel as string | undefined;

  const handleSaveSpendCap = async () => {
    setSavingCap(true);
    setCapSaved(false);
    // Persist spending cap to agent.config.json
    await authFetch(`${API_BASE}/api/config/llm`, {
      method: "POST",
      body: JSON.stringify({ provider: activeProvider || "anthropic", model: activeModel || "", spendCap: Number(spendCap) }),
    });
    setSavingCap(false);
    setCapSaved(true);
    setTimeout(() => setCapSaved(false), 2000);
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
      const res = await authFetch(`${API_BASE}/api/auth/reset-passphrase`, {
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

      {/* LLM Config */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">LLM Provider</h3>
        {llmConfig ? (
          <div className="space-y-3">
            <div className="flex justify-between text-xs">
              <span className="text-muted">Provider</span>
              <span className="text-foreground font-medium">{activeProvider || "not configured"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Model</span>
              <span className="text-foreground font-medium">{activeModel || "—"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Configured</span>
              <span className="text-foreground font-medium">{llmConfig.configured.join(", ") || "none"}</span>
            </div>
            <button
              onClick={onChangeLLM}
              className="border-accent text-accent hover:bg-accent/10 w-full rounded border px-4 py-2 text-xs font-medium transition-colors"
            >
              change provider / model
            </button>
          </div>
        ) : (
          <p className="text-muted text-xs">loading...</p>
        )}
      </div>

      {/* Wallet */}
      <WalletCard token={token} />

      {/* Spending Cap */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Spending Cap</h3>
        <div className="flex items-center gap-2">
          <span className="text-muted text-xs">$</span>
          <input
            type="number"
            value={spendCap}
            onChange={(e) => setSpendCap(e.target.value)}
            min="0"
            step="1"
            className="bg-surface border-border text-foreground w-24 rounded border px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <span className="text-muted text-xs">USDC per session</span>
          <button
            onClick={handleSaveSpendCap}
            disabled={savingCap}
            className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 ml-auto rounded border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            {savingCap ? "saving..." : capSaved ? "saved" : "save"}
          </button>
        </div>
      </div>

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

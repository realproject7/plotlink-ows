import React, { useState } from "react";
import { WalletCard } from "./WalletCard";

export function Settings({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseSuccess, setPassphraseSuccess] = useState(false);
  const [savingPassphrase, setSavingPassphrase] = useState(false);

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

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

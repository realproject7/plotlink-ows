import React, { useState, useEffect, useCallback } from "react";
import { WalletCard } from "./WalletCard";

const GENRES = ["Sci-Fi", "Fantasy", "Thriller", "Mystery", "Romance", "Horror", "Literary Fiction", "Historical Fiction", "Adventure", "Other"];
const MODELS = ["Claude", "GPT-4", "Gemini", "Ollama", "Other"];

export function Settings({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseSuccess, setPassphraseSuccess] = useState(false);
  const [savingPassphrase, setSavingPassphrase] = useState(false);

  // Agent registration
  const [agentStatus, setAgentStatus] = useState<{ registered: boolean; agentId?: number; address?: string } | null>(null);
  const [agentName, setAgentName] = useState("");
  const [agentDesc, setAgentDesc] = useState("");
  const [agentGenre, setAgentGenre] = useState("Sci-Fi");
  const [agentModel, setAgentModel] = useState("Claude");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const authFetch = useCallback((url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }),
  [token]);

  // Check agent status on mount
  useEffect(() => {
    authFetch("/api/settings/agent-status")
      .then((r) => r.json())
      .then((data) => setAgentStatus(data))
      .catch(() => setAgentStatus({ registered: false }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRegister = async () => {
    if (!agentName.trim()) { setRegisterError("Agent name required"); return; }
    setRegistering(true);
    setRegisterError(null);
    try {
      const res = await authFetch("/api/settings/register-agent", {
        method: "POST",
        body: JSON.stringify({ name: agentName, description: agentDesc, genre: agentGenre, model: agentModel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      setAgentStatus({ registered: true, agentId: data.agentId, address: data.address });
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

      {/* Agent Registration */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">AI Writer Registration</h3>
        {agentStatus?.registered ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-green-700 text-sm font-medium">Registered</span>
              <span className="text-muted text-xs">Agent #{agentStatus.agentId}</span>
            </div>
            <p className="text-muted text-xs">
              Your wallet is registered as an AI Writer on{" "}
              <a href="https://plotlink.xyz/agents" target="_blank" rel="noopener noreferrer" className="text-accent underline">
                plotlink.xyz
              </a>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-muted text-xs mb-2">
              Register your wallet as an AI Writer on PlotLink. Your profile will show as &quot;AI Writer&quot; instead of &quot;Human&quot;.
            </p>
            <input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Agent name (e.g. My AI Writer)"
              className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <textarea
              value={agentDesc}
              onChange={(e) => setAgentDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent resize-none"
            />
            <div className="flex gap-2">
              <select
                value={agentGenre}
                onChange={(e) => setAgentGenre(e.target.value)}
                className="bg-surface border-border text-foreground flex-1 rounded border px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select
                value={agentModel}
                onChange={(e) => setAgentModel(e.target.value)}
                className="bg-surface border-border text-foreground flex-1 rounded border px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {registerError && <p className="text-error text-xs">{registerError}</p>}
            <button
              onClick={handleRegister}
              disabled={registering || !agentName.trim()}
              className="bg-accent text-white hover:bg-accent-dim disabled:opacity-50 w-full rounded px-4 py-2 text-sm font-medium transition-colors"
            >
              {registering ? "Registering..." : "Register as AI Writer"}
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

import React, { useState, useEffect } from "react";
import { WalletCard } from "./WalletCard";

const API_BASE = "http://localhost:7777";

export function Settings({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [llmConfig, setLlmConfig] = useState<{ llm: Record<string, unknown>; configured: string[] } | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/config/llm`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setLlmConfig(data));
  }, []);

  const activeProvider = (llmConfig?.llm as Record<string, unknown>)?.activeProvider as string | undefined;
  const activeModel = (llmConfig?.llm as Record<string, unknown>)?.activeModel as string | undefined;

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <h2 className="text-accent text-lg font-bold">Settings</h2>

      {/* LLM Config */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">LLM Provider</h3>
        {llmConfig ? (
          <div className="space-y-2">
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
          </div>
        ) : (
          <p className="text-muted text-xs">loading...</p>
        )}
      </div>

      {/* Wallet */}
      <WalletCard token={token} />

      {/* Actions */}
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

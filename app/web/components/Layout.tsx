import React, { useState, useEffect } from "react";
import { LLMSetup } from "./LLMSetup";
import { WalletCard } from "./WalletCard";
import { Settings } from "./Settings";
import { Chat } from "./Chat";
import { Publish } from "./Publish";
import { Dashboard } from "./Dashboard";

const API_BASE = "http://localhost:7777";

type Page = "home" | "chat" | "publish" | "dashboard" | "llm-setup" | "wallet-setup" | "settings";

function WalletSetupPage({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createWallet = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wallet/create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Wallet creation failed");
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Wallet creation failed");
    }
    setCreating(false);
  };

  useEffect(() => { createWallet(); }, []);

  return (
    <div className="mx-auto max-w-sm p-6 text-center">
      <h2 className="text-accent mb-1 text-lg font-bold">Wallet Setup</h2>
      <p className="text-muted mb-6 text-xs">creating your OWS wallet for autonomous transactions</p>

      {creating && <p className="text-accent text-sm">creating wallet...</p>}

      {error && (
        <div className="space-y-4">
          <div className="rounded border border-red-700/30 p-3 text-xs text-red-700">{error}</div>
          <button
            onClick={createWallet}
            className="border-accent text-accent hover:bg-accent/10 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
          >
            retry
          </button>
        </div>
      )}

      {success && (
        <div className="space-y-4">
          <div className="text-accent text-2xl">&#x2713;</div>
          <p className="text-foreground text-sm font-medium">wallet created</p>
          <button
            onClick={onComplete}
            className="border-accent text-accent hover:bg-accent/10 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
          >
            continue
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [page, setPage] = useState<Page>("home");
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkSetup() {
      try {
        // Check LLM config
        const llmRes = await fetch(`${API_BASE}/api/config/llm`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const llmData = await llmRes.json();
        const hasLlm = llmData.configured?.length > 0;
        setLlmConfigured(hasLlm);

        if (!hasLlm) {
          setPage("llm-setup");
          return;
        }

        // Check wallet existence
        const walletRes = await fetch(`${API_BASE}/api/wallet`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const walletData = await walletRes.json();
        if (!walletData.exists) {
          setPage("wallet-setup");
          return;
        }
      } catch {
        setLlmConfigured(false);
      }
    }
    checkSetup();
  }, []);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => { if (page !== "wallet-setup") setPage("home"); }} className="flex items-center gap-2 hover:opacity-80">
            <img src="/plotlink-logo.svg" alt="PlotLink" className="h-5 w-5" />
            <span className="text-accent text-sm font-bold tracking-tight">PlotLink OWS</span>
          </button>
          <span className="text-muted text-[10px] uppercase tracking-wider">local writer</span>
        </div>
        {page !== "wallet-setup" && (
        <nav className="flex items-center gap-4">
          <button
            onClick={() => setPage("chat")}
            className={`text-xs transition-colors ${page === "chat" ? "text-accent" : "text-muted hover:text-foreground"}`}
          >
            write
          </button>
          <button
            onClick={() => setPage("publish")}
            className={`text-xs transition-colors ${page === "publish" ? "text-accent" : "text-muted hover:text-foreground"}`}
          >
            publish
          </button>
          <button
            onClick={() => setPage("dashboard")}
            className={`text-xs transition-colors ${page === "dashboard" ? "text-accent" : "text-muted hover:text-foreground"}`}
          >
            dashboard
          </button>
          <button
            onClick={() => setPage("llm-setup")}
            className={`text-xs transition-colors ${page === "llm-setup" ? "text-accent" : "text-muted hover:text-foreground"}`}
          >
            llm
          </button>
          <button
            onClick={() => setPage("settings")}
            className={`text-xs transition-colors ${page === "settings" ? "text-accent" : "text-muted hover:text-foreground"}`}
          >
            settings
          </button>
          <button onClick={onLogout} className="text-muted hover:text-foreground text-xs transition-colors">
            logout
          </button>
        </nav>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {page === "home" && (
          <div className="mx-auto max-w-lg space-y-6 p-6">
            {llmConfigured === false && (
              <div className="border-accent/30 rounded border p-4 text-center">
                <p className="text-accent text-sm font-medium">setup required</p>
                <p className="text-muted mt-1 text-xs">connect an LLM provider to get started</p>
                <button
                  onClick={() => setPage("llm-setup")}
                  className="border-accent text-accent hover:bg-accent/10 mt-3 rounded border px-4 py-2 text-xs font-medium transition-colors"
                >
                  setup LLM
                </button>
              </div>
            )}

            {llmConfigured && (
              <>
                <div className="text-center">
                  <p className="text-foreground text-sm font-medium">ready to write</p>
                  <p className="text-muted mt-1 text-xs">start a collaborative story session with the AI writer</p>
                  <button
                    onClick={() => setPage("chat")}
                    className="border-accent text-accent hover:bg-accent/10 mt-3 rounded border px-4 py-2 text-xs font-medium transition-colors"
                  >
                    start writing
                  </button>
                </div>
                <WalletCard token={token} />
              </>
            )}
          </div>
        )}

        {page === "chat" && (
          <Chat token={token} />
        )}

        {page === "publish" && (
          <Publish token={token} />
        )}

        {page === "dashboard" && (
          <Dashboard token={token} />
        )}

        {page === "llm-setup" && (
          <LLMSetup
            token={token}
            onComplete={() => {
              setLlmConfigured(true);
              setPage("wallet-setup");
            }}
          />
        )}

        {page === "wallet-setup" && (
          <WalletSetupPage
            token={token}
            onComplete={() => setPage("home")}
          />
        )}

        {page === "settings" && (
          <Settings token={token} onLogout={onLogout} onChangeLLM={() => setPage("llm-setup")} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-border border-t px-4 py-2">
        <p className="text-muted text-[10px]">
          session active &middot; localhost:7777
        </p>
      </footer>
    </div>
  );
}

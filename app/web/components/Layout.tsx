import React, { useState, useEffect } from "react";
import { LLMSetup } from "./LLMSetup";
import { WalletCard } from "./WalletCard";
import { Settings } from "./Settings";

const API_BASE = "http://localhost:7777";

type Page = "home" | "llm-setup" | "settings";

export function Layout({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [page, setPage] = useState<Page>("home");
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [creatingWallet, setCreatingWallet] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/config/llm`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setLlmConfigured(data.configured?.length > 0);
        if (!data.configured?.length) setPage("llm-setup");
      })
      .catch(() => setLlmConfigured(false));
  }, []);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setPage("home")} className="text-accent text-sm font-bold tracking-tight hover:opacity-80">
            PlotLink OWS
          </button>
          <span className="text-muted text-[10px] uppercase tracking-wider">local writer</span>
        </div>
        <nav className="flex items-center gap-4">
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
                  <p className="text-foreground text-sm font-medium">ready</p>
                  <p className="text-muted mt-1 text-xs">chat UI &amp; story publishing coming in next phases</p>
                </div>
                {creatingWallet && (
                  <div className="rounded border border-accent/30 p-3 text-center text-xs text-accent">
                    creating OWS wallet...
                  </div>
                )}
                {walletError && (
                  <div className="rounded border border-yellow-600/30 p-3 text-xs text-yellow-600">
                    <p>wallet: {walletError}</p>
                    <button
                      onClick={() => setPage("settings")}
                      className="text-accent mt-2 underline"
                    >
                      go to settings to retry
                    </button>
                  </div>
                )}
                <WalletCard token={token} />
              </>
            )}
          </div>
        )}

        {page === "llm-setup" && (
          <LLMSetup
            token={token}
            onComplete={async () => {
              setLlmConfigured(true);
              // Auto-create wallet on first setup
              setWalletError(null);
              setCreatingWallet(true);
              setPage("home");
              try {
                const res = await fetch(`${API_BASE}/api/wallet/create`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                });
                if (!res.ok) {
                  const data = await res.json();
                  setWalletError(data.error || "Wallet creation failed — retry from settings.");
                }
              } catch {
                setWalletError("Could not connect to OWS — retry wallet creation from settings.");
              }
              setCreatingWallet(false);
            }}
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

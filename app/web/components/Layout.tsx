import React, { useState, useEffect, useCallback } from "react";
import { Settings } from "./Settings";
import { Dashboard } from "./Dashboard";
import { StoriesPage } from "./StoriesPage";
import { WalletCard } from "./WalletCard";

type Page = "home" | "stories" | "dashboard" | "wallet-setup" | "settings";

function WalletSetupPage({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createWallet = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/create", {
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { createWallet(); }, []);

  return (
    <div className="mx-auto max-w-sm p-6 text-center">
      <h2 className="text-accent mb-1 text-lg font-bold">Wallet Setup</h2>
      <p className="text-muted mb-6 text-xs">creating your OWS wallet for on-chain publishing</p>

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
  const [storyCount, setStoryCount] = useState(0);

  const authFetch = useCallback(async (url: string, opts?: RequestInit) => {
    return fetch(url, {
      ...opts,
      headers: {
        ...(opts?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }, [token]);

  useEffect(() => {
    async function checkSetup() {
      try {
        // Check wallet existence
        const walletRes = await authFetch("/api/wallet");
        const walletData = await walletRes.json();
        if (!walletData.exists) {
          setPage("wallet-setup");
          return;
        }

        // Load story count
        const storiesRes = await authFetch("/api/stories");
        if (storiesRes.ok) {
          const data = await storiesRes.json();
          setStoryCount(data.stories.filter((s: { name: string }) => s.name !== "_example").length);
        }
      } catch { /* ignore */ }
    }
    checkSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-border flex h-14 items-center justify-between border-b px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => { if (page !== "wallet-setup") setPage("home"); }} className="flex items-center gap-2 hover:opacity-80">
            <span className="text-accent text-sm font-bold tracking-tight">PlotLink OWS</span>
          </button>
          <span className="text-muted text-[10px] uppercase tracking-wider">writer</span>
        </div>
        {page !== "wallet-setup" && (
        <nav className="flex items-center gap-4">
          <button
            onClick={() => setPage("stories")}
            className={`text-xs transition-colors ${page === "stories" ? "text-accent" : "text-muted hover:text-foreground"}`}
          >
            stories
          </button>
          <button
            onClick={() => setPage("dashboard")}
            className={`text-xs transition-colors ${page === "dashboard" ? "text-accent" : "text-muted hover:text-foreground"}`}
          >
            dashboard
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
      <main className="flex-1 min-h-0">
        {page === "home" && (
          <div className="mx-auto max-w-lg space-y-6 p-8">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-serif text-foreground">Write. Publish. Earn.</h1>
              <p className="text-muted text-sm">
                Claude CLI writes stories. You publish them on-chain.
              </p>
            </div>

            <div className="text-center space-y-3">
              <button
                onClick={() => setPage("stories")}
                className="bg-accent text-white hover:bg-accent-dim px-6 py-2.5 rounded text-sm font-medium transition-colors"
              >
                Start Writing
              </button>
              {storyCount > 0 && (
                <p className="text-muted text-xs">{storyCount} {storyCount === 1 ? "story" : "stories"} in progress</p>
              )}
            </div>

            <div className="rounded border border-border p-4 space-y-2 text-xs text-muted">
              <p className="font-medium text-foreground text-sm">How it works</p>
              <ol className="space-y-1.5 list-decimal list-inside">
                <li>Open the <strong>Stories</strong> tab — Claude CLI launches in the terminal</li>
                <li>Tell Claude your story idea — it brainstorms, outlines, and writes</li>
                <li>Review the live preview as Claude creates files</li>
                <li>Click <strong>Publish</strong> to put your story on-chain</li>
                <li>Earn 5% royalties on every trade at <a href="https://plotlink.xyz" target="_blank" rel="noopener noreferrer" className="text-accent underline">plotlink.xyz</a></li>
              </ol>
            </div>

            <WalletCard token={token} />
          </div>
        )}

        {page === "stories" && (
          <StoriesPage token={token} authFetch={authFetch} />
        )}

        {page === "dashboard" && (
          <Dashboard token={token} />
        )}

        {page === "wallet-setup" && (
          <WalletSetupPage
            token={token}
            onComplete={() => setPage("home")}
          />
        )}

        {page === "settings" && (
          <Settings token={token} onLogout={onLogout} />
        )}
      </main>
    </div>
  );
}

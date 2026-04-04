import React, { useState, useEffect } from "react";

const API_BASE = "http://localhost:7777";

interface WalletInfo {
  address: string;
  ethBalance: string;
  ethFormatted: string;
  usdcBalance: string;
}

interface Story {
  id: string;
  title: string;
  genre: string | null;
  status: string;
  txHash?: string | null;
  storylineId?: number | null;
  gasCostEth?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface DashboardData {
  wallet: WalletInfo | null;
  costs: { totalGasCostEth: string; totalCostUsd: string; ethUsdPrice: number; storiesPublished: number };
  royalties: { earned: string; claimed: string; unclaimed: string; token: string };
  pnl: { totalCostsEth: string; totalCostsUsd: string; totalRoyaltiesPlot: string };
  stories: {
    published: Story[];
    drafts: Story[];
    totalPublished: number;
    totalDrafts: number;
  };
  sessions: { total: number; totalMessages: number };
}

export function Dashboard({ token }: { token: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

  const loadDashboard = () => {
    authFetch(`${API_BASE}/api/dashboard`)
      .then((r) => r.json())
      .then(setData);
  };

  useEffect(() => { loadDashboard(); }, []);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    await authFetch(`${API_BASE}/api/dashboard/drafts/${id}`, { method: "DELETE" });
    loadDashboard();
    setDeleting(null);
  };

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-muted text-sm">loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h2 className="text-accent text-lg font-bold">Writer Dashboard</h2>

      {/* Stats overview */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border-border rounded border p-3 text-center">
          <div className="text-accent text-lg font-bold">{data.stories.totalPublished}</div>
          <div className="text-muted text-[10px] uppercase tracking-wider">published</div>
        </div>
        <div className="border-border rounded border p-3 text-center">
          <div className="text-foreground text-lg font-bold">{data.stories.totalDrafts}</div>
          <div className="text-muted text-[10px] uppercase tracking-wider">drafts</div>
        </div>
        <div className="border-border rounded border p-3 text-center">
          <div className="text-foreground text-lg font-bold">{data.sessions.total}</div>
          <div className="text-muted text-[10px] uppercase tracking-wider">sessions</div>
        </div>
        <div className="border-border rounded border p-3 text-center">
          <div className="text-foreground text-lg font-bold">{data.sessions.totalMessages}</div>
          <div className="text-muted text-[10px] uppercase tracking-wider">messages</div>
        </div>
      </div>

      {/* Wallet overview */}
      {data.wallet && (
        <div className="border-border rounded border p-4">
          <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Wallet</h3>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted">Address</span>
              <code className="text-foreground font-mono text-[10px]">{truncate(data.wallet.address)}</code>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">ETH Balance</span>
              <span className="text-foreground">{data.wallet.ethFormatted} ETH</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">USDC Balance</span>
              <span className="text-foreground">${data.wallet.usdcBalance}</span>
            </div>
          </div>
        </div>
      )}

      {/* P&L */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Profit & Loss</h3>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted">Total costs (gas)</span>
            <span className="text-error">-{data.pnl.totalCostsEth} ETH (~${data.pnl.totalCostsUsd})</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Royalties earned</span>
            <span className="text-green-700">+{data.pnl.totalRoyaltiesPlot} PLOT</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Unclaimed royalties</span>
            <span className="text-foreground">{data.royalties.unclaimed} PLOT</span>
          </div>
          <div className="border-border border-t pt-1.5 text-xs font-medium">
            <div className="flex justify-between">
              <span className="text-muted">Net costs</span>
              <span className="text-foreground">
                ${data.pnl.totalCostsUsd} USD spent
                {data.costs.ethUsdPrice > 0 && <span className="text-muted ml-1">(ETH @ ${data.costs.ethUsdPrice.toFixed(0)})</span>}
              </span>
            </div>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Stories published</span>
            <span className="text-foreground">{data.costs.storiesPublished}</span>
          </div>
        </div>
      </div>

      {/* Published stories */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Published Stories</h3>
        {data.stories.published.length === 0 ? (
          <p className="text-muted text-xs">no published stories yet</p>
        ) : (
          <div className="space-y-2">
            {data.stories.published.map((story) => (
              <div key={story.id} className="bg-surface rounded p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-foreground text-sm font-medium">{story.title}</span>
                    {story.genre && <span className="text-accent ml-2 text-[10px]">{story.genre}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-green-700/30 px-1.5 py-0.5 text-[9px] text-green-700">published</span>
                    {story.storylineId ? (
                      <a
                        href={`https://plotlink.xyz/story/${story.storylineId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent text-[10px] underline"
                      >
                        view
                      </a>
                    ) : (
                      <a href="https://plotlink.xyz" target="_blank" rel="noopener noreferrer" className="text-accent text-[10px] underline">plotlink.xyz</a>
                    )}
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10px]">
                  <span className="text-muted">{formatDate(story.createdAt)}</span>
                  {story.txHash && (
                    <a href={`https://basescan.org/tx/${story.txHash}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent font-mono">
                      tx:{story.txHash.slice(0, 10)}...
                    </a>
                  )}
                  {story.gasCostEth && <span className="text-muted">{story.gasCostEth} ETH</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Draft stories */}
      <div className="border-border rounded border p-4">
        <h3 className="text-accent mb-3 text-xs font-bold uppercase tracking-wider">Drafts</h3>
        {data.stories.drafts.length === 0 ? (
          <p className="text-muted text-xs">no drafts — start writing from the chat</p>
        ) : (
          <div className="space-y-2">
            {data.stories.drafts.map((draft) => (
              <div key={draft.id} className="bg-surface flex items-center justify-between rounded p-3">
                <div>
                  <span className="text-foreground text-sm font-medium">{draft.title}</span>
                  {draft.genre && <span className="text-accent ml-2 text-[10px]">{draft.genre}</span>}
                  <div className="text-muted text-[10px]">{formatDate(draft.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="border-border rounded border px-1.5 py-0.5 text-[9px] text-muted">{draft.status}</span>
                  <button
                    onClick={() => handleDelete(draft.id)}
                    disabled={deleting === draft.id}
                    className="text-muted hover:text-error text-[10px] transition-colors"
                  >
                    {deleting === draft.id ? "..." : "delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

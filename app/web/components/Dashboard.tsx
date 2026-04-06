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
  storyName: string;
  file: string;
  plotCount: number;
  txHash?: string | null;
  storylineId?: number | null;
  gasCostEth?: string | null;
  gasCostUsd?: string | null;
  createdAt: string;
}

interface DashboardData {
  wallet: WalletInfo | null;
  costs: { totalGasCostEth: string; totalCostUsd: string; ethUsdPrice: number; storiesPublished: number };
  royalties: { earned: string; claimed: string; unclaimed: string; token: string };
  pnl: { totalCostsEth: string; totalCostsUsd: string; totalRoyaltiesPlot: string; totalRoyaltiesUsd: string; netPnlUsd: string; plotUsdPrice: string };
  stories: {
    published: Story[];
    totalPublished: number;
    totalStories: number;
    totalFiles: number;
    pendingFiles: number;
  };
}

export function Dashboard({ token }: { token: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

  const loadDashboard = () => {
    authFetch(`${API_BASE}/api/dashboard`)
      .then((r) => r.json())
      .then(setData);
  };

  useEffect(() => { loadDashboard(); }, []);

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const formatDate = (d: string | undefined | null) => {
    if (!d) return "Unknown date";
    const date = new Date(d);
    if (isNaN(date.getTime())) return "Unknown date";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

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
          <div className="text-foreground text-lg font-bold">{data.stories.pendingFiles}</div>
          <div className="text-muted text-[10px] uppercase tracking-wider">pending</div>
        </div>
        <div className="border-border rounded border p-3 text-center">
          <div className="text-foreground text-lg font-bold">{data.stories.totalStories}</div>
          <div className="text-muted text-[10px] uppercase tracking-wider">stories</div>
        </div>
        <div className="border-border rounded border p-3 text-center">
          <div className="text-foreground text-lg font-bold">{data.stories.totalFiles}</div>
          <div className="text-muted text-[10px] uppercase tracking-wider">files</div>
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
            <span className="text-accent">+{data.pnl.totalRoyaltiesPlot} PLOT</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Unclaimed royalties</span>
            <span className="text-foreground">{data.royalties.unclaimed} PLOT</span>
          </div>
          <div className="border-border flex justify-between border-t pt-1.5 text-xs font-medium">
            <span className="text-muted">Net P&L (USD)</span>
            <span className={parseFloat(data.pnl.netPnlUsd) >= 0 ? "text-accent" : "text-error"}>
              {parseFloat(data.pnl.netPnlUsd) >= 0 ? "+" : ""}${data.pnl.netPnlUsd}
            </span>
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
          <div className="space-y-3">
            {data.stories.published.map((story) => (
              <div key={story.id} className="bg-surface rounded border border-border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    {story.genre && (
                      <span className="bg-accent/10 text-accent rounded px-2 py-0.5 text-[10px] font-medium">{story.genre}</span>
                    )}
                    <h4 className="text-foreground mt-1 text-sm font-serif font-medium">{story.title}</h4>
                    <p className="text-muted mt-0.5 text-[10px] font-mono">{story.storyName}/{story.file}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {story.status === "published-not-indexed" ? (
                      <span className="rounded border border-amber-600/30 px-1.5 py-0.5 text-[9px] text-amber-700">not indexed</span>
                    ) : (
                      <span className="rounded border border-green-700/30 px-1.5 py-0.5 text-[9px] text-green-700">published</span>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-background p-1.5">
                    <div className="text-foreground text-sm font-medium">{story.plotCount}</div>
                    <div className="text-muted text-[9px]">Plots</div>
                  </div>
                  <div className="rounded bg-background p-1.5">
                    <div className="text-foreground text-sm font-medium font-mono">
                      {story.storylineId ? `#${story.storylineId}` : "—"}
                    </div>
                    <div className="text-muted text-[9px]">Storyline</div>
                  </div>
                  <div className="rounded bg-background p-1.5">
                    <div className="text-foreground text-sm font-medium">
                      {story.gasCostEth ? `${story.gasCostEth}` : "—"}
                    </div>
                    <div className="text-muted text-[9px]">Gas (ETH)</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-muted">{formatDate(story.createdAt)}</span>
                  <div className="flex items-center gap-2">
                    {story.txHash && (
                      <a href={`https://basescan.org/tx/${story.txHash}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent font-mono">
                        tx:{story.txHash.slice(0, 10)}...
                      </a>
                    )}
                    {story.storylineId && (
                      <a
                        href={`https://plotlink.xyz/story/${story.storylineId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline"
                      >
                        View on PlotLink
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending files info */}
      {data.stories.pendingFiles > 0 && (
        <div className="border-border rounded border p-4">
          <p className="text-muted text-xs">{data.stories.pendingFiles} file(s) pending publish — go to Stories to publish them.</p>
        </div>
      )}
    </div>
  );
}

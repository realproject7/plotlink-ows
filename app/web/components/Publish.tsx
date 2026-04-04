import React, { useState, useEffect } from "react";
import Markdown from "react-markdown";

const API_BASE = "http://localhost:7777";

interface Draft {
  id: string;
  title: string;
  content: string;
  genre: string | null;
  status: string;
  createdAt: string;
}

interface Preflight {
  ready: boolean;
  address?: string;
  ethBalance?: string;
  creationFee?: string;
  requiredBalance?: string;
  hasEnoughEth?: boolean;
  hasFilebase?: boolean;
  error?: string | null;
}

interface PublishProgress {
  step: string;
  message: string;
  txHash?: string;
  contentCid?: string;
  error?: string;
}

export function Publish({ token }: { token: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

  useEffect(() => {
    authFetch(`${API_BASE}/api/chat/drafts`)
      .then((r) => r.json())
      .then((data) => setDrafts(data.filter((d: Draft) => d.status !== "published")));
  }, []);

  const checkPreflight = async () => {
    const res = await authFetch(`${API_BASE}/api/publish/preflight`);
    const data = await res.json();
    setPreflight(data);
  };

  const handlePublish = async (draft: Draft) => {
    setPublishing(true);
    setProgress(null);

    try {
      const res = await fetch(`${API_BASE}/api/publish/${draft.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              setProgress(parsed);
            } catch { /* ignore */ }
          }
        }
      }

      // Refresh drafts list
      const draftsRes = await authFetch(`${API_BASE}/api/chat/drafts`);
      const draftsData = await draftsRes.json();
      setDrafts(draftsData.filter((d: Draft) => d.status !== "published"));
    } catch (err: unknown) {
      setProgress({ step: "error", message: err instanceof Error ? err.message : "Publish failed" });
    }

    setPublishing(false);
  };

  const formatEth = (wei: string) => {
    const eth = Number(BigInt(wei)) / 1e18;
    return eth.toFixed(6);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h2 className="text-accent text-lg font-bold">Publish to PlotLink</h2>
      <p className="text-muted text-xs">sign and broadcast your story on-chain via OWS wallet</p>

      {/* Preflight check */}
      {!preflight && (
        <button
          onClick={checkPreflight}
          className="border-accent text-accent hover:bg-accent/10 rounded border px-4 py-2 text-sm font-medium transition-colors"
        >
          check publishing readiness
        </button>
      )}

      {preflight && (
        <div className="border-border rounded border p-4 space-y-2">
          <h3 className="text-accent text-xs font-bold uppercase tracking-wider">Preflight</h3>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Wallet</span>
            <span className="text-foreground font-mono text-[10px]">{preflight.address?.slice(0, 10)}...</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">ETH Balance</span>
            <span className={preflight.hasEnoughEth ? "text-green-700" : "text-error"}>{preflight.ethBalance ? formatEth(preflight.ethBalance) : "0"} ETH</span>
          </div>
          {preflight.creationFee && BigInt(preflight.creationFee) > 0n && (
            <div className="flex justify-between text-xs">
              <span className="text-muted">Creation Fee</span>
              <span className="text-foreground">{formatEth(preflight.creationFee)} ETH</span>
            </div>
          )}
          {preflight.requiredBalance && (
            <div className="flex justify-between text-xs">
              <span className="text-muted">Required (fee + gas)</span>
              <span className="text-foreground">~{formatEth(preflight.requiredBalance)} ETH</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-muted">Filebase (IPFS)</span>
            <span className={preflight.hasFilebase ? "text-green-700" : "text-error"}>{preflight.hasFilebase ? "configured" : "missing"}</span>
          </div>
          {preflight.error && <p className="text-error text-xs">{preflight.error}</p>}
        </div>
      )}

      {/* Draft list */}
      {drafts.length === 0 && (
        <p className="text-muted text-xs">no drafts ready for publishing — finalize a story from the chat first</p>
      )}

      {drafts.map((draft) => (
        <div key={draft.id} className="border-border rounded border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-foreground text-sm font-medium">{draft.title}</h3>
            <span className="text-accent text-[10px]">{draft.genre}</span>
          </div>

          {selected?.id === draft.id ? (
            <div className="space-y-3">
              {/* Full preview */}
              <div className="bg-surface max-h-80 overflow-y-auto rounded p-3">
                <div className="prose prose-invert prose-xs max-w-none text-xs leading-relaxed">
                  <Markdown>{draft.content}</Markdown>
                </div>
              </div>

              {/* Publish button */}
              {preflight?.ready && !publishing && (
                <div className="space-y-2">
                  <p className="text-muted text-[10px]">
                    This will upload to IPFS and publish on-chain to Base via your OWS wallet.
                  </p>
                  <button
                    onClick={() => handlePublish(draft)}
                    className="border-accent text-accent hover:bg-accent/10 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
                  >
                    publish to PlotLink
                  </button>
                </div>
              )}

              {!preflight?.ready && (
                <p className="text-error text-xs">publishing not ready — check preflight above</p>
              )}

              <button onClick={() => setSelected(null)} className="text-muted hover:text-foreground text-xs">
                collapse
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-muted text-xs truncate max-w-[60%]">{draft.content.slice(0, 100)}...</p>
              <button
                onClick={() => { setSelected(draft); if (!preflight) checkPreflight(); }}
                className="border-border text-muted hover:border-accent hover:text-accent rounded border px-3 py-1 text-[10px] font-medium transition-colors"
              >
                preview &amp; publish
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Progress */}
      {progress && (
        <div className={`rounded border p-4 space-y-2 ${progress.step === "error" ? "border-red-700/30" : progress.step === "done" ? "border-green-700/30" : "border-accent/30"}`}>
          <div className="flex items-center gap-2">
            {progress.step !== "done" && progress.step !== "error" && (
              <span className="text-accent animate-pulse text-xs">&#x25CF;</span>
            )}
            <span className={`text-xs font-medium ${progress.step === "error" ? "text-red-700" : progress.step === "done" ? "text-green-700" : "text-accent"}`}>
              {progress.message}
            </span>
          </div>
          {progress.txHash && (
            <div className="text-xs">
              <span className="text-muted">tx: </span>
              <a href={`https://basescan.org/tx/${progress.txHash}`} target="_blank" rel="noopener noreferrer" className="text-accent font-mono text-[10px] underline">
                {progress.txHash.slice(0, 14)}...
              </a>
            </div>
          )}
          {progress.contentCid && (
            <div className="text-xs">
              <span className="text-muted">IPFS: </span>
              <span className="text-foreground font-mono text-[10px]">{progress.contentCid}</span>
            </div>
          )}
          {progress.storylineId && (
            <div className="text-xs">
              <span className="text-muted">story: </span>
              <a href={`https://plotlink.xyz/story/${progress.storylineId}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                plotlink.xyz/story/{progress.storylineId}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

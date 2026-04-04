import React, { useState, useEffect } from "react";

const API_BASE = "http://localhost:7777";

interface Provider {
  id: string;
  name: string;
  envKey: string | null;
  models: string[];
  tag: string | null;
  configured: boolean;
}

type Step = "provider" | "auth" | "model" | "test" | "done";

export function LLMSetup({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [step, setStep] = useState<Step>("provider");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>("http://localhost:11434");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

  useEffect(() => {
    authFetch(`${API_BASE}/api/config/llm/providers`)
      .then((r) => r.json())
      .then((data) => setProviders(data));
  }, []);

  const selectedProvider = providers.find((p) => p.id === selected);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await authFetch(`${API_BASE}/api/config/llm/test`, {
        method: "POST",
        body: JSON.stringify({ provider: selected, model, apiKey: apiKey || undefined, baseUrl: selected === "local" ? baseUrl : undefined }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: "Connection failed" });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/config/llm`, {
        method: "POST",
        body: JSON.stringify({ provider: selected, model, apiKey: apiKey || undefined, baseUrl: selected === "local" ? baseUrl : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  };

  return (
    <div className="mx-auto max-w-lg p-6">
      <h2 className="text-accent mb-1 text-lg font-bold">LLM Setup</h2>
      <p className="text-muted mb-6 text-xs">connect your AI provider to power the writer agent</p>

      {/* Step indicator */}
      <div className="text-muted mb-6 flex gap-2 text-[10px] uppercase tracking-wider">
        {(["provider", "auth", "model", "test", "done"] as Step[]).map((s) => (
          <span key={s} className={step === s ? "text-accent" : ""}>{s}</span>
        ))}
      </div>

      {/* Provider selection */}
      {step === "provider" && (
        <div className="space-y-3">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => { setSelected(p.id); setModel(p.models[0] || ""); setStep(p.id === "local" ? "auth" : "auth"); }}
              className={`border-border hover:border-accent w-full rounded border p-3 text-left transition-colors ${selected === p.id ? "border-accent" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-foreground text-sm font-medium">{p.name}</span>
                <span className="flex gap-1.5">
                  {p.tag && <span className="text-accent border-accent/30 rounded border px-1.5 py-0.5 text-[9px]">{p.tag}</span>}
                  {p.configured && <span className="rounded border border-green-700/30 px-1.5 py-0.5 text-[9px] text-accent">configured</span>}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Auth step */}
      {step === "auth" && selectedProvider && (
        <div className="space-y-4">
          <button onClick={() => setStep("provider")} className="text-muted hover:text-foreground text-xs">&larr; back</button>
          <h3 className="text-foreground text-sm font-medium">{selectedProvider.name}</h3>

          {selected === "local" ? (
            <div className="space-y-3">
              <div>
                <label className="text-muted mb-1.5 block text-xs uppercase tracking-wider">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="bg-surface border-border text-foreground w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-muted mb-1.5 block text-xs uppercase tracking-wider">Model Name</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="llama3.2"
                  className="bg-surface border-border text-foreground w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* OAuth option */}
              {(selected === "anthropic" || selected === "openai") && (
                <div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await authFetch(`${API_BASE}/api/oauth/${selected}/start`);
                        const data = await res.json();
                        if (data.authUrl) {
                          window.open(data.authUrl, "oauth", "width=600,height=700");
                          // Poll for completion
                          const poll = setInterval(async () => {
                            const status = await authFetch(`${API_BASE}/api/oauth/${selected}/status`).then((r) => r.json());
                            if (status.complete) {
                              clearInterval(poll);
                              setStep("model");
                            }
                          }, 1500);
                          setTimeout(() => clearInterval(poll), 120000);
                        }
                      } catch { /* ignore */ }
                    }}
                    className="border-accent text-accent hover:bg-accent/10 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
                  >
                    connect with OAuth (recommended)
                  </button>
                  <div className="text-muted my-3 flex items-center gap-2 text-[10px]">
                    <div className="border-border flex-1 border-t" />
                    <span>or use API key</span>
                    <div className="border-border flex-1 border-t" />
                  </div>
                </div>
              )}

              {/* API key input */}
              <div>
                <label className="text-muted mb-1.5 block text-xs uppercase tracking-wider">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`paste your ${selectedProvider.name} API key`}
                  className="bg-surface border-border text-foreground w-full rounded border px-3 py-2 text-sm outline-none focus:border-accent"
                />
                {selectedProvider.configured && (
                  <p className="text-muted mt-1.5 text-[10px]">key already saved — leave blank to keep current</p>
                )}
              </div>
            </div>
          )}

          <button
            onClick={() => setStep("model")}
            disabled={selected === "local" ? !model.trim() : (!apiKey.trim() && !selectedProvider.configured)}
            className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
          >
            next
          </button>
        </div>
      )}

      {/* Model selection */}
      {step === "model" && selectedProvider && (
        <div className="space-y-4">
          <button onClick={() => setStep("auth")} className="text-muted hover:text-foreground text-xs">&larr; back</button>
          <h3 className="text-foreground text-sm font-medium">Select Model</h3>

          {selected === "local" ? (
            <p className="text-muted text-xs">Using: <span className="text-foreground font-medium">{model}</span></p>
          ) : (
            <div className="space-y-2">
              {selectedProvider.models.map((m) => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  className={`border-border w-full rounded border px-3 py-2 text-left text-sm transition-colors ${model === m ? "border-accent text-accent" : "text-foreground hover:border-accent/50"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setStep("test")}
            disabled={!model}
            className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
          >
            test connection
          </button>
        </div>
      )}

      {/* Test step */}
      {step === "test" && (
        <div className="space-y-4">
          <button onClick={() => setStep("model")} className="text-muted hover:text-foreground text-xs">&larr; back</button>
          <h3 className="text-foreground text-sm font-medium">Test Connection</h3>
          <p className="text-muted text-xs">{selectedProvider?.name} / {model}</p>

          {!testResult && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
            >
              {testing ? "testing..." : "run test"}
            </button>
          )}

          {testResult && (
            <div className={`rounded border p-3 text-xs ${testResult.success ? "border-accent/30 text-accent" : "border-error/30 text-error"}`}>
              {testResult.success ? "connected" : "failed"}: {testResult.message}
            </div>
          )}

          {testResult?.success && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
            >
              {saving ? "saving..." : "save & continue"}
            </button>
          )}

          {testResult && !testResult.success && (
            <button
              onClick={() => { setTestResult(null); setStep("auth"); }}
              className="text-muted hover:text-foreground w-full py-2 text-xs transition-colors"
            >
              go back and fix
            </button>
          )}

          {error && <p className="text-error text-xs">{error}</p>}
        </div>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="space-y-4 text-center">
          <div className="text-accent text-2xl">&#x2713;</div>
          <p className="text-foreground text-sm font-medium">LLM configured</p>
          <p className="text-muted text-xs">{selectedProvider?.name} / {model}</p>
          <button
            onClick={onComplete}
            className="border-accent text-accent hover:bg-accent/10 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
          >
            continue to wallet setup
          </button>
        </div>
      )}
    </div>
  );
}

import React, { useState } from "react";

export function Login({ onLogin }: { onLogin: (passphrase: string) => Promise<string | null> }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) return;
    setLoading(true);
    setError(null);
    const err = await onLogin(passphrase);
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div className="flex h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="border-border rounded border p-6">
          <div className="mb-6 text-center">
            <h1 className="text-accent text-lg font-bold tracking-tight">PlotLink OWS</h1>
            <p className="text-muted mt-1 text-xs">local writer agent</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-muted mb-1.5 block text-xs uppercase tracking-wider">
                Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="enter your passphrase"
                autoFocus
                className="bg-surface border-border text-foreground placeholder:text-muted/50 w-full rounded border px-3 py-2 text-sm font-mono outline-none focus:border-accent"
              />
            </div>

            {error && (
              <p className="text-error text-xs">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !passphrase.trim()}
              className="border-accent text-accent hover:bg-accent/10 disabled:opacity-40 w-full rounded border px-4 py-2 text-sm font-medium transition-colors"
            >
              {loading ? "authenticating..." : "unlock"}
            </button>
          </form>
        </div>

        <p className="text-muted mt-4 text-center text-[10px]">
          Set OWS_PASSPHRASE in .env to configure
        </p>
      </div>
    </div>
  );
}

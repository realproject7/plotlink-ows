import React from "react";

export function Layout({ token, onLogout }: { token: string; onLogout: () => void }) {
  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-accent text-sm font-bold tracking-tight">PlotLink OWS</h1>
          <span className="text-muted text-[10px] uppercase tracking-wider">local writer</span>
        </div>
        <button
          onClick={onLogout}
          className="text-muted hover:text-foreground text-xs transition-colors"
        >
          logout
        </button>
      </header>

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="text-center">
          <div className="text-accent mb-2 text-2xl">&#x1f4d6;</div>
          <p className="text-foreground text-sm font-medium">ready</p>
          <p className="text-muted mt-1 text-xs">
            wallet &amp; AI writer coming in next phases
          </p>
        </div>
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

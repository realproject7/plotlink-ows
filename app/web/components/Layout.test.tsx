import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Layout } from "./Layout";

// #303: the authenticated home screen copy must be provider-neutral (Claude OR
// Codex) instead of Claude-only, and explain that fiction defaults to Claude
// while cartoon uses Codex. Stub fetch so the home page stays mounted (an
// existing wallet keeps Layout on "home" rather than redirecting to setup).
function stubFetch() {
  return vi.fn((url: string | URL) => {
    const u = String(url);
    let body: unknown = {};
    if (u.includes("/api/wallet/create")) body = { ok: true };
    else if (u.includes("/api/wallet")) body = { exists: true, address: "test-wallet-address", balances: {} };
    else if (u.includes("/api/health")) body = { version: "1.2.7" };
    else if (u.includes("/api/stories")) body = { stories: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
}

describe("Layout home copy (#303)", () => {
  beforeEach(() => vi.stubGlobal("fetch", stubFetch()));
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows provider-neutral tagline and the fiction/cartoon provider note", async () => {
    render(<Layout token="t" onLogout={vi.fn()} />);

    expect(
      await screen.findByText("Claude or Codex helps create your story. You publish it on-chain."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Fiction defaults to Claude; cartoon mode uses Codex/),
    ).toBeInTheDocument();
  });

  it("no longer shows the Claude-only wording", async () => {
    render(<Layout token="t" onLogout={vi.fn()} />);
    // Wait for the home page to be present, then assert the old copy is gone.
    await screen.findByText("Write. Publish. Earn.");
    expect(
      screen.queryByText("Claude CLI writes stories. You publish them on-chain."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Claude CLI launches in the terminal/)).not.toBeInTheDocument();
  });
});

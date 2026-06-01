import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { Settings } from "./Settings";

// WalletCard does its own data fetching; stub it so the test focuses on
// Settings' own behavior (link-status + agent readiness).
vi.mock("./WalletCard", () => ({
  WalletCard: () => <div data-testid="mock-wallet-card" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Installs a fetch mock keyed by URL. /api/agent/readiness returns the provided
// readiness; /api/settings/link-status returns an unlinked status by default.
function mockFetch(readiness: unknown) {
  const fn = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/agent/readiness") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(readiness) });
    }
    if (url === "/api/settings/link-status") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ linked: false }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Settings agent provider readiness", () => {
  it("renders codex version, image generation status, and last-checked timestamp", async () => {
    const checkedAt = 1748000000000;
    mockFetch({
      claude: { installed: true },
      codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "disabled", auth: "ok" },
      checkedAt,
    });
    render(<Settings token="t" onLogout={() => {}} />);
    const section = await screen.findByTestId("provider-readiness");
    await waitFor(() => {
      expect(section).toHaveTextContent("Claude");
      expect(section).toHaveTextContent("Installed");
      expect(section).toHaveTextContent("Codex version");
      expect(section).toHaveTextContent("codex-cli 0.135.0");
      expect(section).toHaveTextContent("Image generation");
      expect(section).toHaveTextContent("disabled");
      expect(section).toHaveTextContent("Last checked");
      expect(section).toHaveTextContent(new Date(checkedAt).toLocaleString());
    });
  });

  it("shows 'Not detected' when codex is missing and claude is absent", async () => {
    mockFetch({
      claude: { installed: false },
      codex: { installed: false, version: null, imageGeneration: "unknown", auth: "unknown" },
      checkedAt: 1748000000000,
    });
    render(<Settings token="t" onLogout={() => {}} />);
    const section = await screen.findByTestId("provider-readiness");
    await waitFor(() => {
      // Both installed rows fall back to "Not detected".
      const notDetected = section.querySelectorAll(".text-muted");
      expect(section).toHaveTextContent("Not detected");
      expect(notDetected.length).toBeGreaterThan(0);
    });
  });

  it("shows image generation enabled for a ready codex", async () => {
    mockFetch({
      claude: { installed: true },
      codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "enabled", auth: "ok" },
      checkedAt: 1748000000000,
    });
    render(<Settings token="t" onLogout={() => {}} />);
    const section = await screen.findByTestId("provider-readiness");
    await waitFor(() => {
      expect(section).toHaveTextContent("Image generation");
      expect(section).toHaveTextContent("enabled");
    });
  });

  it("shows 'ok' Codex auth and no auth hint when the feature listing is readable", async () => {
    mockFetch({
      claude: { installed: true },
      codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "enabled", auth: "ok" },
      checkedAt: 1748000000000,
    });
    render(<Settings token="t" onLogout={() => {}} />);
    await screen.findByTestId("provider-readiness");
    await waitFor(() => {
      expect(screen.getByTestId("codex-auth-status")).toHaveTextContent("ok");
    });
    expect(screen.queryByTestId("codex-auth-unknown-settings")).not.toBeInTheDocument();
  });

  it("shows 'unclear' Codex auth AND a distinct login hint when installed but auth is unclear (#263)", async () => {
    mockFetch({
      claude: { installed: true },
      codex: { installed: true, version: "codex-cli 0.135.0", imageGeneration: "unknown", auth: "unknown" },
      checkedAt: 1748000000000,
    });
    render(<Settings token="t" onLogout={() => {}} />);
    await screen.findByTestId("provider-readiness");
    await waitFor(() => {
      expect(screen.getByTestId("codex-auth-status")).toHaveTextContent("unclear");
      expect(screen.getByTestId("codex-auth-unknown-settings")).toBeInTheDocument();
    });
  });
});

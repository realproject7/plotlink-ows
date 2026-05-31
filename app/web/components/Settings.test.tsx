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
  it("renders provider readiness rows reflecting installed/feature", async () => {
    mockFetch({
      claude: { installed: true },
      codex: { installed: true, imageGeneration: "disabled" },
    });
    render(<Settings token="t" onLogout={() => {}} />);
    const section = await screen.findByTestId("provider-readiness");
    await waitFor(() => {
      expect(section).toHaveTextContent("Claude");
      expect(section).toHaveTextContent("Installed");
      expect(section).toHaveTextContent("Installed, image generation disabled");
    });
  });

  it("shows 'Not detected' when codex is missing and claude is absent", async () => {
    mockFetch({
      claude: { installed: false },
      codex: { installed: false, imageGeneration: "unknown" },
    });
    render(<Settings token="t" onLogout={() => {}} />);
    const section = await screen.findByTestId("provider-readiness");
    await waitFor(() => {
      // Both rows fall back to "Not detected".
      const notDetected = section.querySelectorAll(".text-muted");
      expect(section).toHaveTextContent("Not detected");
      expect(notDetected.length).toBeGreaterThan(0);
    });
  });

  it("shows 'Installed, image generation enabled' for a ready codex", async () => {
    mockFetch({
      claude: { installed: true },
      codex: { installed: true, imageGeneration: "enabled" },
    });
    render(<Settings token="t" onLogout={() => {}} />);
    const section = await screen.findByTestId("provider-readiness");
    await waitFor(() => {
      expect(section).toHaveTextContent("Installed, image generation enabled");
    });
  });
});

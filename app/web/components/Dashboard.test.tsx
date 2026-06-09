// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "./Dashboard";

const dashboardPayload = {
  wallet: {
    name: "plotlink-writer",
    address: "0x1111111111111111111111111111111111111111",
    ethBalance: "1000000000000000",
    ethFormatted: "0.001000",
    usdcBalance: "0.00",
  },
  costs: { totalGasCostEth: "0.001000", totalCostUsd: "3.00", ethUsdPrice: 3000, storiesPublished: 1 },
  royalties: { earned: "12.000000", claimed: "7.000000", unclaimed: "5.000000", token: "PLOT" },
  pnl: {
    totalCostsEth: "0.001000",
    totalCostsUsd: "3.00",
    totalRoyaltiesPlot: "12.000000",
    totalRoyaltiesUsd: "1.20",
    netPnlUsd: "-1.80",
    plotUsdPrice: "0.1000",
  },
  stories: {
    published: [],
    totalPublished: 1,
    totalStories: 1,
    totalFiles: 1,
    pendingFiles: 0,
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dashboard royalty claiming", () => {
  it("posts to the royalty claim endpoint and shows the transaction", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.endsWith("/api/dashboard/royalties/claim")) {
        expect(opts?.method).toBe("POST");
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            txHash: "0xabc",
            amount: "5.000000",
            basescanUrl: "https://basescan.org/tx/0xabc",
          }),
        });
      }
      if (url.endsWith("/api/dashboard")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(dashboardPayload) });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Dashboard token="token" />);

    const claim = await screen.findByRole("button", { name: "Claim royalties" });
    fireEvent.click(claim);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:7777/api/dashboard/royalties/claim",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.getByText(/Claimed 5.000000 PLOT/)).toBeInTheDocument();
    });
  });
});

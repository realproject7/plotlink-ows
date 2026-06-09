// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WalletCard } from "./WalletCard";

const walletPayload = {
  exists: true,
  walletId: "wallet-a",
  name: "plotlink-writer",
  address: "0x1111111111111111111111111111111111111111",
  activeWallet: null,
  wallets: [],
  selectionRequired: false,
  ethBalance: "0.010000",
  usdcBalance: "2.00",
  plotBalance: "10.0000",
  accounts: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WalletCard send flow", () => {
  it("requires review before sending and posts the confirmed transfer", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.endsWith("/api/wallet/send")) {
        expect(opts?.method).toBe("POST");
        expect(JSON.parse(String(opts?.body))).toMatchObject({
          token: "PLOT",
          to: "0x2222222222222222222222222222222222222222",
          amount: "1.5",
        });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            txHash: "0xsend",
            amount: "1.5",
            token: "PLOT",
            basescanUrl: "https://basescan.org/tx/0xsend",
          }),
        });
      }
      if (url.endsWith("/api/wallet")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(walletPayload) });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });

    render(<WalletCard token="token" />);

    fireEvent.click(await screen.findByRole("button", { name: "send" }));
    fireEvent.click(screen.getByRole("button", { name: "PLOT" }));
    fireEvent.change(screen.getByPlaceholderText("0x..."), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.0"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Review send" }));

    expect(screen.getByText(/Confirm sending 1.5 PLOT/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm send" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:7777/api/wallet/send",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.getByText(/Sent 1.5 PLOT/)).toBeInTheDocument();
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  wallets: [] as Array<{ id?: string; name: string; accounts: Array<{ chainId: string; address: string }> }>,
  settings: new Map<string, string>(),
}));

vi.mock("../../lib/ows/wallet", () => ({
  listAgentWallets: vi.fn(() => state.wallets),
  getBaseAddress: vi.fn((wallet: { accounts: Array<{ chainId: string; address: string }> }) =>
    wallet.accounts.find((account) => account.chainId.startsWith("eip155:"))?.address,
  ),
}));

vi.mock("../db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const value = state.settings.get(where.key);
        return value ? { key: where.key, value } : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
        state.settings.set(where.key, update.value || create.value);
        return { key: where.key, value: state.settings.get(where.key) };
      }),
    },
  },
}));

import { nextPlotlinkWalletName, resolveActiveWallet, selectActiveWallet } from "./active-wallet";

function wallet(id: string, name: string, address: string) {
  return {
    id,
    name,
    accounts: [{ chainId: "eip155:8453", address }],
  };
}

describe("active OWS wallet selection", () => {
  beforeEach(() => {
    state.wallets = [];
    state.settings.clear();
    vi.clearAllMocks();
  });

  it("auto-selects and persists the only recognized PlotLink wallet", async () => {
    state.wallets = [
      wallet("w1", "plotlink-writer", "0x1111111111111111111111111111111111111111"),
    ];

    const resolved = await resolveActiveWallet();

    expect(resolved.selectionRequired).toBe(false);
    expect(resolved.activeWallet?.name).toBe("plotlink-writer");
    expect(resolved.activeWallet?.address).toBe("0x1111111111111111111111111111111111111111");
    expect(resolved.wallets).toEqual([
      expect.objectContaining({ name: "plotlink-writer", active: true }),
    ]);
    expect([...state.settings.values()][0]).toContain("plotlink-writer");
  });

  it("requires selection when multiple recognized wallets exist and no active wallet is stored", async () => {
    state.wallets = [
      wallet("w1", "plotlink-writer", "0x1111111111111111111111111111111111111111"),
      wallet("w2", "plotlink-writer-2", "0x2222222222222222222222222222222222222222"),
    ];

    const resolved = await resolveActiveWallet();

    expect(resolved.activeWallet).toBeNull();
    expect(resolved.selectionRequired).toBe(true);
    expect(resolved.error).toMatch(/Multiple OWS wallets/);
    expect(resolved.wallets).toHaveLength(2);
    expect(resolved.wallets.every((choice) => choice.active === false)).toBe(true);
  });

  it("switches and resolves the selected wallet by id", async () => {
    state.wallets = [
      wallet("w1", "plotlink-writer", "0x1111111111111111111111111111111111111111"),
      wallet("w2", "plotlink-writer-2", "0x2222222222222222222222222222222222222222"),
    ];

    const selected = await selectActiveWallet({ walletId: "w2" });
    const resolved = await resolveActiveWallet();

    expect(selected.activeWallet?.name).toBe("plotlink-writer-2");
    expect(resolved.activeWallet?.name).toBe("plotlink-writer-2");
    expect(resolved.activeWallet?.address).toBe("0x2222222222222222222222222222222222222222");
    expect(resolved.wallets.find((choice) => choice.name === "plotlink-writer-2")?.active).toBe(true);
    expect(resolved.wallets.find((choice) => choice.name === "plotlink-writer")?.active).toBe(false);
  });

  it("generates the next PlotLink writer wallet name without reusing an existing name", () => {
    expect(nextPlotlinkWalletName([] as never)).toBe("plotlink-writer");
    expect(nextPlotlinkWalletName([
      wallet("w1", "plotlink-writer", "0x1111111111111111111111111111111111111111"),
      wallet("w2", "plotlink-writer-2", "0x2222222222222222222222222222222222222222"),
    ] as never)).toBe("plotlink-writer-3");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { Hono } from "hono";

const state = vi.hoisted(() => ({
  configDir: `${process.cwd()}/.tmp/settings-test`,
  activeAddress: "0x1111111111111111111111111111111111111111",
  activeName: "plotlink-writer",
  readContract: vi.fn(),
  signMessage: vi.fn(async () => "0xsigned"),
}));

vi.mock("../lib/paths", () => ({
  CONFIG_DIR: state.configDir,
}));

vi.mock("../lib/active-wallet", () => ({
  resolveActiveWallet: vi.fn(async () => ({
    activeWallet: {
      walletId: state.activeName === "plotlink-writer" ? "wallet-a" : "wallet-b",
      name: state.activeName,
      address: state.activeAddress,
      normalizedAddress: state.activeAddress.toLowerCase(),
      source: "ows",
      label: "PlotLink writer wallet",
      wallet: { name: state.activeName, accounts: [{ chainId: "eip155:8453", address: state.activeAddress }] },
    },
    wallets: [
      {
        walletId: "wallet-a",
        name: "plotlink-writer",
        address: "0x1111111111111111111111111111111111111111",
        normalizedAddress: "0x1111111111111111111111111111111111111111",
        source: "ows",
        label: "PlotLink writer wallet",
        recognized: true,
        active: state.activeName === "plotlink-writer",
      },
      {
        walletId: "wallet-b",
        name: "plotlink-writer-2",
        address: "0x2222222222222222222222222222222222222222",
        normalizedAddress: "0x2222222222222222222222222222222222222222",
        source: "ows",
        label: "PlotLink writer wallet",
        recognized: true,
        active: state.activeName === "plotlink-writer-2",
      },
    ],
    selectionRequired: false,
  })),
}));

vi.mock("../lib/publish", () => ({
  createOwsAccount: vi.fn(() => ({ signMessage: state.signMessage })),
}));

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({ readContract: state.readContract })),
  createWalletClient: vi.fn(() => ({ writeContract: vi.fn() })),
  http: vi.fn(),
  decodeEventLog: vi.fn(),
}));

vi.mock("viem/chains", () => ({
  base: { id: 8453 },
}));

import { settingsRoutes } from "./settings";

function makeApp() {
  const app = new Hono();
  app.route("/api/settings", settingsRoutes);
  return app;
}

function writeConfig(data: Record<string, unknown>) {
  fs.mkdirSync(state.configDir, { recursive: true });
  fs.writeFileSync(path.join(state.configDir, "config.json"), JSON.stringify(data, null, 2));
}

describe("settings active wallet agent cache", () => {
  let app: Hono;

  beforeEach(() => {
    app = makeApp();
    fs.rmSync(state.configDir, { recursive: true, force: true });
    fs.mkdirSync(state.configDir, { recursive: true });
    state.activeAddress = "0x1111111111111111111111111111111111111111";
    state.activeName = "plotlink-writer";
    state.readContract.mockReset();
    state.readContract.mockResolvedValue(0n);
    state.signMessage.mockClear();
  });

  afterEach(() => {
    fs.rmSync(state.configDir, { recursive: true, force: true });
  });

  it("does not report Wallet A cached agent metadata after switching to Wallet B", async () => {
    writeConfig({
      agentId: 101,
      agentName: "Agent A",
      agentWalletAddress: "0x1111111111111111111111111111111111111111",
      agentWalletName: "plotlink-writer",
      agentWalletId: "wallet-a",
    });
    state.activeAddress = "0x2222222222222222222222222222222222222222";
    state.activeName = "plotlink-writer-2";

    const res = await app.request("/api/settings/link-status");
    const data = await res.json();

    expect(data).toMatchObject({
      linked: false,
      owsWallet: "0x2222222222222222222222222222222222222222",
    });
    expect(data.agentId).toBeUndefined();
    expect(state.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "agentIdByWallet",
      args: ["0x2222222222222222222222222222222222222222"],
    }));
  });

  it("omits stale Wallet A agent metadata from Wallet B binding responses", async () => {
    writeConfig({
      agentId: 101,
      agentName: "Agent A",
      agentDescription: "Wallet A only",
      agentWalletAddress: "0x1111111111111111111111111111111111111111",
      agentWalletName: "plotlink-writer",
      agentWalletId: "wallet-a",
    });
    state.activeAddress = "0x2222222222222222222222222222222222222222";
    state.activeName = "plotlink-writer-2";

    const res = await app.request("/api/settings/generate-binding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanWallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.owsWallet).toBe("0x2222222222222222222222222222222222222222");
    expect(data.agentId).toBeUndefined();
    expect(data.agentName).toBeUndefined();
    expect(data.agentDescription).toBeUndefined();
    expect(data.message).toContain("0x2222222222222222222222222222222222222222");
  });
});

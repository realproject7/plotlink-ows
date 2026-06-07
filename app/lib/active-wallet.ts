import type { WalletInfo } from "../../lib/ows/types";
import { getBaseAddress, listAgentWallets } from "../../lib/ows/wallet";
import { db } from "../db";

const ACTIVE_WALLET_SETTING_KEY = "activeOwsWallet.v1";
const PLOTLINK_WALLET_PREFIX = "plotlink-writer";

export interface StoredWalletSelection {
  walletId?: string;
  name?: string;
  address?: string;
  source: "ows";
  label?: string;
}

export interface WalletChoice {
  walletId?: string;
  name: string;
  address?: string;
  normalizedAddress?: string;
  source: "ows";
  label: string;
  recognized: boolean;
  active: boolean;
}

export interface ActiveWallet {
  wallet: WalletInfo;
  walletId?: string;
  name: string;
  address: string;
  normalizedAddress: string;
  source: "ows";
  label: string;
}

export interface PublicActiveWallet {
  walletId?: string;
  name: string;
  address: string;
  normalizedAddress: string;
  source: "ows";
  label: string;
}

export interface ActiveWalletResolution {
  activeWallet: ActiveWallet | null;
  wallets: WalletChoice[];
  selectionRequired: boolean;
  error?: string;
}

function normalizeAddress(address: string | undefined): string | undefined {
  const trimmed = address?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function getWalletId(wallet: WalletInfo): string | undefined {
  const maybeId = (wallet as WalletInfo & { id?: unknown }).id;
  return typeof maybeId === "string" && maybeId.trim() ? maybeId : undefined;
}

function toWalletChoice(wallet: WalletInfo, activeSelection?: StoredWalletSelection): WalletChoice {
  const address = getBaseAddress(wallet);
  const normalizedAddress = normalizeAddress(address);
  const walletId = getWalletId(wallet);
  const recognized = wallet.name.startsWith(PLOTLINK_WALLET_PREFIX);
  return {
    walletId,
    name: wallet.name,
    address: normalizedAddress,
    normalizedAddress,
    source: "ows",
    label: recognized ? "PlotLink writer wallet" : "OWS wallet",
    recognized,
    active: matchesSelection(wallet, address, activeSelection),
  };
}

function matchesSelection(wallet: WalletInfo, address: string | undefined, selection: StoredWalletSelection | null | undefined): boolean {
  if (!selection) return false;
  const walletId = getWalletId(wallet);
  const normalizedAddress = normalizeAddress(address);
  const selectedAddress = normalizeAddress(selection.address);
  if (selection.walletId && walletId && selection.walletId === walletId) return true;
  if (selectedAddress && normalizedAddress && selectedAddress === normalizedAddress) return true;
  if (selection.name && selection.name === wallet.name) return true;
  return false;
}

function storedSelectionFor(wallet: WalletInfo): StoredWalletSelection {
  const address = normalizeAddress(getBaseAddress(wallet));
  return {
    walletId: getWalletId(wallet),
    name: wallet.name,
    address,
    source: "ows",
    label: wallet.name.startsWith(PLOTLINK_WALLET_PREFIX) ? "PlotLink writer wallet" : "OWS wallet",
  };
}

async function readStoredSelection(): Promise<StoredWalletSelection | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: ACTIVE_WALLET_SETTING_KEY } });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as Partial<StoredWalletSelection>;
    if (parsed.source !== "ows") return null;
    return {
      walletId: typeof parsed.walletId === "string" ? parsed.walletId : undefined,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      address: normalizeAddress(parsed.address),
      source: "ows",
      label: typeof parsed.label === "string" ? parsed.label : undefined,
    };
  } catch {
    return null;
  }
}

async function writeStoredSelection(selection: StoredWalletSelection): Promise<void> {
  try {
    await db.setting.upsert({
      where: { key: ACTIVE_WALLET_SETTING_KEY },
      create: { key: ACTIVE_WALLET_SETTING_KEY, value: JSON.stringify(selection) },
      update: { value: JSON.stringify(selection) },
    });
  } catch {
    // The app can still operate in legacy single-wallet mode if persistence is
    // temporarily unavailable; signing never depends on this write succeeding.
  }
}

function findSelectedWallet(wallets: WalletInfo[], selection: StoredWalletSelection | null): WalletInfo | null {
  if (!selection) return null;
  return wallets.find((wallet) => matchesSelection(wallet, getBaseAddress(wallet), selection)) ?? null;
}

function toActiveWallet(wallet: WalletInfo): ActiveWallet | null {
  const address = normalizeAddress(getBaseAddress(wallet));
  if (!address) return null;
  return {
    wallet,
    walletId: getWalletId(wallet),
    name: wallet.name,
    address,
    normalizedAddress: address,
    source: "ows",
    label: wallet.name.startsWith(PLOTLINK_WALLET_PREFIX) ? "PlotLink writer wallet" : "OWS wallet",
  };
}

export async function listWalletChoices(): Promise<WalletChoice[]> {
  const wallets = listAgentWallets();
  const selection = await readStoredSelection();
  return wallets.map((wallet) => toWalletChoice(wallet, selection));
}

export async function resolveActiveWallet(): Promise<ActiveWalletResolution> {
  const wallets = listAgentWallets();
  const selection = await readStoredSelection();
  const storedWallet = findSelectedWallet(wallets, selection);
  const activeFromStored = storedWallet ? toActiveWallet(storedWallet) : null;
  if (activeFromStored) {
    return {
      activeWallet: activeFromStored,
      wallets: wallets.map((wallet) => toWalletChoice(wallet, storedSelectionFor(storedWallet))),
      selectionRequired: false,
    };
  }

  const evmWallets = wallets.filter((wallet) => Boolean(getBaseAddress(wallet)));
  const recognizedWallets = evmWallets.filter((wallet) => wallet.name.startsWith(PLOTLINK_WALLET_PREFIX));
  const autoSelected = recognizedWallets.length === 1
    ? recognizedWallets[0]
    : recognizedWallets.length === 0 && evmWallets.length === 1
      ? evmWallets[0]
      : null;

  if (autoSelected) {
    const stored = storedSelectionFor(autoSelected);
    await writeStoredSelection(stored);
    return {
      activeWallet: toActiveWallet(autoSelected),
      wallets: wallets.map((wallet) => toWalletChoice(wallet, stored)),
      selectionRequired: false,
    };
  }

  const choices = wallets.map((wallet) => toWalletChoice(wallet, null));
  const hasSelectableWallets = evmWallets.length > 0;
  return {
    activeWallet: null,
    wallets: choices,
    selectionRequired: hasSelectableWallets,
    error: hasSelectableWallets
      ? "Multiple OWS wallets found. Select an active wallet before publishing or signing."
      : "No OWS wallet found",
  };
}

export async function selectActiveWallet(input: { walletId?: string; name?: string; address?: string }): Promise<ActiveWalletResolution> {
  const wallets = listAgentWallets();
  const normalizedInputAddress = normalizeAddress(input.address);
  const selected = wallets.find((wallet) => {
    const walletId = getWalletId(wallet);
    const address = normalizeAddress(getBaseAddress(wallet));
    if (input.walletId && walletId && walletId === input.walletId) return true;
    if (normalizedInputAddress && address && address === normalizedInputAddress) return true;
    if (input.name && wallet.name === input.name) return true;
    return false;
  });

  if (!selected) {
    return {
      activeWallet: null,
      wallets: wallets.map((wallet) => toWalletChoice(wallet, null)),
      selectionRequired: true,
      error: "Selected OWS wallet was not found",
    };
  }

  const activeWallet = toActiveWallet(selected);
  if (!activeWallet) {
    return {
      activeWallet: null,
      wallets: wallets.map((wallet) => toWalletChoice(wallet, null)),
      selectionRequired: true,
      error: "Selected OWS wallet has no EVM address",
    };
  }

  const stored = storedSelectionFor(selected);
  await writeStoredSelection(stored);
  return {
    activeWallet,
    wallets: wallets.map((wallet) => toWalletChoice(wallet, stored)),
    selectionRequired: false,
  };
}

export function nextPlotlinkWalletName(wallets: WalletInfo[]): string {
  const names = new Set(wallets.map((wallet) => wallet.name));
  if (!names.has(PLOTLINK_WALLET_PREFIX)) return PLOTLINK_WALLET_PREFIX;
  for (let index = 2; index < 1000; index += 1) {
    const name = `${PLOTLINK_WALLET_PREFIX}-${index}`;
    if (!names.has(name)) return name;
  }
  return `${PLOTLINK_WALLET_PREFIX}-${Date.now()}`;
}

export function toPublicActiveWallet(wallet: ActiveWallet): PublicActiveWallet {
  return {
    walletId: wallet.walletId,
    name: wallet.name,
    address: wallet.address,
    normalizedAddress: wallet.normalizedAddress,
    source: wallet.source,
    label: wallet.label,
  };
}

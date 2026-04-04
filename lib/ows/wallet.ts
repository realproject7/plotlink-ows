import {
  createWallet as sdkCreateWallet,
  getWallet as sdkGetWallet,
  listWallets as sdkListWallets,
  deleteWallet as sdkDeleteWallet,
  signMessage as sdkSignMessage,
  signTransaction as sdkSignTransaction,
  signAndSend as sdkSignAndSend,
} from "@open-wallet-standard/core";
import type { WalletInfo, SignResult, SendResult } from "./types";

const vaultPath = process.env.OWS_VAULT_PATH || undefined;

/** Create a new OWS wallet and return its info. */
export function createAgentWallet(name: string, passphrase?: string): WalletInfo {
  return sdkCreateWallet(name, passphrase, undefined, vaultPath);
}

/** Get a wallet by name or ID. */
export function getAgentWallet(nameOrId: string): WalletInfo {
  return sdkGetWallet(nameOrId, vaultPath);
}

/** List all wallets in the vault. */
export function listAgentWallets(): WalletInfo[] {
  return sdkListWallets(vaultPath);
}

/** Delete a wallet by name or ID. */
export function deleteAgentWallet(nameOrId: string): void {
  sdkDeleteWallet(nameOrId, vaultPath);
}

/** Extract the Base chain address from a wallet's accounts. */
export function getBaseAddress(wallet: WalletInfo): string | undefined {
  return wallet.accounts.find(
    (a) => a.chainId === (process.env.OWS_DEFAULT_POLICY_CHAIN || "eip155:8453"),
  )?.address;
}

/** Sign a message with a wallet. */
export function signAgentMessage(
  wallet: string,
  message: string,
  passphrase?: string,
): SignResult {
  const chain = process.env.OWS_DEFAULT_POLICY_CHAIN || "eip155:8453";
  return sdkSignMessage(wallet, chain, message, passphrase, undefined, undefined, vaultPath);
}

/** Sign a transaction with a wallet. */
export function signAgentTransaction(
  wallet: string,
  txHex: string,
  passphrase?: string,
): SignResult {
  const chain = process.env.OWS_DEFAULT_POLICY_CHAIN || "eip155:8453";
  return sdkSignTransaction(wallet, chain, txHex, passphrase, undefined, vaultPath);
}

/** Sign and broadcast a transaction. */
export function signAndSendAgent(
  wallet: string,
  txHex: string,
  passphrase?: string,
  rpcUrl?: string,
): SendResult {
  const chain = process.env.OWS_DEFAULT_POLICY_CHAIN || "eip155:8453";
  return sdkSignAndSend(wallet, chain, txHex, passphrase, undefined, rpcUrl, vaultPath);
}

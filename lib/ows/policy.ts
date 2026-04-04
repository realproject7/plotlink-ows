import {
  createPolicy as sdkCreatePolicy,
  listPolicies as sdkListPolicies,
  getPolicy as sdkGetPolicy,
  deletePolicy as sdkDeletePolicy,
  createApiKey as sdkCreateApiKey,
  listApiKeys as sdkListApiKeys,
  revokeApiKey as sdkRevokeApiKey,
} from "@open-wallet-standard/core";
import type { ApiKeyResult } from "./types";

const vaultPath = process.env.OWS_VAULT_PATH || undefined;
const defaultChain = process.env.OWS_DEFAULT_POLICY_CHAIN || "eip155:8453";
const defaultSpendCap = process.env.OWS_DEFAULT_POLICY_SPEND_CAP || "10";

/** Create a spending policy for an agent wallet. */
export function createSpendingPolicy(opts: {
  name: string;
  maxSpend?: string;
  chain?: string;
  tokenAddress?: string;
  expiresAt?: string;
}): void {
  const policy = {
    name: opts.name,
    chain: opts.chain || defaultChain,
    max_spend: opts.maxSpend || defaultSpendCap,
    ...(opts.tokenAddress && { token_address: opts.tokenAddress }),
    ...(opts.expiresAt && { expires_at: opts.expiresAt }),
  };
  sdkCreatePolicy(JSON.stringify(policy), vaultPath);
}

/** List all registered policies. */
export function listPolicies(): unknown[] {
  return sdkListPolicies(vaultPath);
}

/** Get a single policy by ID. */
export function getPolicy(id: string): unknown {
  return sdkGetPolicy(id, vaultPath);
}

/** Delete a policy by ID. */
export function deletePolicyById(id: string): void {
  sdkDeletePolicy(id, vaultPath);
}

/** Create an API key for agent access to wallets. */
export function createAgentApiKey(
  name: string,
  walletIds: string[],
  policyIds: string[],
  passphrase: string,
  expiresAt?: string,
): ApiKeyResult {
  return sdkCreateApiKey(name, walletIds, policyIds, passphrase, expiresAt, vaultPath);
}

/** List all API keys (tokens are never returned). */
export function listAgentApiKeys(): unknown[] {
  return sdkListApiKeys(vaultPath);
}

/** Revoke an API key by ID. */
export function revokeAgentApiKey(id: string): void {
  sdkRevokeApiKey(id, vaultPath);
}

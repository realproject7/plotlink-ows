import type { AccountInfo, WalletInfo, SignResult, SendResult, ApiKeyResult } from "@open-wallet-standard/core";

// Re-export SDK types
export type { AccountInfo, WalletInfo, SignResult, SendResult, ApiKeyResult };

/** Database row for agent_wallets table */
export interface AgentWallet {
  id: string;
  agent_id: string;
  wallet_id: string;
  wallet_name: string;
  address_base: string;
  api_key_id: string;
  policy_ids: string[];
  spend_cap_usdc: number;
  created_at: string;
  is_active: boolean;
}

/** Policy definition for OWS spending policies */
export interface SpendingPolicy {
  id?: string;
  name: string;
  chain: string;
  max_spend: string;
  token_address?: string;
  expires_at?: string;
}

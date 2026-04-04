import type { AccountInfo, WalletInfo, SignResult, SendResult, ApiKeyResult } from "@open-wallet-standard/core";

// Re-export SDK types
export type { AccountInfo, WalletInfo, SignResult, SendResult, ApiKeyResult };

/** Policy definition for OWS spending policies */
export interface SpendingPolicy {
  id?: string;
  name: string;
  chain: string;
  max_spend: string;
  token_address?: string;
  expires_at?: string;
}

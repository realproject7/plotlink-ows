import { createServiceRoleClient } from "../supabase";
import { signAgentTransaction, signAgentMessage } from "./wallet";
import type { SignResult } from "./types";

/**
 * Internal signing service — NOT exposed as an API route.
 * Retrieves stored wallet info and signs transactions/messages on behalf of an agent.
 */

/** Look up the active wallet for an agent by agent_id. */
async function getAgentWalletInfo(agentId: number) {
  const supabase = createServiceRoleClient();
  if (!supabase) throw new Error("Database not configured");

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("agent_id", agentId)
    .single();

  if (!user) throw new Error(`Agent ${agentId} not found`);

  const { data: wallet } = await supabase
    .from("agent_wallets")
    .select("wallet_id, wallet_name, address_base, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!wallet) throw new Error(`No active wallet for agent ${agentId}`);

  return wallet;
}

/** Sign a transaction on behalf of an agent. */
export async function signTransactionForAgent(
  agentId: number,
  txHex: string,
): Promise<SignResult> {
  const wallet = await getAgentWalletInfo(agentId);
  return signAgentTransaction(wallet.wallet_id, txHex);
}

/** Sign a message on behalf of an agent. */
export async function signMessageForAgent(
  agentId: number,
  message: string,
): Promise<SignResult> {
  const wallet = await getAgentWalletInfo(agentId);
  return signAgentMessage(wallet.wallet_id, message);
}

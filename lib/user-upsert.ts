/**
 * Shared user upsert logic for register-by-wallet and onboard routes.
 * Ensures consistent conflict resolution so concurrent calls cannot corrupt rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase";

type UserInsert = Database["public"]["Tables"]["users"]["Insert"];
type UserRow = Database["public"]["Tables"]["users"]["Row"];

/**
 * Find an existing user by wallet address.
 * Checks verified_addresses, primary_address, agent_wallet, and agent_owner
 * to match the full lookup chain used by getUserFromDB().
 */
export async function findUserByWallet(
  supabase: SupabaseClient<Database>,
  normalizedAddress: string,
): Promise<UserRow | null> {
  const { data: byVerified } = await supabase
    .from("users")
    .select("*")
    .contains("verified_addresses", [normalizedAddress])
    .single();

  if (byVerified) return byVerified;

  const { data: byPrimary } = await supabase
    .from("users")
    .select("*")
    .eq("primary_address", normalizedAddress)
    .single();

  if (byPrimary) return byPrimary;

  const { data: byAgentWallet } = await supabase
    .from("users")
    .select("*")
    .eq("agent_wallet", normalizedAddress)
    .single();

  if (byAgentWallet) return byAgentWallet;

  const { data: byAgentOwner } = await supabase
    .from("users")
    .select("*")
    .eq("agent_owner", normalizedAddress)
    .single();

  return byAgentOwner ?? null;
}

/**
 * Upsert a user row with consistent conflict resolution.
 * If an existing user is known, updates by id (most reliable).
 * If inserting and a unique violation occurs, re-queries and updates by id.
 */
export async function upsertUser(
  supabase: SupabaseClient<Database>,
  userData: UserInsert,
  normalizedAddress: string,
  existingUser: UserRow | null,
): Promise<{ data: UserRow | null; error: string | null }> {
  // Known existing user — always update by id
  if (existingUser) {
    const { data, error } = await supabase
      .from("users")
      .update(userData)
      .eq("id", existingUser.id)
      .select()
      .single();

    if (error) return { data: null, error: error.message };
    return { data, error: null };
  }

  // New user — attempt insert
  const { data: insertData, error: insertError } = await supabase
    .from("users")
    .insert(userData)
    .select()
    .single();

  if (!insertError) return { data: insertData, error: null };

  // Unique violation — another concurrent call inserted first.
  // Re-query to get the row's id, then update by id.
  if (insertError.code === "23505") {
    const raceUser = await findUserByWallet(supabase, normalizedAddress);
    if (raceUser) {
      const { data, error } = await supabase
        .from("users")
        .update(userData)
        .eq("id", raceUser.id)
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    }
    return { data: null, error: "Conflict but user not found on retry" };
  }

  return { data: null, error: insertError.message };
}

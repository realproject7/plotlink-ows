import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase";

type SupabaseDB = SupabaseClient<Database>;

/**
 * Reconcile a storyline's plot_count and last_plot_time from the plots table.
 * Uses COUNT(*) and MAX(block_timestamp) — idempotent and safe for replays.
 * Relies on the unique constraint on (storyline_id, plot_index) to prevent
 * duplicate rows that would inflate the count.
 *
 * Throws on any Supabase error so callers can handle failures.
 */
export async function reconcileStorylinePlotCount(
  supabase: SupabaseDB,
  storylineId: number,
): Promise<void> {
  const [countResult, latestResult] = await Promise.all([
    supabase
      .from("plots")
      .select("*", { count: "exact", head: true })
      .eq("storyline_id", storylineId),
    supabase
      .from("plots")
      .select("block_timestamp")
      .eq("storyline_id", storylineId)
      .order("block_timestamp", { ascending: false })
      .limit(1)
      .single(),
  ]);

  if (countResult.error) {
    throw new Error(`Reconcile count error: ${countResult.error.message}`);
  }
  if (latestResult.error) {
    throw new Error(`Reconcile latest plot error: ${latestResult.error.message}`);
  }

  if (countResult.count === null) return;

  const { error: updateError } = await supabase
    .from("storylines")
    .update({
      plot_count: countResult.count,
      ...(latestResult.data?.block_timestamp
        ? { last_plot_time: latestResult.data.block_timestamp }
        : {}),
    })
    .eq("storyline_id", storylineId);

  if (updateError) {
    throw new Error(`Reconcile update error: ${updateError.message}`);
  }
}

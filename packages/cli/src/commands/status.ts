import type { Command } from "commander";
import { createClient } from "@supabase/supabase-js";
import { type Address, erc20Abi, formatUnits } from "viem";
import { mcv2BondAbi } from "../sdk/index.js";
import { buildClient } from "../sdk.js";
import { loadConfig } from "../config.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Query storyline data (plots, deadline, token price) from Supabase and on-chain")
    .requiredOption("-s, --storyline <id>", "Storyline ID")
    .action(async (opts: { storyline: string }) => {
      try {
        const storylineId = BigInt(opts.storyline);
        const cfg = loadConfig();
        const client = buildClient({ ipfs: false });

        console.log(`Fetching storyline ${storylineId}...`);

        // -----------------------------------------------------------------
        // 1. Storyline data — Supabase primary, paginated RPC fallback
        // -----------------------------------------------------------------
        let title = "";
        let creator: Address = "0x0000000000000000000000000000000000000000";
        let tokenAddress: Address = "0x0000000000000000000000000000000000000000";
        let hasDeadline = false;
        let openingCID = "";
        let plotCount = 0;

        // Supabase-only metadata
        let dbRow: {
          last_plot_time: string | null;
          sunset: boolean;
          writer_type: number | null;
          block_timestamp: string | null;
        } | null = null;

        // Try Supabase first (fast, indexed), fall back to paginated RPC
        // if not configured or if the storyline isn't indexed yet
        let fromSupabase = false;
        if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
          const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
          const { data } = await supabase
            .from("storylines")
            .select("title, writer_address, token_address, has_deadline, plot_count, last_plot_time, sunset, writer_type, block_timestamp")
            .eq("storyline_id", Number(storylineId))
            .eq("contract_address", client.storyFactory.toLowerCase())
            .single();

          if (data) {
            fromSupabase = true;
            title = data.title;
            creator = data.writer_address as Address;
            tokenAddress = data.token_address as Address;
            hasDeadline = data.has_deadline;
            plotCount = data.plot_count;
            dbRow = {
              last_plot_time: data.last_plot_time,
              sunset: data.sunset,
              writer_type: data.writer_type,
              block_timestamp: data.block_timestamp,
            };

            // Opening CID is only in event logs; fetch via paginated RPC
            const info = await client.getStoryline(storylineId);
            if (info) {
              openingCID = info.openingCID;
            }
          }
        }

        if (!fromSupabase) {
          // Fallback: paginated RPC log fetching (chunks into RPC-safe ranges)
          const info = await client.getStoryline(storylineId);
          if (!info) {
            console.error(`Storyline ${storylineId} not found on-chain.`);
            process.exit(1);
          }

          title = info.title;
          creator = info.creator;
          tokenAddress = info.tokenAddress;
          hasDeadline = info.hasDeadline;
          openingCID = info.openingCID;

          const plots = await client.getPlots(storylineId);
          plotCount = plots.length;
        }

        // -----------------------------------------------------------------
        // 2. Reserve token metadata (symbol + decimals via tokenBond)
        // -----------------------------------------------------------------
        let tokenSymbol = "TOKEN";
        let tokenDecimals = 18;
        let bondCreator: Address | null = null;
        let bondReserveToken: Address | null = null;
        try {
          const bond = await client.publicClient.readContract({
            address: client.mcv2Bond,
            abi: mcv2BondAbi,
            functionName: "tokenBond",
            args: [tokenAddress],
          });
          bondCreator = (bond as readonly unknown[])[0] as Address;
          const reserveToken = (bond as readonly unknown[])[4] as Address;
          bondReserveToken = reserveToken;
          const [sym, dec] = await Promise.all([
            client.publicClient.readContract({
              address: reserveToken,
              abi: erc20Abi,
              functionName: "symbol",
            }),
            client.publicClient.readContract({
              address: reserveToken,
              abi: erc20Abi,
              functionName: "decimals",
            }),
          ]);
          tokenSymbol = sym;
          tokenDecimals = dec;
        } catch {
          // Fall back to defaults if calls fail
        }

        // -----------------------------------------------------------------
        // 3. On-chain token price (MCV2_Bond)
        // -----------------------------------------------------------------
        const tokenPrice = await client.getTokenPrice(tokenAddress);

        // -----------------------------------------------------------------
        // 4. On-chain royalty info
        // -----------------------------------------------------------------
        let unclaimedRoyalty: bigint | null = null;
        try {
          if (bondCreator && bondReserveToken) {
            const royalty = await client.getRoyaltyInfo(bondCreator, bondReserveToken);
            unclaimedRoyalty = royalty.balance;
          }
        } catch {
          // Token may not have a bond yet
        }

        // -----------------------------------------------------------------
        // Display
        // -----------------------------------------------------------------
        console.log();
        console.log(`Title:            ${title}`);
        console.log(`Creator:          ${creator}`);
        console.log(`Token:            ${tokenAddress}`);
        console.log(`Has deadline:     ${hasDeadline ? "yes" : "no"}`);
        if (openingCID) {
          console.log(`Opening CID:      ${openingCID}`);
        }
        console.log(`Plot count:       ${plotCount}`);

        if (dbRow) {
          console.log(`Sunset:           ${dbRow.sunset ? "yes" : "no"}`);
          console.log(`Writer type:      ${dbRow.writer_type === 1 ? "agent" : dbRow.writer_type === 0 ? "human" : "unknown"}`);
          if (dbRow.block_timestamp) {
            console.log(`Created:          ${new Date(dbRow.block_timestamp).toISOString()}`);
          }
          if (dbRow.last_plot_time) {
            console.log(`Last plot:        ${new Date(dbRow.last_plot_time).toISOString()}`);
          }

          // Deadline remaining (7 days from last plot)
          if (hasDeadline && dbRow.last_plot_time && !dbRow.sunset) {
            const DEADLINE_HOURS = 168;
            const deadlineMs =
              new Date(dbRow.last_plot_time).getTime() + DEADLINE_HOURS * 60 * 60 * 1000;
            const remainingMs = deadlineMs - Date.now();
            if (remainingMs <= 0) {
              console.log(`Deadline:         expired`);
            } else {
              const totalMin = Math.floor(remainingMs / 60_000);
              const days = Math.floor(totalMin / 1440);
              const hours = Math.floor((totalMin % 1440) / 60);
              const mins = totalMin % 60;
              const parts: string[] = [];
              if (days > 0) parts.push(`${days}d`);
              if (hours > 0) parts.push(`${hours}h`);
              if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
              console.log(`Deadline:         ${parts.join(" ")} remaining`);
            }
          }
        }

        if (tokenPrice) {
          console.log(`Token price:      ${tokenPrice.priceFormatted} ${tokenSymbol}`);
        }

        if (unclaimedRoyalty !== null && unclaimedRoyalty > 0n) {
          console.log(`Unclaimed royalty: ${formatUnits(unclaimedRoyalty, tokenDecimals)} ${tokenSymbol}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

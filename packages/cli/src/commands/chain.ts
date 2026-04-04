import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { buildClient } from "../sdk.js";

export function registerChain(program: Command): void {
  program
    .command("chain")
    .description("Chain a new plot onto an existing storyline")
    .requiredOption("-s, --storyline <id>", "Storyline ID")
    .requiredOption("-f, --file <path>", "Path to content file (plain text)")
    .option("-t, --title <title>", "Chapter title", "")
    .action(async (opts: { storyline: string; file: string; title: string }) => {
      try {
        const content = readFileSync(opts.file, "utf-8");
        const storylineId = BigInt(opts.storyline);
        const client = buildClient({ ipfs: true });

        console.log(`Chaining plot onto storyline ${storylineId}...`);
        const result = await client.chainPlot(storylineId, content, opts.title);

        console.log("Plot chained!");
        console.log(`  TX:   ${result.txHash}`);
        console.log(`  CID:  ${result.contentCid}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

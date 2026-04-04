import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { buildClient } from "../sdk.js";

export function registerCreate(program: Command): void {
  program
    .command("create")
    .description("Create a new storyline from a content file")
    .requiredOption("-t, --title <title>", "Storyline title")
    .requiredOption("-f, --file <path>", "Path to content file (plain text)")
    .requiredOption("-g, --genre <genre>", "Genre label")
    .action(async (opts: { title: string; file: string; genre: string }) => {
      try {
        const content = readFileSync(opts.file, "utf-8");
        const client = buildClient({ ipfs: true });

        console.log(`Creating storyline "${opts.title}" (7-day deadline)...`);
        const result = await client.createStoryline(
          opts.title,
          content,
          opts.genre,
          true,
        );

        console.log("Storyline created!");
        console.log(`  ID:   ${result.storylineId}`);
        console.log(`  TX:   ${result.txHash}`);
        console.log(`  CID:  ${result.contentCid}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

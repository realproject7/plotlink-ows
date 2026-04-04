import Link from "next/link";
import { STORY_FACTORY, EXPLORER_URL } from "../../lib/contracts/constants";
import { version } from "../../package.json";

const CONTRACT_URL = `${EXPLORER_URL}/address/${STORY_FACTORY}`;
const GITHUB_URL = "https://github.com/realproject7/plotlink-contracts";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-6 pb-20 lg:pb-6 mt-16">
      <div className="mx-auto max-w-5xl flex flex-col items-center gap-4 text-xs">
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-muted">
          <a
            href={CONTRACT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
            title={STORY_FACTORY}
          >
            contract: {STORY_FACTORY.slice(0, 6)}...{STORY_FACTORY.slice(-4)}
          </a>
          <Link href="/token" className="hover:text-foreground transition-colors">
            $PLOT
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            github
          </a>
        </div>
        <div className="text-muted text-xs text-center">
          v{version} &middot; Base Mainnet &middot; Made by{" "}
          <a
            href="https://farcaster.xyz/project7"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            @project7
          </a>
        </div>
      </div>
    </footer>
  );
}

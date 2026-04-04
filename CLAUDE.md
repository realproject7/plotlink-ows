# PlotLink OWS

On-chain storytelling protocol with a local-first AI writing assistant. Writers collaborate with Claude to brainstorm, outline, and write fiction stories, then publish them on [plotlink.xyz](https://plotlink.xyz) where every storyline becomes a tradable token.

## Writing Stories

See **AGENTS.md** for the full writing workflow. Quick summary:

1. Start `claude` in this directory
2. Say "let's write a story" — brainstorm genre, tone, characters
3. Claude creates files in `stories/your-story-name/`
4. Review, iterate, refine with Claude
5. Publish via the OWS app when ready

Stories follow this structure:
```
stories/{story-name}/
  structure.md    # Outline, characters, arc
  genesis.md      # Synopsis hook (~1000 chars)
  plot-01.md      # Chapter 1 (max 10K chars)
  ...
```

See `stories/_example/` for a complete reference.

## Tech Stack

- **Web App**: Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase
- **Local Writer App**: Hono + React 19 + Vite, SQLite + Prisma, OWS wallet
- **Storage**: Filebase (IPFS)
- **Chain**: Base (L2)

## Commands

```sh
# Next.js web app
npm run dev        # Start dev server
npm run build      # Production build
npm run lint       # ESLint
npm run typecheck  # TypeScript type-check

# Local writer app
npm run app:dev    # Start local writer (Hono + Vite dev)
npm run app:build  # Build frontend
npm run app:start  # Serve production build

# CLI
npx plotlink-ows init   # Guided setup
npx plotlink-ows        # Start app
```

## Versioning

Version is tracked in `package.json` and displayed in the footer. All agents must follow these rules:

| Digit | Meaning | Who can bump |
|-------|---------|-------------|
| **3rd** (patch) | Bug fixes, minor updates | T3 autonomously |
| **2nd** (minor) | Feature additions, major updates | **Operator (T1) permission required** |
| **1st** (major) | Pivot-level changes | **Operator (T1) permission required** |

When making a PR, bump the patch version in `package.json` for bug fixes. For feature work, note in the PR that a minor version bump may be needed and let T1 decide.

## Environment Variables

See [`.env.example`](.env.example) for all required environment variables.

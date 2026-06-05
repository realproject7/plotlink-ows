# Dependency map (`plotlink-ows`)

This repo holds two apps that share one `package.json`:

- **OWS** — the published `plotlink-ows` CLI: a local writer app (`bin/`, `app/`,
  `lib/ows/`, `lib/genres.ts`) run with `npx plotlink-ows`. Its web UI is built
  ahead of time into `app/web/dist` and served as static files at runtime.
- **PlotLink web app** — the public site at plotlink.xyz (`src/`, Next.js). It is
  **not** part of the published CLI tarball, but its build/dev tooling lives in
  this `package.json` until a workspace split (see below).

The audit below classifies every dependency. The goal of #469 is to keep the
**published CLI install path** (`dependencies`) to just what the CLI runtime
needs, so `npx plotlink-ows` doesn't pull the web-app/React/wallet-connect stack.

## OWS runtime — `dependencies`

Imported by the server runtime (`app/server.ts` → routes → `app/lib` / `lib/genres`)
or the CLI (`bin/`). These install with `npx plotlink-ows`:

| Package | Used for |
|---|---|
| `hono`, `@hono/node-server` | the local HTTP server |
| `tsx` | runs `app/server.ts` (TypeScript) at start |
| `prisma`, `@prisma/client` | local SQLite via Prisma (postinstall `prisma generate`) |
| `viem` | chain reads/writes + signing |
| `ws` | terminal WebSocket relay |
| `node-pty` | Claude/Codex terminal sessions |
| `@open-wallet-standard/core` | OWS wallet |
| `@supabase/supabase-js` | indexing reads |
| `dotenv` | loads `~/.plotlink-ows/.env` |

## OWS build-time — `devDependencies` (moved here in #469)

Build `app/web/dist` (the React UI), which is **prebuilt and shipped** — the CLI
runtime serves the static `dist` and never imports these. Verified: none are
imported by any server-side file (`app/routes`, `app/server.ts`, `app/lib`, `lib`,
`bin`). Moving them out of `dependencies` is what trims the published install:

`react`, `react-dom`, `react-markdown`, `rehype-sanitize`, `remark-breaks`,
`remark-gfm`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-serialize`,
`tailwindcss`, `vite` — plus the existing build tooling (`@vitejs/plugin-react`,
`@tailwindcss/vite`, `@tailwindcss/postcss`, `@tailwindcss/typography`,
`concurrently`, `typescript`, `eslint`).

## PlotLink web-app only — `devDependencies`

Used only by the `src/` Next.js site (plotlink.xyz), never by the OWS CLI:

`next`, `eslint-config-next`, `wagmi`, `@rainbow-me/rainbowkit`,
`@tanstack/react-query`, `ox`, `@farcaster/miniapp-node`,
`@farcaster/miniapp-sdk`, `@farcaster/miniapp-wagmi-connector`,
`@vercel/analytics`, `@aws-sdk/client-s3` (moved here in #471 — see below).

## Test-only — `devDependencies`

`vitest`, `@testing-library/react`, `@testing-library/jest-dom`,
`@testing-library/user-event`, `@playwright/test`, `jsdom`, plus `@types/*`.

## React / RainbowKit / Wagmi peer warning

`npm install` (the full dev tree) emits an `ERESOLVE` peer warning: the OWS UI
uses **React 19**, while the web-app wallet-connect stack pulls
`use-sync-external-store@1.2` (a `@rainbow-me/rainbowkit` / `wagmi` / `zustand`
transitive) whose peer range tops out at React 18.

This is **web-app-only** and does **not** affect the published CLI:
`npm ls --omit=dev` (the `npx plotlink-ows` install path) shows **no** such
conflict — `wagmi`/`rainbowkit` are `devDependencies` and never install with the
CLI. It only appears in a full dev checkout because the web app builds here.

**Follow-up plan:** a future workspace/package split (move `src/` + its web-only
deps into a separate workspace, e.g. `packages/web`) removes the warning from the
root install entirely. That's a larger structural change (out of #469's "smallest
safe change" scope) — tracked here rather than rushed.

## Direct Filebase/S3 isolation (#471)

`@aws-sdk/client-s3` was a runtime `dependency`, but the **OWS CLI runtime never
uploads to S3/Filebase directly** — it publishes through the PlotLink API.

Direct Filebase/S3 paths, mapped and classified:

| Path | Uses S3/Filebase | Used by | Classification |
|---|---|---|---|
| `lib/filebase.ts` (`getFilebaseClient`/`uploadToIPFS`/`uploadWithRetry`) | `@aws-sdk/client-s3` directly | imported only by `src/app/api/upload/route.ts` (the PlotLink web app's server-side upload endpoint) | **web-app only** — `lib/` is not packed (`files` ships only `lib/ows/` + `lib/genres.ts`) |
| `packages/cli/src/sdk/ipfs.ts` | `@aws-sdk/client-s3` directly | the old `plotlink-cli` (`client.ts`/`index.ts`) | **legacy CLI only** — the OWS server imports only `packages/cli/src/sdk/abi.ts` (a leaf, zero imports), never `ipfs`/`client`/`index` |
| `app/lib/publish.ts` `uploadToIPFS` / `uploadCoverImage` / `uploadPlotImage` | **no** — `fetch(${PLOTLINK_URL}/api/upload*)` | OWS runtime (cartoon + fiction publish) | **OWS runtime, PlotLink API** (signed) — the proven upload/publish flow, unchanged |

So `@aws-sdk/client-s3` is moved to `devDependencies` (web-app + legacy-CLI build),
dropping it from the published OWS install path. The OWS publish flows continue to
use the PlotLink API endpoints; `app/routes/publish.test.ts` already asserts the
published payload contains no `filebase` reference, and `findRuntimeDepLeaks`
(preflight + tests) now guards the runtime `dependencies` allowlist so neither
`@aws-sdk/client-s3` nor any other web-app/upload-only package can silently
re-enter the install path.

**Residual (documented, not yet removed):** `packages/cli/src/sdk/ipfs.ts` still
ships in the tarball (the whole `packages/` tree is packed) and `import`s
`@aws-sdk/client-s3`, which is no longer installed in a production install. This
is **safe** because the OWS runtime never loads that module (only `abi.ts`), and
a prod-only boot smoke confirms the server starts without `@aws-sdk/client-s3`.
**Follow-up plan:** trim `packages/cli` to just the ABI the OWS runtime needs (or
complete the workspace split), so the legacy upload SDK is neither shipped nor a
latent undeclared-dep — tracked rather than rushed (out of #471's "smallest safe
change" scope, and removing CLI functionality needs separate approval).

## Runtime vs build-time boundary (#470)

#469 split the *dependency lists*; #470 makes the **start path** honour that split
so an installed CLI never reaches for build-time tooling it doesn't have.

The contract:

- **Runtime deps install with the package; build tooling does not.** Build tooling
  (`vite`, `tailwindcss`, `react`, …) is `devDependencies`, so it is **absent**
  from `npm install -g plotlink-ows` / `npx plotlink-ows`.
- **The web UI is prebuilt and shipped.** `prepublishOnly` runs `app:build`, and
  `app/web/dist` is committed + packed. The runtime serves the static `dist`; it
  never builds it.
- **The start path must not build or `npm install` on a user's machine.**
  `bin/plotlink-ows.js` start logic (`bin/startup-plan.cjs`, unit-tested) only
  runs a build/install in a **source checkout** — detected by `src/`, which is
  never in the published `files` allowlist. In an installed package, missing
  `node_modules` or `app/web/dist` is treated as a **corrupted install** (clear
  error + reinstall hint), *not* a trigger to fetch the toolchain from the
  network. The deps probe uses `require.resolve` (not a `node_modules/` dir
  check) so hoisted global (`-g`) installs aren't misread as broken.
- **Prisma generation is deterministic and install-time.** The `postinstall`
  runs `prisma generate --schema app/prisma/schema.prisma` once at install; the
  schema is shipped (and preflight-required). The runtime imports the generated
  `@prisma/client` and never regenerates at start.

## Guards

`npm run preflight` (#466) verifies `lib/genres.ts`, `bin/startup-plan.cjs`, and
the other required runtime files are in the packed tarball, and a packed-tarball
install smoke test confirms `npx plotlink-ows` installs and the bin/runtime
entrypoints are present. The start-path boundary policy itself is unit-tested in
`bin/startup-plan.test.ts`. A manual prod-only boot test (`npm pack` → install
with prod deps only → run the server) confirms the CLI starts with
`dependencies` alone — no build, no extra install.

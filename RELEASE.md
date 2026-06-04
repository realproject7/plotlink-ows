# Releasing `plotlink-ows`

The package is published manually to npm by the operator (the `#472` gate). Run
the preflight first — it is read-only, never publishes, and never needs
`npm login`.

## Preflight

```sh
npm run preflight
```

`scripts/preflight.mjs` reports and checks four things, exiting non-zero on any
blocking issue:

1. **Expected toolchain** — `engines.node` (`20.x`), `engines.npm` (`10.x`) and
   `packageManager` (`npm@10.9.8`) vs. the running Node/npm. A mismatch is a
   warning: publish on Node 20.x / npm 10.x.
2. **Production audit** — an `npm audit --omit=dev` summary. High/critical
   findings are **warnings to review** — the preflight never runs
   `npm audit fix` (and never `--force`).
3. **Packed contents** — `npm pack --dry-run` with suspicious-file detection.
   **Fails** if any generated/local artifact slips into the package: bundled
   `node_modules`, `*.test.*` / `*.spec.*` files, stray `*.tgz` tarballs, build
   caches (`.next/cache`, `.turbo`, `.vite`, `.cache`), or obvious secret files
   (`.env*`, `*.pem`, `*.key`).
4. **Tarball smoke test** — packs into a temp dir, installs the tarball into a
   throwaway project (`--ignore-scripts`), and verifies the bin + runtime
   entrypoints land and the bin passes `node --check`.

## Package hygiene contract

The published tarball is governed by the **`files` allowlist** in
`package.json`. Because a `files` allowlist overrides a root `.npmignore`, the
artifact exclusions live as **negation patterns inside `files`** (e.g.
`"!**/*.test.ts"`, `"!**/node_modules/**"`). The preflight's suspicious-file
rules (`scripts/package-hygiene.mjs`, unit-tested) mirror those exclusions —
keep the two in sync. Adding a new `*.test.ts` anywhere is automatically
excluded by the glob, so no per-file maintenance is needed.

## Full pre-publish verification

Run on Node 20.x / npm 10.x:

```sh
npm install
npm audit --omit=dev
npm run typecheck
npm test
npm run app:build
npm run preflight
```

Then the operator performs the manual `npm publish` (or `npm run release:*`).

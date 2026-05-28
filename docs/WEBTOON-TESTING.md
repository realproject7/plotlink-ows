# Webtoon MVP Testing Guide

Testing guide for the webtoon feature branch. Covers local dev, prerelease testing, and rollback verification.

## Local Development

```sh
npm run app:dev    # Start local writer app
```

Test cartoon features: create a cartoon story, add cuts, upload images, export, generate markdown, publish.

## Prerelease Testing

Webtoon builds use a non-default npm dist-tag:

```sh
npx plotlink-ows@webtoon    # Run prerelease without replacing global install
```

This does NOT replace `plotlink-ows@1.0.33` if installed globally.

## Pre-Test: Capture Claude Resume Baseline

Before switching versions, record the current terminal session state:

```sh
cat ~/.plotlink-ows/data/terminal-sessions.json
```

Example (sanitized):

```json
{
  "my-story": "a1b2c3d4-e5f6-7890-abcd-000000000000",
  "other-story": "f0e1d2c3-b4a5-6789-0fed-000000000000"
}
```

Record the story names and session ID patterns (not full IDs in public issues).

## Rollback Testing

Switch back to stable:

```sh
npm i -g plotlink-ows@1.0.33
plotlink-ows
```

### Verify After Rollback

1. **Stories intact**: all story folders in `~/.plotlink-ows/stories/` still present
2. **Publish status preserved**: `.publish-status.json` files unchanged
3. **Database intact**: `~/.plotlink-ows/data/local.db` still readable
4. **Config preserved**: `~/.plotlink-ows/.env` unchanged
5. **Resume works**: session IDs in `terminal-sessions.json` still present; OWS attempts `claude --resume <sessionId>` on reconnect

### Expected Behavior

- Webtoon-only files (`.story.json`, `plot-NN.cuts.json`, `assets/`) are ignored by stable `1.0.33`
- Fiction stories work exactly as before
- Cartoon badge won't show (stable doesn't know about contentType)
- Live PTY/Claude processes do NOT survive app stop/restart (expected)
- Stored Claude session IDs remain in `terminal-sessions.json` for resume

## What to Check

### Fiction Regression

- Create fiction story: structure → genesis → plot chapters
- Preview renders markdown correctly
- Edit tab shows textarea editor
- Publish flow works (genesis creates storyline, plots chain)
- Illustration upload works for fiction plots

### Cartoon Readiness

- Create cartoon story (select "Cartoon" in New Story modal)
- Language selector sets story language
- Cut list shows in Edit tab for cartoon plots
- Upload clean images per cut
- Open lettering editor, add overlays (speech/narration/SFX)
- Export cuts (verify under 1MB)
- Upload & Generate: uploads to IPFS, generates markdown
- Preview shows vertical cut sequence
- Publish cartoon genesis with contentType: "cartoon"

## Lettering Fonts (Design Note)

Lettering fonts are loaded from Google Fonts CDN at runtime (no vendored font
files — keeps package size minimal). All fonts are OFL-1.1 licensed; metadata
lives in `app/lib/fonts.ts`.

### Deterministic Export

Before exporting a cut to canvas, the editor waits for the selected body and
display fonts to be ready using the browser FontFace API
(`document.fonts.load` + `document.fonts.check`):

- If fonts load successfully, editor preview and exported image match.
- If fonts fail to load (offline, CDN blocked), export is blocked and a
  visible error names the missing fonts. Export does NOT silently fall back to
  system fonts.
- In environments without the FontFace API, export proceeds (graceful
  degradation for non-browser contexts).

### Offline / CDN-Blocked Testing

To verify the font-failure path: block `fonts.googleapis.com` in the browser
devtools network tab, then attempt to export a lettered cut. The export should
show a "Fonts not loaded" error rather than producing a fallback-font image.

## Public Safety

Never include in test output, issues, or docs:
- Wallet addresses, private keys, mnemonics
- API keys, auth tokens, OWS passphrase
- Real story content or private file paths
- Full session IDs (use sanitized examples)

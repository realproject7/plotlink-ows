# Webtoon Phase 4 Verification Notes

Last updated: 2026-06-15

Retried: 2026-06-15, same blockers observed.

Retried again: 2026-06-15 22:16:51 KST, same blockers observed for the third consecutive Goal turn.

Resolved: 2026-06-16. The user provided the local OWS passphrase and the VPS
QuadWork connection was restored through SSH port forwarding.

```bash
ssh -L 8400:127.0.0.1:8400 quadwork
```

The `quadwork` SSH alias resolves to `quadwork@178.105.192.232`; `quadwork-mcp-operator --port 8400` then reaches the forwarded VPS backend.

## Completed local verification

- `npm test -- app/web/components/LetteringEditor.test.tsx app/web/components/preview-routing.test.tsx app/web/components/cartoon-preview-cta.test.tsx app/web/components/CutListPanel.test.tsx app/web/components/export-cut.test.ts app/lib/overlays.test.ts app/lib/lettering-status.test.ts app/lib/generate-story-instructions.test.ts app/lib/cartoon-prompt.test.ts`
  - Result: 9 files passed, 301 tests passed.
- `npm run typecheck`
  - Result: passed.
- `npm run lint`
  - Result: passed with 0 errors and 35 pre-existing warnings.
- `npm run app:build`
  - Result: passed and regenerated `app/web/dist`.

## Blocked Phase 4 checks

These checks are no longer blocked as of 2026-06-16.

Browser UX verification is blocked at the local app passphrase gate.

Observed at `http://localhost:7777/`:

- `PlotLink OWS`
- `local writer agent`
- `Passphrase`
- `enter your passphrase`
- disabled `unlock` button

Do not bypass this gate or read local secrets. Resume browser UX verification after the user unlocks the app or provides an approved test route/session.

Latest browser evidence still shows only the passphrase screen; the cartoon workspace is not reachable without user unlock.

Latest browser evidence after unlock:

- OWS unlock succeeded with the user-provided passphrase.
- `Stories` opened.
- `신의 세포` shows cartoon episodes as `epi-01 (Genesis)` and `epi-02`.
- `epi-01 (Genesis)` opens the cut review board.
- Cut review previews show drafted/edited overlay text directly on the artwork.
- Focused lettering editor opens from `Review lettering`.
- `Next cut` changes both artwork and overlay text from Cut 01 to Cut 02.
- Returning via `Cut review` preserves the Episodes cut-review board.
- Adding a `Thought` overlay opens the inspector with bubble kind, color, opacity, padding, and corner controls; the test change was cancelled instead of saved.

QuadWork delegation is also blocked because the operator MCP could not reach QuadWork on port `8400`. Do not start or manage the QuadWork server from this repo without explicit user direction.

Latest operator MCP evidence:

```text
QuadWork is not running on port 8400. Start it first.
```

Latest QuadWork evidence after SSH forwarding:

- `list_projects` returns `plotlink-ows` and other projects.
- `batch_status("plotlink-ows")` returns `active: false`; batch 48 is `7/7 complete`.
- `list_agents("plotlink-ows")` shows `head`, `dev`, `re1`, `re2` all `running`.

## Resume checklist

1. User unlocks `http://localhost:7777/` in the in-app browser or provides a permitted test session.
2. Re-run a focused browser review of the cartoon episode preview and focused lettering editor.
3. Verify semantic overlay controls for `speech`, `thought`, `narration`, `shout`, `shock`, `whisper`, `offscreen`, `sfx`, `pause`, and `caption`.
4. Verify preview and export render the same bubble styles.
5. If QuadWork is needed, confirm QuadWork is running and reachable through the operator MCP before delegating.

// Display/log-safety redaction for the story terminal (#454).
//
// The central terminal relays raw agent/PTY output. If an agent (or a command a
// writer runs) prints auth material — an Authorization/Bearer header, a session
// token, or an OWS passphrase / login command — it would otherwise be shown in
// plain text and persisted to the scrollback. This masks the obvious shapes on
// the way to the terminal so a secret isn't rendered or stored.
//
// It is best-effort DISPLAY hardening only: it never changes what the server
// sends, the wallet, PlotLink auth, or any request. It replaces only the secret
// VALUE and keeps the surrounding key/word, so the line still reads sensibly
// (e.g. `Authorization: Bearer [REDACTED]`). A token split across two streamed
// frames may slip through — this reduces accidental exposure, it is not a
// guarantee, which is why the agent guidance also tells agents not to print
// secrets into the terminal.

export const REDACTION_PLACEHOLDER = "[REDACTED]";

// Each rule keeps capture group 1 (the key/prefix) and masks the value after it.
// Value classes deliberately exclude whitespace, quotes, and `&` so a redaction
// stops at the end of the token and never eats following text or ANSI escapes.
// The value classes exclude whitespace, quotes, `&`, AND the ESC byte (\x1b) so a
// redaction stops at the end of the token and never swallows a trailing ANSI
// escape sequence (which would corrupt terminal colors/cursor state).
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // `Authorization: Bearer <token>` (HTTP header form).
  [/(authorization\s*:\s*bearer\s+)[^\s'"\x1b]+/gi, `$1${REDACTION_PLACEHOLDER}`],
  // A standalone `Bearer <token>` — min length so the word "Bearer" in prose
  // isn't masked.
  [/(\bbearer\s+)[A-Za-z0-9._-]{12,}/gi, `$1${REDACTION_PLACEHOLDER}`],
  // `token=<value>` / `?token=<value>` (e.g. the WS/login token in a URL).
  [/(\btoken=)[^\s'"&\x1b]+/gi, `$1${REDACTION_PLACEHOLDER}`],
  // The OWS passphrase env/var: `OWS_PASSPHRASE=<value>` or `OWS_PASSPHRASE: <value>`.
  [/(OWS_PASSPHRASE\s*[=:]\s*)[^\s'"\x1b]+/gi, `$1${REDACTION_PLACEHOLDER}`],
  // A `--passphrase <value>` / `--passphrase=<value>` login command fragment.
  [/(--passphrase[=\s]+)[^\s'"\x1b]+/gi, `$1${REDACTION_PLACEHOLDER}`],
  // A generic `passphrase: "<value>"` / `"passphrase":"<value>"` (quoted or not).
  [/(passphrase["']?\s*[:=]\s*["']?)[^\s'"\x1b]+/gi, `$1${REDACTION_PLACEHOLDER}`],
];

/**
 * Mask obvious auth secrets in a chunk of terminal output. Pure; returns the
 * input unchanged when nothing matches (the common case), so normal terminal
 * rendering and ANSI control sequences are untouched.
 */
export function redactTerminalSecrets(text: string): string {
  let out = text;
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}

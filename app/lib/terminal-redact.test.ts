import { describe, it, expect } from "vitest";
import { redactTerminalSecrets, REDACTION_PLACEHOLDER } from "./terminal-redact";

// NOTE: every "secret" here is an obvious placeholder, never a real token.
describe("redactTerminalSecrets (#454)", () => {
  it("masks an Authorization: Bearer header, keeping the header label", () => {
    expect(redactTerminalSecrets("Authorization: Bearer test-token-abcdef123456"))
      .toBe(`Authorization: Bearer ${REDACTION_PLACEHOLDER}`);
  });

  it("masks a standalone Bearer token but leaves the word 'Bearer' in prose", () => {
    expect(redactTerminalSecrets("bearer test-token-abcdef123456")).toBe(`bearer ${REDACTION_PLACEHOLDER}`);
    // Too short / not token-shaped → untouched ("Bearer of bad news").
    expect(redactTerminalSecrets("Bearer of bad news")).toBe("Bearer of bad news");
  });

  it("masks a token= URL/query value", () => {
    expect(redactTerminalSecrets("/ws/terminal?token=placeholder-token-value&story=x"))
      .toBe(`/ws/terminal?token=${REDACTION_PLACEHOLDER}&story=x`);
  });

  it("masks an OWS_PASSPHRASE env/var assignment", () => {
    expect(redactTerminalSecrets("OWS_PASSPHRASE=placeholder-passphrase"))
      .toBe(`OWS_PASSPHRASE=${REDACTION_PLACEHOLDER}`);
    expect(redactTerminalSecrets("OWS_PASSPHRASE: placeholder-passphrase"))
      .toBe(`OWS_PASSPHRASE: ${REDACTION_PLACEHOLDER}`);
  });

  it("masks a --passphrase login command fragment", () => {
    expect(redactTerminalSecrets("npx plotlink-ows login --passphrase placeholder-pass"))
      .toBe(`npx plotlink-ows login --passphrase ${REDACTION_PLACEHOLDER}`);
  });

  it("masks a passphrase value in a JSON login body, quoted", () => {
    expect(redactTerminalSecrets('{"passphrase":"placeholder-pass"}'))
      .toBe(`{"passphrase":"${REDACTION_PLACEHOLDER}"}`);
  });

  it("leaves ordinary output (and ANSI escapes) untouched", () => {
    expect(redactTerminalSecrets("Working on cut 03…")).toBe("Working on cut 03…");
    // The token is masked but the surrounding ANSI color codes are preserved.
    const ansi = "\x1b[32mAuthorization: Bearer test-token-abcdef123456\x1b[0m";
    expect(redactTerminalSecrets(ansi)).toBe(`\x1b[32mAuthorization: Bearer ${REDACTION_PLACEHOLDER}\x1b[0m`);
  });

  it("is idempotent (re-redacting an already-masked line is a no-op)", () => {
    const once = redactTerminalSecrets("Authorization: Bearer test-token-abcdef123456");
    expect(redactTerminalSecrets(once)).toBe(once);
  });
});

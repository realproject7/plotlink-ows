import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// #376: handlePublish must resolve TRUE only on a confirmed-successful publish
// (SSE `done` + txHash). A blocked preflight (#375) or a publish that opens then
// fails / ends before `done` must resolve FALSE, so PreviewPanel keeps the
// writer's selected cover. This drives the REAL StoriesPage.handlePublish by
// capturing the onPublish prop from a mocked PreviewPanel and invoking it with
// controlled authFetch behaviors.

const captured = vi.hoisted(() => ({ onPublish: null as null | ((...a: unknown[]) => Promise<boolean | void> | void) }));

vi.mock("./StoryBrowser", () => ({ StoryBrowser: () => <div data-testid="mock-browser" /> }));
vi.mock("./TerminalPanel", () => ({
  TerminalPanel: (props: { renameRef: { current: unknown } }) => {
    props.renameRef.current = () => Promise.resolve(true);
    return <div data-testid="mock-terminal" />;
  },
}));
vi.mock("./PreviewPanel", () => ({
  PreviewPanel: (props: { onPublish?: (...a: unknown[]) => Promise<boolean | void> | void }) => {
    captured.onPublish = props.onPublish ?? null;
    return <div data-testid="mock-preview" />;
  },
}));

import { StoriesPage } from "./StoriesPage";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  captured.onPublish = null;
});

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

/** A one-shot SSE body that emits a single event then ends. */
function sseBody(eventJson: string) {
  let sent = false;
  return {
    getReader() {
      return {
        read() {
          if (sent) return Promise.resolve({ done: true, value: undefined });
          sent = true;
          return Promise.resolve({ done: false, value: new TextEncoder().encode(`data: ${eventJson}\n`) });
        },
      };
    },
  };
}

/**
 * authFetch double answering every route handlePublish hits for a genesis
 * publish. `publishFile` decides what POST /api/publish/file returns.
 */
function makeAuthFetch(publishFile: () => unknown) {
  return vi.fn((url: string) => {
    if (url === "/api/wallet") return json({ address: "test-wallet-address", balances: {} });
    if (url === "/api/agent/readiness") return json(null); // leaves readiness null → no codex gating in render
    if (url === "/api/stories") return json([]);
    if (url.endsWith("/structure.md")) return json({ content: "# A Story" });
    if (url.endsWith("/genesis.md")) return json({ content: "# A Story\n\nHook." });
    if (url.endsWith("/preflight")) return json({ ready: true, hasEnoughEth: true });
    if (url.endsWith("/api/publish/file")) return Promise.resolve(publishFile());
    if (url.includes("/publish-status")) return json({ ok: true });
    return json({});
  });
}

async function runPublish(publishFile: () => unknown): Promise<boolean | void> {
  const authFetch = makeAuthFetch(publishFile);
  render(<StoriesPage token="t" authFetch={authFetch as never} />);
  // PreviewPanel is rendered unconditionally → onPublish is captured on mount.
  expect(captured.onPublish).toBeTruthy();
  let result: boolean | void;
  await act(async () => {
    result = await captured.onPublish!("my-story", "genesis.md", "Romance", "English", false);
  });
  return result;
}

describe("StoriesPage.handlePublish outcome signaling (#376)", () => {
  it("resolves TRUE on a confirmed-successful publish (SSE done + txHash)", async () => {
    const result = await runPublish(() => ({
      ok: true,
      status: 200,
      body: sseBody('{"step":"done","txHash":"tx-success","storylineId":1}'),
    }));
    expect(result).toBe(true);
  });

  it("resolves FALSE when the publish request fails (no stream opened)", async () => {
    const result = await runPublish(() => ({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "insufficient funds for gas" }),
    }));
    expect(result).toBe(false);
  });

  it("resolves FALSE when the stream opens but ends before `done` (failed/aborted)", async () => {
    const result = await runPublish(() => ({
      ok: true,
      status: 200,
      body: sseBody('{"step":"uploading"}'), // progresses, then ends with no done
    }));
    expect(result).toBe(false);
  });
});

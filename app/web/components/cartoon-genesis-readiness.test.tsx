import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #359 (hardened in #400): the cartoon publish panel must surface Genesis as the
// reader-facing "Story opening (Prologue)" and BLOCK publish when it isn't a real
// story opening — missing H1 title, too short, or synopsis/outline-shaped.
// Fiction genesis never shows this panel and is never blocked by it.
beforeAll(() => {
  installObjectUrlStub();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const GOOD_OPENING = [
  "# Coupon Crush at Closing Time",
  "",
  "The mall's last fluorescent light buzzes overhead as Mina slaps her final clearance sticker on a rack of forgotten umbrellas. She has nine minutes to hit her quota or lose the bonus that covers rent — and the only customer left is the smug rival cashier from the kiosk across the hall.",
  "",
  "He grins, holding up a coupon she's never seen before. Game on.",
].join("\n");

function makeFetch(opts: { genesis: string; structure?: string }) {
  return vi.fn((url: string) => {
    if (url.endsWith("/cover-asset")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ found: false }) });
    }
    if (url.endsWith("/structure.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: opts.structure ?? "" }) });
    }
    if (url.endsWith("/genesis.md")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ file: "genesis.md", status: "draft", content: opts.genesis }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

function renderGenesis(authFetch: ReturnType<typeof makeFetch>, contentType = "cartoon") {
  render(
    // genre+language seed the publish metadata so the readiness/title gates are
    // what's under test here, not the #424 "Needs metadata" gates.
    <PreviewPanel storyName="coupon-crush" fileName="genesis.md" authFetch={authFetch} onPublish={vi.fn()} publishingFile={null} walletAddress="test-wallet-address" contentType={contentType} genre="Adventure" language="English" />,
  );
}

describe("cartoon genesis prologue readiness (#359)", () => {
  it("labels Genesis as the reader-facing Story opening (Prologue) with the direct, Episode-01-bridge hint", async () => {
    renderGenesis(makeFetch({ genesis: GOOD_OPENING }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveTextContent("Story opening (Prologue)");
    const hint = screen.getByTestId("genesis-readiness-hint");
    expect(hint).toHaveTextContent(/story opening\/prologue, not a synopsis/i);
    expect(hint).toHaveTextContent(/Episode 01/);
  });

  it("a real reader-facing opening has no blockers/warnings and publish stays enabled", async () => {
    renderGenesis(makeFetch({ genesis: GOOD_OPENING }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveAttribute("data-blocked", "false");
    expect(screen.queryByTestId("genesis-readiness-blocker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("genesis-readiness-warning")).not.toBeInTheDocument();
    expect(screen.getByText("Publish to PlotLink").closest("button")).not.toBeDisabled();
  });

  it("blocks publish when Genesis has no H1 title, with an actionable message", async () => {
    // A full multi-paragraph opening missing ONLY the title, so the title blocker
    // is the sole blocker surfaced.
    const noTitle = [
      "The mall closes tonight and Mina has nine minutes to hit quota or lose the bonus that covers rent, with only her smug rival left in the building.",
      "",
      "She needs this sale more than she needs her pride, but the rival is already holding up a coupon she has never seen before.",
      "",
      "Game on — and the last night of the mall just got interesting before Episode 01.",
    ].join("\n");
    renderGenesis(makeFetch({ genesis: noTitle }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("genesis-readiness-blocker")).toHaveTextContent(/# Title/);
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("blocks publish on a very short Genesis opening", async () => {
    renderGenesis(makeFetch({ genesis: "# Coupon Crush\n\nMina has nine minutes." }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("genesis-readiness-blocker")).toHaveTextContent(/too short/i);
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("blocks publish when Genesis reads like a metadata synopsis instead of an opening scene", async () => {
    const synopsis = [
      "# Coupon Crush",
      "",
      "Genre: Romantic comedy",
      "Logline: Two rival cashiers fall for each other during a closing-time coupon war.",
      "Setting: A dying suburban mall, present day, over one frantic evening shift together.",
      "Characters: Mina (driven, broke), Theo (smug rival), the Manager (counting down).",
    ].join("\n");
    renderGenesis(makeFetch({ genesis: synopsis }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("genesis-readiness-blocker")).toHaveTextContent(/synopsis or outline/i);
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("blocks publish on a single dense block with no buildup", async () => {
    const oneBlock =
      "# Coupon Crush at Closing Time\n\n" +
      "The mall's last fluorescent light buzzes as Mina slaps a clearance sticker on a rack of umbrellas, nine minutes to hit her quota or lose the bonus that covers rent, while the smug rival cashier from the kiosk across the hall grins and holds up a coupon she has never seen before and the standoff begins right there.";
    renderGenesis(makeFetch({ genesis: oneBlock }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("genesis-readiness-blocker")).toHaveTextContent(/room to build|single dense block/i);
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("does not render for fiction genesis, and fiction publish is never blocked by it", async () => {
    // Synopsis-shaped content that WOULD block a cartoon Genesis — fiction must be
    // unaffected: no readiness panel and publish stays enabled (#400 non-goal).
    const synopsis = [
      "# Coupon Crush",
      "",
      "Genre: Romantic comedy",
      "Logline: Two rival cashiers fall for each other during a closing-time coupon war.",
      "Characters: Mina (driven, broke), Theo (smug rival), the Manager (counting down).",
    ].join("\n");
    renderGenesis(makeFetch({ genesis: synopsis }), "fiction");
    // structure.md fetch resolves; give the panel a tick and assert it's absent.
    const publishBtn = await screen.findByText("Publish to PlotLink");
    expect(screen.queryByTestId("cartoon-genesis-readiness")).not.toBeInTheDocument();
    expect(publishBtn.closest("button")).not.toBeDisabled();
  });
});

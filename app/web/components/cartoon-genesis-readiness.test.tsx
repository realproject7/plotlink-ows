import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { installObjectUrlStub } from "./asset-test-utils";

// #359: the cartoon publish panel must surface Genesis as the reader-facing
// "Story opening (Prologue)", block a missing H1 title, and warn (not block) on a
// too-short / synopsis-shaped opening. Fiction genesis never shows this.
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
    <PreviewPanel storyName="coupon-crush" fileName="genesis.md" authFetch={authFetch} onPublish={vi.fn()} publishingFile={null} walletAddress="test-wallet-address" contentType={contentType} />,
  );
}

describe("cartoon genesis prologue readiness (#359)", () => {
  it("labels Genesis as the reader-facing Story opening (Prologue) with the Episode-01 bridge hint", async () => {
    renderGenesis(makeFetch({ genesis: GOOD_OPENING }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveTextContent("Story opening (Prologue)");
    expect(screen.getByTestId("genesis-readiness-hint")).toHaveTextContent(/Episode 01/);
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
    renderGenesis(makeFetch({ genesis: "The mall closes tonight and Mina has nine minutes to hit quota or lose the bonus that covers rent, with only her smug rival left in the building." }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("genesis-readiness-blocker")).toHaveTextContent(/# Title/);
    expect(screen.getByText("Publish to PlotLink").closest("button")).toBeDisabled();
  });

  it("warns (does not block) on a very short Genesis opening", async () => {
    renderGenesis(makeFetch({ genesis: "# Coupon Crush\n\nMina has nine minutes." }));
    const panel = await screen.findByTestId("cartoon-genesis-readiness");
    expect(panel).toHaveAttribute("data-blocked", "false");
    expect(screen.getByTestId("genesis-readiness-warning")).toHaveTextContent(/short/i);
    expect(screen.getByText("Publish to PlotLink").closest("button")).not.toBeDisabled();
  });

  it("warns when Genesis reads like a metadata synopsis instead of an opening scene", async () => {
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
    expect(panel).toHaveAttribute("data-blocked", "false");
    expect(screen.getByTestId("genesis-readiness-warning")).toHaveTextContent(/synopsis or outline/i);
  });

  it("does not render for fiction genesis", async () => {
    renderGenesis(makeFetch({ genesis: "Plain fiction genesis prose without any cartoon readiness panel attached." }), "fiction");
    // structure.md fetch resolves; give the panel a tick and assert it's absent.
    await screen.findByText("Publish to PlotLink");
    expect(screen.queryByTestId("cartoon-genesis-readiness")).not.toBeInTheDocument();
  });
});

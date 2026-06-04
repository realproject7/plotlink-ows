import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CartoonPublishPreview } from "./CartoonPublishPreview";

afterEach(cleanup);

const block = (url: string, id = "cut-001") =>
  `<!-- ows:cartoon-cut ${id} start -->\n![Scene](${url})\n<!-- ows:cartoon-cut ${id} end -->`;

describe("CartoonPublishPreview", () => {
  it("shows a pre-publish summary (image count, char count) and a two-axis verdict (#421)", () => {
    const md = [block("https://ipfs/Qm1", "cut-001"), block("https://ipfs/Qm2", "cut-002")].join("\n\n");
    render(<CartoonPublishPreview content={md} stage="ready" />);

    const summary = screen.getByTestId("cartoon-publish-summary");
    expect(summary).toHaveTextContent("2 images");
    expect(summary).toHaveTextContent(`${md.length.toLocaleString()} / 10,000 chars`);
    // A ready episode: publish possible AND recommended.
    expect(screen.getByTestId("publish-possible")).toHaveTextContent("Publish possible");
    expect(screen.getByTestId("publish-recommended")).toHaveTextContent("Recommended");
    expect(screen.getByTestId("cartoon-publish-verdict")).toHaveTextContent("Ready to publish");
  });

  it("a no-image placeholder reads as Not recommended yet, never Ready to publish (#421)", () => {
    const md = "# Episode 2\n\nPlaceholder only. A future episode, not started yet.";
    render(<CartoonPublishPreview content={md} stage="not-started" />);
    expect(screen.getByTestId("publish-possible")).toHaveTextContent("Publish not possible yet");
    expect(screen.getByTestId("publish-recommended")).toHaveTextContent("Not recommended yet");
    const verdict = screen.getByTestId("cartoon-publish-verdict");
    expect(verdict).toHaveTextContent(/looks like planning\/placeholder text/i);
    expect(verdict).toHaveTextContent(/Prepare episode for publish after final images are uploaded/i);
    expect(verdict).not.toHaveTextContent("Ready to publish");
  });

  it("renders the published images (exactly the PlotLink markdown)", () => {
    render(<CartoonPublishPreview content={block("https://ipfs/QmImg")} stage="ready" />);
    const img = document.querySelector('img[src="https://ipfs/QmImg"]');
    expect(img).toBeTruthy();
  });

  it("surfaces non-image prose that will be published, and warns about it", () => {
    const md = [
      "Placeholder only. OWS should generate the publish markdown from cuts.json.",
      "",
      block("https://ipfs/Qm1"),
    ].join("\n");
    render(<CartoonPublishPreview content={md} stage="error" />);

    const warn = screen.getByTestId("cartoon-nonimage-prose");
    expect(warn).toHaveTextContent("Placeholder only");
    // With an image present + error stage, the verdict is the hard blocker.
    expect(screen.getByTestId("cartoon-publish-verdict")).toHaveTextContent("Not publishable");
    expect(screen.getByTestId("publish-possible")).toHaveTextContent("Publish not possible yet");
  });

  it("shows no non-image-prose warning for clean image-only markdown", () => {
    render(<CartoonPublishPreview content={block("https://ipfs/Qm1")} stage="ready" />);
    expect(screen.queryByTestId("cartoon-nonimage-prose")).not.toBeInTheDocument();
  });

  it("shows an empty-state hint when there is no markdown yet", () => {
    render(<CartoonPublishPreview content="" stage="planning" />);
    expect(screen.getByTestId("cartoon-publish-empty")).toBeInTheDocument();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CartoonPublishPreview } from "./CartoonPublishPreview";

afterEach(cleanup);

const block = (url: string, id = "cut-001") =>
  `<!-- ows:cartoon-cut ${id} start -->\n![Scene](${url})\n<!-- ows:cartoon-cut ${id} end -->`;

describe("CartoonPublishPreview", () => {
  it("shows a pre-publish summary (image count, char count, readiness)", () => {
    const md = [block("https://ipfs/Qm1", "cut-001"), block("https://ipfs/Qm2", "cut-002")].join("\n\n");
    render(<CartoonPublishPreview content={md} stage="ready" />);

    const summary = screen.getByTestId("cartoon-publish-summary");
    expect(summary).toHaveTextContent("2 images");
    expect(summary).toHaveTextContent(`${md.length.toLocaleString()} / 10,000 chars`);
    expect(summary).toHaveTextContent("Ready to publish");
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
    expect(screen.getByTestId("cartoon-publish-summary")).toHaveTextContent("Not publishable");
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

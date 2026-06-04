import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";

afterEach(cleanup);

function mockFictionAuthFetch(content = "# Chapter One\n\nOnce upon a time...") {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      file: "plot-01.md",
      status: "pending",
      content,
    }),
  });
}

describe("fiction PreviewPanel regression", () => {
  it("fiction plot preview renders markdown content, not CartoonPreview", async () => {
    const authFetch = mockFictionAuthFetch();
    render(
      <PreviewPanel
        storyName="fiction-story"
        fileName="plot-01.md"
        authFetch={authFetch}
        contentType="fiction"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Once upon a time...")).toBeInTheDocument();
    });

    expect(screen.queryByText("Loading cuts...")).not.toBeInTheDocument();
    expect(screen.queryByText("No cuts yet")).not.toBeInTheDocument();
  });

  it("fiction plot edit tab shows textarea, not CutListPanel", async () => {
    const authFetch = mockFictionAuthFetch("Some fiction content");
    render(
      <PreviewPanel
        storyName="fiction-story"
        fileName="plot-01.md"
        authFetch={authFetch}
        contentType="fiction"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Some fiction content")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Edit"));

    await waitFor(() => {
      const textarea = document.querySelector("textarea");
      expect(textarea).toBeInTheDocument();
      expect(textarea?.value).toContain("Some fiction content");
    });

    expect(screen.queryByText("No cuts yet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-generate-btn")).not.toBeInTheDocument();
  });

  it("fiction genesis preview renders markdown, has Pending status", async () => {
    const authFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ file: "genesis.md", status: "pending", content: "# The Hook\n\nA gripping start." }),
    });

    render(
      <PreviewPanel
        storyName="fiction-story"
        fileName="genesis.md"
        authFetch={authFetch}
        contentType="fiction"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("A gripping start.")).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });
  });

  it("fiction publish callback receives correct params without contentType", async () => {
    const onPublish = vi.fn();
    const authFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ file: "genesis.md", status: "pending", content: "Hook content here that is enough" }),
    });

    render(
      <PreviewPanel
        storyName="fiction-story"
        fileName="genesis.md"
        authFetch={authFetch}
        onPublish={onPublish}
        contentType="fiction"
        genre="Fantasy"
        language="English"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Hook content here that is enough")).toBeInTheDocument();
    });

    const publishBtn = await screen.findByText("Publish to PlotLink");
    expect(publishBtn).toBeInTheDocument();
    fireEvent.click(publishBtn);
    expect(onPublish).toHaveBeenCalledWith("fiction-story", "genesis.md", expect.any(String), expect.any(String), expect.any(Boolean));
  });
});

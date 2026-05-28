import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const testState = vi.hoisted(() => ({ storiesDir: "" }));

vi.mock("../lib/paths", () => ({
  get STORIES_DIR() { return testState.storiesDir; },
  CONFIG_DIR: os.tmpdir(),
  DATA_DIR: os.tmpdir(),
  DB_PATH: path.join(os.tmpdir(), "test.db"),
  DATABASE_URL: "file:" + path.join(os.tmpdir(), "test.db"),
  ENV_FILE: path.join(os.tmpdir(), ".env"),
}));

// Mock heavy publish/wallet deps so the route module loads in tests.
vi.mock("../lib/publish", () => ({
  publishStoryline: vi.fn(),
  publishPlot: vi.fn(),
  getEthBalance: vi.fn(),
  estimatePublishCost: vi.fn(),
  uploadCoverImage: vi.fn(),
  uploadPlotImage: vi.fn(),
  updateStoryline: vi.fn(),
}));

vi.mock("../../lib/ows/wallet", () => ({
  listAgentWallets: vi.fn().mockReturnValue([]),
  getBaseAddress: vi.fn(),
}));

import { publishRoutes } from "./publish";
import { createCutsFile, writeCutsFile } from "../lib/cuts";
import { writeStoryMeta } from "./stories";
import { Hono } from "hono";

function makeApp() {
  const app = new Hono();
  app.route("/api/publish", publishRoutes);
  return app;
}

function publishBody(overrides: Record<string, unknown> = {}) {
  return {
    storyName: "story",
    fileName: "plot-01.md",
    title: "Episode 1",
    content: "",
    contentType: "cartoon",
    ...overrides,
  };
}

describe("POST /api/publish/file cartoon readiness guard", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-guard-"));
    testState.storiesDir = tmpDir;
    app = makeApp();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function post(body: Record<string, unknown>) {
    return app.request("/api/publish/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function setupCartoonStory(): string {
    const storyDir = path.join(tmpDir, "story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeStoryMeta(storyDir, { contentType: "cartoon" });
    return storyDir;
  }

  it("blocks cartoon plot when cuts.json is missing", async () => {
    setupCartoonStory();
    const res = await post(publishBody({ content: "some content" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("cuts.json not found");
  });

  it("blocks cartoon plot with awaiting-upload placeholder", async () => {
    const storyDir = setupCartoonStory();
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("not ready");
    expect(data.issues.some((i: string) => i.includes("awaiting-upload"))).toBe(true);
  });

  it("blocks cartoon plot with local asset path image ref", async () => {
    const storyDir = setupCartoonStory();
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![Cut 1](assets/plot-01/cut-01-final.webp)\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.issues.some((i: string) => i.includes("not an http(s) URL"))).toBe(true);
  });

  it("blocks cartoon plot with missing marker blocks", async () => {
    const storyDir = setupCartoonStory();
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 2));

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![C](https://ipfs/x)\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.issues.some((i: string) => i.includes("Cut 2"))).toBe(true);
  });

  it("blocks cartoon plot when cuts.json is invalid", async () => {
    const storyDir = setupCartoonStory();
    fs.writeFileSync(path.join(storyDir, "plot-01.cuts.json"), "{ not json");

    const res = await post(publishBody({ content: "x" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Cannot publish");
  });

  it("does not apply cartoon guard to fiction plots", async () => {
    // Fiction story (.story.json contentType fiction) should pass the readiness
    // guard and reach wallet check (mocked listAgentWallets [] → "No OWS wallet").
    const storyDir = path.join(tmpDir, "story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeStoryMeta(storyDir, { contentType: "fiction" });

    const res = await post(publishBody({ contentType: "fiction", content: "Some fiction prose." }));
    const data = await res.json();
    expect(data.error).not.toContain("cuts.json");
    expect(data.error).not.toContain("not ready");
  });

  it("cannot bypass cartoon guard by omitting contentType in body", async () => {
    // Story is cartoon server-side; body omits contentType entirely.
    const storyDir = setupCartoonStory();
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";

    const body = publishBody({ content: md });
    delete (body as Record<string, unknown>).contentType;
    const res = await post(body);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("not ready");
  });

  it("blocks cartoon plot when block URL does not match recorded uploadedUrl", async () => {
    const storyDir = setupCartoonStory();
    const cf = createCutsFile("plot-01", 1);
    cf.cuts[0].uploadedUrl = "https://ipfs.filebase.io/ipfs/QmReal";
    writeCutsFile(storyDir, "plot-01", cf);

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![C](https://example.com/fake.webp)\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.issues.some((i: string) => i.includes("does not match the recorded uploaded URL"))).toBe(true);
  });

  it("blocks cartoon plot when cut has no uploadedUrl despite valid-looking markdown URL", async () => {
    const storyDir = setupCartoonStory();
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1)); // uploadedUrl null by default

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![C](https://ipfs.filebase.io/ipfs/QmAnything)\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.issues.some((i: string) => i.includes("not uploaded"))).toBe(true);
  });

  it("allows cartoon plot when block URL exactly matches recorded uploadedUrl", async () => {
    const storyDir = setupCartoonStory();
    const url = "https://ipfs.filebase.io/ipfs/QmExact";
    const cf = createCutsFile("plot-01", 1);
    cf.cuts[0].uploadedUrl = url;
    writeCutsFile(storyDir, "plot-01", cf);

    const md = `<!-- ows:cartoon-cut cut-001 start -->\n![C](${url})\n<!-- ows:cartoon-cut cut-001 end -->`;
    const res = await post(publishBody({ content: md }));
    const data = await res.json();
    // Readiness passes — not blocked by cartoon guard (reaches wallet check instead).
    expect(data.error).not.toContain("not ready");
    expect(data.error).not.toContain("cuts.json");
  });

  it("blocks cartoon plot when uploadedUrl is a local path matched by local markdown", async () => {
    const storyDir = setupCartoonStory();
    const localPath = "assets/plot-01/cut-01-final.webp";
    const cf = createCutsFile("plot-01", 1);
    cf.cuts[0].uploadedUrl = localPath;
    writeCutsFile(storyDir, "plot-01", cf);

    const md = `<!-- ows:cartoon-cut cut-001 start -->\n![C](${localPath})\n<!-- ows:cartoon-cut cut-001 end -->`;
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.issues.some((i: string) => i.includes("not an http(s) URL"))).toBe(true);
  });

  it("cannot bypass cartoon guard by sending contentType: fiction", async () => {
    // Story is cartoon server-side; body lies and says fiction.
    const storyDir = setupCartoonStory();
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));
    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![C](assets/plot-01/cut-01-final.webp)\n<!-- ows:cartoon-cut cut-001 end -->";

    const res = await post(publishBody({ contentType: "fiction", content: md }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("not ready");
  });
});

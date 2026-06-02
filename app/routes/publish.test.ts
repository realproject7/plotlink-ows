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
  getCreationFee: vi.fn(),
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
import { getEthBalance, getCreationFee, estimatePublishCost } from "../lib/publish";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";
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

  it("blocks cartoon plot with a precise reason when a recorded cleanImagePath file is missing (#302)", async () => {
    const storyDir = setupCartoonStory();
    const cutsFile = createCutsFile("plot-01", 1);
    cutsFile.cuts[0].cleanImagePath = "assets/plot-01/cut-01-clean.webp"; // recorded, but no file on disk
    writeCutsFile(storyDir, "plot-01", cutsFile);

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![C](https://ipfs/x)\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Cut 1 clean image path is recorded but the file is missing");
    expect(data.issues).toContain("Cut 1 clean image path is recorded but the file is missing");
  });

  it("does not block an already-uploaded cut for a missing local asset (#302 preserves uploaded)", async () => {
    const storyDir = setupCartoonStory();
    const cutsFile = createCutsFile("plot-01", 1);
    // Uploaded cut: content is on IPFS. A missing LOCAL clean image must not block re-publish.
    cutsFile.cuts[0].cleanImagePath = "assets/plot-01/cut-01-clean.webp"; // file absent
    cutsFile.cuts[0].uploadedUrl = "https://ipfs/x";
    cutsFile.cuts[0].uploadedCid = "cid";
    writeCutsFile(storyDir, "plot-01", cutsFile);

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![C](https://ipfs/x)\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    // Passes the cartoon readiness gate (reaches wallet handling), i.e. it is NOT
    // rejected with the stale-path reason.
    const data = await res.json();
    expect(data.error || "").not.toContain("clean image path is recorded but the file is missing");
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

  it("blocks cartoon plot when placeholder prose remains above otherwise-valid cut blocks (#286)", async () => {
    // Reproduces storyline #57 / plot 1: every cut block is a valid uploaded
    // image (would pass the old guard), but instructional placeholder prose sits
    // ABOVE the blocks and would render as junk on the immutable published page.
    const storyDir = setupCartoonStory();
    const url = "https://ipfs.filebase.io/ipfs/QmExact";
    const cf = createCutsFile("plot-01", 1);
    cf.cuts[0].uploadedUrl = url;
    writeCutsFile(storyDir, "plot-01", cf);

    const md = [
      "Placeholder only. OWS should generate the publish markdown from `plot-01.cuts.json` after clean images are approved, lettered final images are created, and final images are uploaded.",
      "",
      `<!-- ows:cartoon-cut cut-001 start -->\n![C](${url})\n<!-- ows:cartoon-cut cut-001 end -->`,
    ].join("\n");
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("not ready");
    expect(data.issues.some((i: string) => i.includes("placeholder/instructional prose"))).toBe(true);
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

describe("GET /api/publish/preflight — PlotLink-backed upload flow (#287)", () => {
  let app: Hono;

  beforeEach(() => {
    app = makeApp();
    // Default: a valid funded writer wallet.
    vi.mocked(listAgentWallets).mockReturnValue([
      { name: "plotlink-writer", address: "0xabc" } as never,
    ]);
    vi.mocked(getBaseAddress).mockReturnValue("0xabc" as never);
    vi.mocked(getEthBalance).mockResolvedValue(BigInt(1e18)); // 1 ETH
    vi.mocked(getCreationFee).mockResolvedValue(BigInt(1e16)); // 0.01 ETH
    vi.mocked(estimatePublishCost).mockResolvedValue({
      creationFee: BigInt(1e16),
      gasEstimate: BigInt(21000),
      gasPrice: BigInt(1e9),
      totalCost: BigInt(1e16) + BigInt(1e15),
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function preflight() {
    const res = await app.request("/api/publish/preflight");
    return { res, data: await res.json() };
  }

  it("reports not-ready when there is no writer wallet", async () => {
    vi.mocked(listAgentWallets).mockReturnValue([]);
    const { data } = await preflight();
    expect(data.ready).toBe(false);
    expect(data.error).toContain("No OWS wallet");
  });

  it("a valid funded setup is ready and never reports Filebase (#287 AC1)", async () => {
    const { data } = await preflight();
    expect(data.ready).toBe(true);
    expect(data.error).toBeNull();
    // The obsolete local Filebase requirement is gone entirely.
    expect(data).not.toHaveProperty("hasFilebase");
    expect(JSON.stringify(data)).not.toMatch(/filebase/i);
  });

  it("gas-estimation failure is a warning, not a blocker, when balance covers the creation fee (#211 pilot)", async () => {
    // Reproduces the pilot: estimateGas reverts on dummy createStoryline args
    // while the real publish succeeds. Fee is readable; balance covers it.
    vi.mocked(estimatePublishCost).mockRejectedValue(new Error("execution reverted"));
    const { data } = await preflight();
    expect(data.ready).toBe(true);
    expect(data.error).toBeNull();
    expect(data.estimationFailed).toBe(true);
    expect(data.estimateWarning).toBeTruthy();
    expect(data.requiredBalance).toBe(BigInt(1e16).toString()); // falls back to creation fee
  });

  it("insufficient balance is still a real blocker", async () => {
    vi.mocked(getEthBalance).mockResolvedValue(BigInt(1e15)); // 0.001 ETH < fee+gas
    const { data } = await preflight();
    expect(data.ready).toBe(false);
    expect(data.error).toContain("Insufficient ETH");
  });

  it("insufficient balance blocks even when gas estimation fails (fee not covered)", async () => {
    vi.mocked(estimatePublishCost).mockRejectedValue(new Error("execution reverted"));
    vi.mocked(getEthBalance).mockResolvedValue(BigInt(1e15)); // below the creation fee
    const { data } = await preflight();
    expect(data.ready).toBe(false);
    expect(data.error).toContain("Insufficient ETH");
    expect(data.estimateWarning).toBeTruthy();
  });

  it("an unreadable creation fee (RPC/contract config) is a real blocker", async () => {
    vi.mocked(getCreationFee).mockRejectedValue(new Error("RPC down"));
    const { data } = await preflight();
    expect(data.ready).toBe(false);
    expect(data.error).toContain("creation fee");
  });
});

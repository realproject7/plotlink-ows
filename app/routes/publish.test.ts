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

  it("blocks cartoon plot when cuts.json is missing", async () => {
    fs.mkdirSync(path.join(tmpDir, "story"), { recursive: true });
    const res = await post(publishBody({ content: "some content" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("cuts.json not found");
  });

  it("blocks cartoon plot with awaiting-upload placeholder", async () => {
    const storyDir = path.join(tmpDir, "story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n<!-- Cut 1: awaiting upload -->\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("not ready");
    expect(data.issues.some((i: string) => i.includes("awaiting-upload"))).toBe(true);
  });

  it("blocks cartoon plot with local asset path image ref", async () => {
    const storyDir = path.join(tmpDir, "story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 1));

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![Cut 1](assets/plot-01/cut-01-final.webp)\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.issues.some((i: string) => i.includes("not an uploaded URL"))).toBe(true);
  });

  it("blocks cartoon plot with missing marker blocks", async () => {
    const storyDir = path.join(tmpDir, "story");
    fs.mkdirSync(storyDir, { recursive: true });
    writeCutsFile(storyDir, "plot-01", createCutsFile("plot-01", 2));

    const md = "<!-- ows:cartoon-cut cut-001 start -->\n![C](https://ipfs/x)\n<!-- ows:cartoon-cut cut-001 end -->";
    const res = await post(publishBody({ content: md }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.issues.some((i: string) => i.includes("Cut 2"))).toBe(true);
  });

  it("blocks cartoon plot when cuts.json is invalid", async () => {
    const storyDir = path.join(tmpDir, "story");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, "plot-01.cuts.json"), "{ not json");

    const res = await post(publishBody({ content: "x" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Cannot publish");
  });

  it("does not apply cartoon guard to fiction plots", async () => {
    // Fiction plot with no cuts.json should pass the readiness guard and reach
    // wallet check (mocked listAgentWallets returns [] → "No OWS wallet" 400).
    const storyDir = path.join(tmpDir, "story");
    fs.mkdirSync(storyDir, { recursive: true });

    const res = await post(publishBody({ contentType: "fiction", content: "Some fiction prose." }));
    const data = await res.json();
    // Not blocked by cartoon readiness — error is the wallet check instead.
    expect(data.error).not.toContain("cuts.json");
    expect(data.error).not.toContain("not ready");
  });
});

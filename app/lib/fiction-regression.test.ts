import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

vi.mock("../lib/generate-story-instructions", () => ({
  writeStoryInstructions: vi.fn(),
}));

import { readStoryMeta, storiesRoutes } from "../routes/stories";
import { getContentTypeForPublish } from "../web/lib/publish-helpers";
import { Hono } from "hono";

describe("fiction regression", () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fiction-reg-"));
    testState.storiesDir = tmpDir;
    app = new Hono();
    app.route("/api/stories", storiesRoutes);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readStoryMeta defaults to fiction when .story.json is missing", () => {
    const meta = readStoryMeta(tmpDir);
    expect(meta.contentType).toBe("fiction");
  });

  it("GET /api/stories/:name returns fiction contentType and filters .md only via route", async () => {
    const storyDir = path.join(tmpDir, "fiction-story");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# My Fiction");
    fs.writeFileSync(path.join(storyDir, "genesis.md"), "# Hook");
    fs.writeFileSync(path.join(storyDir, ".story.json"), '{"contentType":"fiction"}');
    fs.writeFileSync(path.join(storyDir, "plot-01.cuts.json"), "{}");

    const res = await app.request("/api/stories/fiction-story");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contentType).toBe("fiction");
    expect(body.files.every((f: { file: string }) => f.file.endsWith(".md"))).toBe(true);
    expect(body.files.some((f: { file: string }) => f.file === "plot-01.cuts.json")).toBe(false);
  });

  it("fiction publish payload omits contentType via getContentTypeForPublish", () => {
    expect(getContentTypeForPublish({ "my-fiction": "fiction" }, "my-fiction", undefined)).toBeUndefined();
    expect(getContentTypeForPublish({ "my-fiction": "fiction" }, "my-fiction", 42)).toBeUndefined();
  });

  it("GET /api/stories lists fiction stories without cartoon fields via route", async () => {
    const storyDir = path.join(tmpDir, "plain-fiction");
    fs.mkdirSync(storyDir, { recursive: true });
    fs.writeFileSync(path.join(storyDir, "structure.md"), "# Plain Fiction");

    const res = await app.request("/api/stories");
    expect(res.status).toBe(200);
    const body = await res.json();
    const story = body.stories.find((s: { name: string }) => s.name === "plain-fiction");
    expect(story).toBeTruthy();
    expect(story.contentType).toBe("fiction");
    // #424: language is omitted when undetermined (no .story.json/structure/
    // script hint) so the client shows "Needs metadata" instead of defaulting.
    expect(story.language).toBeUndefined();
  });
});

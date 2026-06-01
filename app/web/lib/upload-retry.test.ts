import { describe, it, expect, vi } from "vitest";
import {
  isRateLimitError,
  backoffMs,
  withRateLimitRetry,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_RETRIES,
} from "./upload-retry";

describe("isRateLimitError", () => {
  it("treats HTTP 429 as rate-limited", () => {
    expect(isRateLimitError(429)).toBe(true);
  });

  it("treats a rate-limit message (any status) as rate-limited", () => {
    // The OWS route forwards PlotLink's limit as a 500 with the upstream text.
    expect(isRateLimitError(500, "Rate limit exceeded. Max 5 uploads per minute.")).toBe(true);
    expect(isRateLimitError(503, "rate-limit hit")).toBe(true);
  });

  it("does not treat other failures as rate-limited", () => {
    expect(isRateLimitError(400, "Only WebP and JPEG images are accepted")).toBe(false);
    expect(isRateLimitError(500, "Plot image upload failed: HTTP 500")).toBe(false);
    expect(isRateLimitError(200)).toBe(false);
  });
});

describe("backoffMs", () => {
  it("grows exponentially from the base delay and caps at 60s", () => {
    expect(backoffMs(0, 1000)).toBe(1000);
    expect(backoffMs(1, 1000)).toBe(2000);
    expect(backoffMs(2, 1000)).toBe(4000);
    expect(backoffMs(10, 1000)).toBe(60_000); // capped
  });
});

describe("withRateLimitRetry", () => {
  const sleepSpy = () => {
    const waits: number[] = [];
    const sleep = vi.fn((ms: number) => { waits.push(ms); return Promise.resolve(); });
    return { sleep, waits };
  };

  it("returns immediately on success without sleeping", async () => {
    const { sleep, waits } = sleepSpy();
    const attempt = vi.fn().mockResolvedValue({ ok: true, status: 200, cid: "Qm" });
    const onWaiting = vi.fn();

    const result = await withRateLimitRetry(attempt, { sleep, onWaiting });

    expect(result).toMatchObject({ ok: true, cid: "Qm" });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("retries a rate-limited upload, then succeeds (the #288 pilot case)", async () => {
    const { sleep, waits } = sleepSpy();
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, errorMessage: "Rate limit exceeded. Max 5 uploads per minute." })
      .mockResolvedValueOnce({ ok: true, status: 200, cid: "QmOk" });
    const onWaiting = vi.fn();

    const result = await withRateLimitRetry(attempt, { sleep, onWaiting });

    expect(result).toMatchObject({ ok: true, cid: "QmOk" });
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([RATE_LIMIT_BASE_DELAY_MS]);
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(onWaiting).toHaveBeenCalledWith({ attempt: 1, maxRetries: RATE_LIMIT_MAX_RETRIES, waitMs: RATE_LIMIT_BASE_DELAY_MS });
  });

  it("also retries on a bare HTTP 429 status", async () => {
    const { sleep } = sleepSpy();
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200, cid: "QmOk" });

    const result = await withRateLimitRetry(attempt, { sleep });
    expect(result).toMatchObject({ ok: true });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and returns the last rate-limited result", async () => {
    const { sleep, waits } = sleepSpy();
    const attempt = vi.fn().mockResolvedValue({ ok: false, status: 429, errorMessage: "Rate limit exceeded" });
    const onWaiting = vi.fn();

    const result = await withRateLimitRetry(attempt, { sleep, onWaiting, maxRetries: 3, baseDelayMs: 1000 });

    expect(result).toMatchObject({ ok: false, status: 429 });
    expect(attempt).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(onWaiting).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-rate-limit failure", async () => {
    const { sleep, waits } = sleepSpy();
    const attempt = vi.fn().mockResolvedValue({ ok: false, status: 400, errorMessage: "Image exceeds 1MB limit" });

    const result = await withRateLimitRetry(attempt, { sleep });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});

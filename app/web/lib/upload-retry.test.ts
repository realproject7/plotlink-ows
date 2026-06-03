import { describe, it, expect, vi } from "vitest";
import {
  isRateLimitError,
  backoffMs,
  withRateLimitRetry,
  createUploadThrottle,
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

describe("createUploadThrottle (#413)", () => {
  // A controllable clock: time only advances when the (spied) sleep is awaited,
  // mirroring how the throttle paces a tight batch loop.
  function fakeClock(start = 1_000_000) {
    let t = start;
    const waits: number[] = [];
    const sleep = vi.fn((ms: number) => { waits.push(ms); t += ms; return Promise.resolve(); });
    const now = () => t;
    const advance = (ms: number) => { t += ms; };
    return { sleep, now, waits, advance };
  }

  it("lets the first `limit` uploads through without waiting", async () => {
    const { sleep, now, waits } = fakeClock();
    const throttle = createUploadThrottle({ limit: 5, windowMs: 60_000, sleep, now });

    for (let i = 0; i < 5; i++) await throttle();

    expect(sleep).not.toHaveBeenCalled();
    expect(waits).toEqual([]);
  });

  it("waits out the window before the 6th upload, then drains the rest (7-cut batch)", async () => {
    const { sleep, now, waits } = fakeClock(1_000_000);
    const onWaiting = vi.fn();
    const throttle = createUploadThrottle({ limit: 5, windowMs: 60_000, sleep, now, onWaiting });

    // 7 uploads back-to-back in a tight loop (no real time elapses between them).
    for (let i = 0; i < 7; i++) await throttle();

    // The first 5 fire instantly; the 6th waits ~60s for that burst to age out,
    // which clears the whole window, so the 7th then goes through immediately.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([60_000]);
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(onWaiting.mock.calls[0][0]).toMatchObject({ waitMs: 60_000 });
  });

  it("paces an 11-cut batch into bursts of 5 (two waits)", async () => {
    const { sleep, now } = fakeClock(1_000_000);
    const throttle = createUploadThrottle({ limit: 5, windowMs: 60_000, sleep, now });

    for (let i = 0; i < 11; i++) await throttle();

    // 5 + wait + 5 + wait + 1 = two proactive waits.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not wait when uploads are already spaced beyond the window", async () => {
    const { sleep, now, advance } = fakeClock();
    const throttle = createUploadThrottle({ limit: 5, windowMs: 60_000, sleep, now });

    for (let i = 0; i < 10; i++) {
      await throttle();
      advance(61_000); // each upload happens well after the previous window
    }

    expect(sleep).not.toHaveBeenCalled();
  });

  it("only waits as long as needed for the oldest upload to age out", async () => {
    const { sleep, now, advance, waits } = fakeClock(1_000_000);
    const throttle = createUploadThrottle({ limit: 2, windowMs: 60_000, sleep, now });

    await throttle();            // t=1_000_000
    advance(20_000);             // t=1_020_000
    await throttle();            // 2nd within window — fills the budget
    // 3rd must wait until the FIRST (t=1_000_000) ages out: 60s - 20s already passed = 40s.
    await throttle();

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([40_000]);
  });
});

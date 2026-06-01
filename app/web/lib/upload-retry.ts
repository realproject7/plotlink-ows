// Retry/backoff for rate-limited cartoon cut image uploads (#288).
//
// The PlotLink upload endpoint rate-limits to 5 uploads/minute. A normal webtoon
// episode commonly has more than five cuts, so the batch "Upload & Generate" flow
// would otherwise fail mid-batch on the 6th+ cut with a "Rate limit exceeded"
// response. These helpers retry a single upload with backoff while it is
// rate-limited, while leaving genuine (non-rate-limit) failures to fail fast.

// PlotLink allows 5 uploads/minute, so ~12s spacing clears the window for the
// next cut. Backoff grows from here and is capped so a stuck batch still ends.
export const RATE_LIMIT_BASE_DELAY_MS = 12_000;
export const RATE_LIMIT_MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;

/**
 * A rate-limit response. The OWS route currently forwards PlotLink's rate-limit
 * as a 500 carrying the upstream message ("Rate limit exceeded. Max 5 uploads
 * per minute."), so we detect by status 429 OR a rate-limit message — either is
 * treated as retryable.
 */
export function isRateLimitError(status: number, errorMessage?: string | null): boolean {
  if (status === 429) return true;
  return !!errorMessage && /rate[\s-]?limit/i.test(errorMessage);
}

/** Backoff for the Nth retry (0-based): base, 2×base, 4×base, … capped. */
export function backoffMs(retry: number, baseDelayMs = RATE_LIMIT_BASE_DELAY_MS): number {
  return Math.min(baseDelayMs * 2 ** retry, MAX_BACKOFF_MS);
}

export interface AttemptResult {
  ok: boolean;
  status: number;
  errorMessage?: string | null;
}

export interface RetryDeps {
  /** Injectable for tests; defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseDelayMs?: number;
  /** Called once before each backoff wait so the UI can show a waiting state. */
  onWaiting?: (info: { attempt: number; maxRetries: number; waitMs: number }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `attempt` and, while its result is rate-limited, wait with backoff and
 * retry up to `maxRetries` times. Returns the first non-rate-limited result, or
 * the last rate-limited result once retries are exhausted (so the caller still
 * gets the affected status/message to report). Never retries a non-rate-limit
 * failure or a success.
 */
export async function withRateLimitRetry<T extends AttemptResult>(
  attempt: () => Promise<T>,
  deps: RetryDeps = {},
): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  const maxRetries = deps.maxRetries ?? RATE_LIMIT_MAX_RETRIES;
  const baseDelayMs = deps.baseDelayMs ?? RATE_LIMIT_BASE_DELAY_MS;

  let retries = 0;
  for (;;) {
    const result = await attempt();
    if (result.ok || !isRateLimitError(result.status, result.errorMessage)) return result;
    if (retries >= maxRetries) return result;
    const waitMs = backoffMs(retries, baseDelayMs);
    retries += 1;
    deps.onWaiting?.({ attempt: retries, maxRetries, waitMs });
    await sleep(waitMs);
  }
}

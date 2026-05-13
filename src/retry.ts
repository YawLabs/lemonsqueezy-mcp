export const REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRY_WAIT_MS = 1_000;
export const MAX_RETRY_WAIT_MS = 30_000;
/**
 * Hard ceiling on total wall-clock time spent inside `fetchWithRetry`,
 * across all attempts + sleeps. Without this, pathological combinations of
 * per-attempt timeouts (30s each) and backoffs could leave a tool call
 * hanging for ~2 minutes. The deadline never truncates an in-flight fetch;
 * it just stops the loop from starting a NEW attempt or sleep that would
 * push us past the ceiling.
 */
export const OVERALL_DEADLINE_MS = 90_000;

const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 250;
const JITTER_FRACTION = 0.25;

export function parseRetryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_WAIT_MS;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds)) {
    return seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_WAIT_MS;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return DEFAULT_RETRY_WAIT_MS;
}

export function isAbortTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === "TimeoutError" || e.name === "AbortError" || e.code === "ABORT_ERR";
}

/**
 * Shape of the error `fetchWithRetry` throws when the retry loop terminates
 * due to a timeout (either the per-attempt AbortSignal firing on a non-
 * retryable attempt, or the overall deadline cutting the loop short).
 * Carries the wall-clock `elapsedMs` and `attempts` count so callers can
 * surface an accurate diagnostic instead of repeating the per-attempt
 * budget. Keeps `name = "TimeoutError"` so `isAbortTimeoutError` still
 * detects it.
 */
export type RetryTimeoutError = Error & {
  name: "TimeoutError";
  elapsedMs: number;
  attempts: number;
};

export function isRetryTimeoutError(err: unknown): err is RetryTimeoutError {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; elapsedMs?: unknown; attempts?: unknown };
  return e.name === "TimeoutError" && typeof e.elapsedMs === "number" && typeof e.attempts === "number";
}

function makeRetryTimeoutError(elapsedMs: number, attempts: number, cause?: unknown): RetryTimeoutError {
  const err = new Error("Request timed out") as RetryTimeoutError;
  err.name = "TimeoutError";
  err.elapsedMs = elapsedMs;
  err.attempts = attempts;
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause;
  return err;
}

export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = rand() * base * JITTER_FRACTION;
  return Math.min(base + jitter, MAX_RETRY_WAIT_MS);
}

export type RetryOpts = {
  idempotent: boolean;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  rand?: () => number;
  /**
   * Overall wall-clock ceiling for the entire retry loop, in ms. Defaults to
   * `OVERALL_DEADLINE_MS`. The deadline is checked before each new attempt
   * and before each sleep; an in-flight fetch is never truncated.
   */
  deadlineMs?: number;
  /**
   * Injectable clock for tests. Defaults to `Date.now`.
   */
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  url: string,
  init: Omit<RequestInit, "signal">,
  opts: RetryOpts,
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? defaultSleep;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const rand = opts.rand ?? Math.random;
  const deadlineMs = opts.deadlineMs ?? OVERALL_DEADLINE_MS;
  const now = opts.now ?? Date.now;

  const startedAt = now();
  const deadlineAt = startedAt + deadlineMs;
  let attempts = 0;
  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Stop the loop before starting a new attempt if we've already passed
    // the deadline. (The first attempt always runs -- attempt === 1 means
    // we haven't tried yet, and aborting before the first call would
    // surprise callers who passed a tiny deadline by mistake.)
    if (attempt > 1 && now() >= deadlineAt) {
      if (lastResponse) return lastResponse;
      throw makeRetryTimeoutError(now() - startedAt, attempts, lastError);
    }

    attempts = attempt;
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      lastResponse = res;

      if (res.status === 429) {
        if (attempt === maxAttempts) return res;
        const waitMs = parseRetryAfterMs(res.headers.get("retry-after"));
        if (waitMs > MAX_RETRY_WAIT_MS) return res;
        // Don't sleep into the future past the deadline -- return the 429
        // now rather than burning wall-clock to start an attempt we'd
        // immediately bail on.
        if (now() + waitMs >= deadlineAt) return res;
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500 && res.status < 600 && opts.idempotent && attempt < maxAttempts) {
        const waitMs = backoffDelay(attempt, rand);
        if (now() + waitMs >= deadlineAt) return res;
        await sleep(waitMs);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (isAbortTimeoutError(err)) {
        if (!opts.idempotent || attempt === maxAttempts) {
          throw makeRetryTimeoutError(now() - startedAt, attempts, err);
        }
        const waitMs = backoffDelay(attempt, rand);
        if (now() + waitMs >= deadlineAt) {
          throw makeRetryTimeoutError(now() - startedAt, attempts, err);
        }
        await sleep(waitMs);
        continue;
      }
      if (err instanceof TypeError && opts.idempotent && attempt < maxAttempts) {
        const waitMs = backoffDelay(attempt, rand);
        if (now() + waitMs >= deadlineAt) throw err;
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("fetchWithRetry exhausted attempts");
}

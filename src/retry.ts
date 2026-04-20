export const REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRY_WAIT_MS = 1_000;
export const MAX_RETRY_WAIT_MS = 30_000;

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

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

      if (res.status === 429) {
        if (attempt === maxAttempts) return res;
        const waitMs = parseRetryAfterMs(res.headers.get("retry-after"));
        if (waitMs > MAX_RETRY_WAIT_MS) return res;
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500 && res.status < 600 && opts.idempotent && attempt < maxAttempts) {
        await sleep(backoffDelay(attempt, rand));
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (isAbortTimeoutError(err)) {
        if (!opts.idempotent || attempt === maxAttempts) throw err;
        await sleep(backoffDelay(attempt, rand));
        continue;
      }
      if (err instanceof TypeError && opts.idempotent && attempt < maxAttempts) {
        await sleep(backoffDelay(attempt, rand));
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("fetchWithRetry exhausted attempts");
}

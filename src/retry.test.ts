import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backoffDelay,
  fetchWithRetry,
  isAbortTimeoutError,
  isRetryTimeoutError,
  OVERALL_DEADLINE_MS,
  parseRetryAfterMs,
} from "./retry.js";

function fakeSleep() {
  const sleeps: number[] = [];
  return {
    sleeps,
    fn: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

function fakeFetch(responses: Array<Response | Error>) {
  let i = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (next instanceof Error) throw next;
    return next as Response;
  }) as typeof fetch;
  return { fn, calls };
}

describe("parseRetryAfterMs", () => {
  it("returns default when header missing", () => {
    assert.equal(parseRetryAfterMs(null), 1000);
  });
  it("parses integer seconds", () => {
    assert.equal(parseRetryAfterMs("5"), 5000);
  });
  it("parses zero", () => {
    assert.equal(parseRetryAfterMs("0"), 0);
  });
  it("rejects negative", () => {
    assert.equal(parseRetryAfterMs("-3"), 1000);
  });
  it("parses HTTP date relative to now", () => {
    const soon = new Date(Date.now() + 2000).toUTCString();
    const ms = parseRetryAfterMs(soon);
    assert.ok(ms >= 0 && ms <= 2500, `expected ~2000ms, got ${ms}`);
  });
  it("handles past dates as 0", () => {
    const past = new Date(Date.now() - 5000).toUTCString();
    assert.equal(parseRetryAfterMs(past), 0);
  });
  it("falls back on garbage", () => {
    assert.equal(parseRetryAfterMs("not-a-date"), 1000);
  });
  it("treats a whitespace-only header as absent, not as zero", () => {
    // `Number("")` is 0, not NaN, so a whitespace-only header used to slip
    // through the numeric branch and produce a 0ms wait -- an immediate
    // retry into the same rate limit instead of the 1s default.
    assert.equal(parseRetryAfterMs(" "), 1000);
    assert.equal(parseRetryAfterMs("\t"), 1000);
    assert.equal(parseRetryAfterMs("   \n "), 1000);
  });
  it("still honours an explicit zero", () => {
    assert.equal(parseRetryAfterMs("0"), 0);
    assert.equal(parseRetryAfterMs(" 0 "), 0);
  });
});

describe("isAbortTimeoutError", () => {
  it("detects TimeoutError name", () => {
    assert.ok(isAbortTimeoutError({ name: "TimeoutError" }));
  });
  it("detects AbortError name", () => {
    assert.ok(isAbortTimeoutError({ name: "AbortError" }));
  });
  it("detects ABORT_ERR code", () => {
    assert.ok(isAbortTimeoutError({ code: "ABORT_ERR" }));
  });
  it("rejects plain error", () => {
    assert.equal(isAbortTimeoutError(new Error("boom")), false);
  });
  it("rejects non-objects", () => {
    assert.equal(isAbortTimeoutError(null), false);
    assert.equal(isAbortTimeoutError(undefined), false);
    assert.equal(isAbortTimeoutError("err"), false);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially with base 250ms", () => {
    const noRand = () => 0;
    assert.equal(backoffDelay(1, noRand), 250);
    assert.equal(backoffDelay(2, noRand), 500);
    assert.equal(backoffDelay(3, noRand), 1000);
    assert.equal(backoffDelay(4, noRand), 2000);
  });
  it("applies jitter up to 25%", () => {
    const fullRand = () => 1;
    assert.equal(backoffDelay(1, fullRand), 250 + 62.5);
  });
  it("caps at MAX_RETRY_WAIT_MS", () => {
    const noRand = () => 0;
    assert.equal(backoffDelay(20, noRand), 30_000);
  });
});

describe("fetchWithRetry", () => {
  function ok() {
    return new Response('{"data":1}', { status: 200 });
  }
  function err429(retryAfter = "0") {
    return new Response("{}", { status: 429, headers: { "retry-after": retryAfter } });
  }
  function err500() {
    return new Response("{}", { status: 500 });
  }

  it("returns success on first try", async () => {
    const { fn, calls } = fakeFetch([ok()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      { idempotent: true, fetchImpl: fn, sleep: sleep.fn },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(sleep.sleeps.length, 0);
  });

  it("retries 429 up to max attempts then returns", async () => {
    const { fn, calls } = fakeFetch([err429(), err429(), err429(), err429()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      { idempotent: true, fetchImpl: fn, sleep: sleep.fn },
    );
    assert.equal(res.status, 429);
    assert.equal(calls.length, 4);
    assert.equal(sleep.sleeps.length, 3);
  });

  it("recovers after 429", async () => {
    const { fn, calls } = fakeFetch([err429(), ok()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      { idempotent: true, fetchImpl: fn, sleep: sleep.fn },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
  });

  it("bails on 429 when Retry-After exceeds 30s cap", async () => {
    const { fn, calls } = fakeFetch([err429("31")]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      { idempotent: true, fetchImpl: fn, sleep: sleep.fn },
    );
    assert.equal(res.status, 429);
    assert.equal(calls.length, 1);
  });

  it("retries 5xx on idempotent request", async () => {
    const { fn, calls } = fakeFetch([err500(), err500(), err500(), err500()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      { idempotent: true, fetchImpl: fn, sleep: sleep.fn, rand: () => 0 },
    );
    assert.equal(res.status, 500);
    assert.equal(calls.length, 4);
    assert.deepEqual(sleep.sleeps, [250, 500, 1000]);
  });

  it("does NOT retry 5xx on non-idempotent request", async () => {
    const { fn, calls } = fakeFetch([err500()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "POST" },
      { idempotent: false, fetchImpl: fn, sleep: sleep.fn },
    );
    assert.equal(res.status, 500);
    assert.equal(calls.length, 1);
    assert.equal(sleep.sleeps.length, 0);
  });

  it("DOES retry 429 on a non-idempotent request", async () => {
    // Deliberate asymmetry with the 5xx branch, and the one api.ts documents
    // above `const idempotent = ...`: a 429 means the server rejected the
    // request before acting on it, so replaying a POST (including a refund)
    // cannot double-apply. Gating this branch on `idempotent` would look like
    // a tidy-up but would stop refunds retrying through a rate-limit blip.
    const { fn, calls } = fakeFetch([err429(), err429(), ok()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "POST" },
      { idempotent: false, fetchImpl: fn, sleep: sleep.fn },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 3, "429 must be retried regardless of idempotency");
  });

  it("still does not retry 5xx on a non-idempotent request (429 asymmetry is intentional)", async () => {
    // Paired with the test above so the contrast is explicit: same method,
    // same idempotent flag, different status -> different behaviour.
    const { fn, calls } = fakeFetch([err500(), ok()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "POST" },
      { idempotent: false, fetchImpl: fn, sleep: sleep.fn },
    );
    assert.equal(res.status, 500);
    assert.equal(calls.length, 1);
  });

  it("retries timeout on idempotent request", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    const { fn, calls } = fakeFetch([timeout, ok()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      { idempotent: true, fetchImpl: fn, sleep: sleep.fn, rand: () => 0 },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
  });

  it("throws timeout on non-idempotent request without retry", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    const { fn, calls } = fakeFetch([timeout]);
    const sleep = fakeSleep();
    await assert.rejects(
      fetchWithRetry("https://x", { method: "POST" }, { idempotent: false, fetchImpl: fn, sleep: sleep.fn }),
    );
    assert.equal(calls.length, 1);
  });

  it("retries network TypeError on idempotent", async () => {
    const net = new TypeError("fetch failed");
    const { fn, calls } = fakeFetch([net, ok()]);
    const sleep = fakeSleep();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      { idempotent: true, fetchImpl: fn, sleep: sleep.fn, rand: () => 0 },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
  });

  it("propagates unexpected errors immediately", async () => {
    const boom = new Error("boom");
    const { fn, calls } = fakeFetch([boom]);
    const sleep = fakeSleep();
    await assert.rejects(
      fetchWithRetry("https://x", { method: "GET" }, { idempotent: true, fetchImpl: fn, sleep: sleep.fn }),
      /boom/,
    );
    assert.equal(calls.length, 1);
  });
});

/**
 * Fake clock that advances by however long sleeps are scheduled for, so
 * deadline arithmetic in fetchWithRetry behaves deterministically without
 * burning wall-clock in the test.
 */
function fakeClock(startAt = 1_000_000) {
  let nowMs = startAt;
  return {
    now: () => nowMs,
    sleep: (ms: number) => {
      nowMs += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("isRetryTimeoutError", () => {
  it("detects shape with elapsedMs + attempts", () => {
    const err = Object.assign(new Error("x"), { name: "TimeoutError", elapsedMs: 100, attempts: 2 });
    assert.ok(isRetryTimeoutError(err));
  });
  it("rejects bare AbortSignal.timeout error (no fields)", () => {
    assert.equal(isRetryTimeoutError({ name: "TimeoutError" }), false);
  });
  it("rejects wrong name", () => {
    assert.equal(isRetryTimeoutError({ name: "AbortError", elapsedMs: 100, attempts: 1 }), false);
  });
});

describe("OVERALL_DEADLINE_MS", () => {
  it("defaults to 90s", () => {
    assert.equal(OVERALL_DEADLINE_MS, 90_000);
  });
});

describe("fetchWithRetry timeout error enrichment", () => {
  function timeoutErr() {
    return Object.assign(new Error("timeout"), { name: "TimeoutError" });
  }

  it("enriches thrown error with elapsedMs + attempts on exhausted retries", async () => {
    const clock = fakeClock();
    // Each fetch call advances the clock by 30s (per-attempt timeout) so
    // elapsedMs reflects realistic accumulation across 4 attempts.
    const fn: typeof fetch = (async () => {
      clock.advance(30_000);
      throw timeoutErr();
    }) as typeof fetch;
    let caught: unknown;
    try {
      await fetchWithRetry(
        "https://x",
        { method: "GET" },
        {
          idempotent: true,
          fetchImpl: fn,
          sleep: clock.sleep,
          now: clock.now,
          rand: () => 0,
          // Disable the overall deadline for this test so we can exercise
          // pure max-attempts exhaustion.
          deadlineMs: 10 * 60 * 1000,
        },
      );
    } catch (err) {
      caught = err;
    }
    assert.ok(isRetryTimeoutError(caught), "should be enriched RetryTimeoutError");
    if (!isRetryTimeoutError(caught)) return;
    assert.equal(caught.attempts, 4);
    // 4 fetches of 30s + 3 backoff sleeps (250+500+1000ms = 1.75s) = 121.75s.
    assert.ok(caught.elapsedMs >= 120_000, `elapsedMs too small: ${caught.elapsedMs}`);
    assert.ok(caught.elapsedMs <= 123_000, `elapsedMs too large: ${caught.elapsedMs}`);
  });

  it("reports 1 attempt for single-attempt timeout on non-idempotent request", async () => {
    const clock = fakeClock();
    const fn: typeof fetch = (async () => {
      clock.advance(30_000);
      throw timeoutErr();
    }) as typeof fetch;
    let caught: unknown;
    try {
      await fetchWithRetry(
        "https://x",
        { method: "POST" },
        { idempotent: false, fetchImpl: fn, sleep: clock.sleep, now: clock.now },
      );
    } catch (err) {
      caught = err;
    }
    assert.ok(isRetryTimeoutError(caught));
    if (!isRetryTimeoutError(caught)) return;
    assert.equal(caught.attempts, 1);
    assert.ok(caught.elapsedMs >= 30_000 && caught.elapsedMs <= 31_000);
  });

  it("does not enrich (does not throw a timeout) on fast success", async () => {
    const { fn } = fakeFetch([new Response("{}", { status: 200 })]);
    const clock = fakeClock();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      { idempotent: true, fetchImpl: fn, sleep: clock.sleep, now: clock.now },
    );
    assert.equal(res.status, 200);
  });
});

describe("fetchWithRetry overall deadline", () => {
  function err500() {
    return new Response("{}", { status: 500 });
  }
  function err429(retryAfter = "1") {
    return new Response("{}", { status: 429, headers: { "retry-after": retryAfter } });
  }
  function timeoutErr() {
    return Object.assign(new Error("timeout"), { name: "TimeoutError" });
  }

  it("stops retrying 5xx and returns last response when next sleep would exceed deadline", async () => {
    const clock = fakeClock();
    // Each fetch is "instant" (no advance) so only the backoff sleeps eat
    // the clock. With deadlineMs=600 and base backoffs 250/500/1000, the
    // first sleep fits (250) but the second (500) would push us to
    // 250+30s-fetch... actually fetches are instant here; clock advances
    // are pure sleeps. First sleep advances to 250, second would advance
    // to 750 which exceeds 600.
    const { fn, calls } = fakeFetch([err500(), err500(), err500(), err500()]);
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      {
        idempotent: true,
        fetchImpl: fn,
        sleep: clock.sleep,
        now: clock.now,
        rand: () => 0,
        deadlineMs: 600,
      },
    );
    assert.equal(res.status, 500);
    // First attempt + first sleep (250ms) + second attempt; second sleep
    // (500ms) would push to 750ms > 600 deadline, so return after 2nd 500.
    assert.equal(calls.length, 2);
  });

  it("stops retrying 429 and returns last response when retry-after wait would exceed deadline", async () => {
    const clock = fakeClock();
    // retry-after: 1s. deadline is 500ms. First attempt returns 429; the
    // 1s wait would exceed the deadline, so we bail after one call.
    const { fn, calls } = fakeFetch([err429("1"), new Response("{}", { status: 200 })]);
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      {
        idempotent: true,
        fetchImpl: fn,
        sleep: clock.sleep,
        now: clock.now,
        deadlineMs: 500,
      },
    );
    assert.equal(res.status, 429);
    assert.equal(calls.length, 1);
  });

  it("throws enriched timeout when deadline blocks next sleep after a timeout", async () => {
    const clock = fakeClock();
    // First fetch times out (advances 30s), second attempt would need a
    // backoff sleep; deadline is 30s so the sleep would exceed it.
    const fn: typeof fetch = (async () => {
      clock.advance(30_000);
      throw timeoutErr();
    }) as typeof fetch;
    let caught: unknown;
    try {
      await fetchWithRetry(
        "https://x",
        { method: "GET" },
        {
          idempotent: true,
          fetchImpl: fn,
          sleep: clock.sleep,
          now: clock.now,
          rand: () => 0,
          deadlineMs: 30_000,
        },
      );
    } catch (err) {
      caught = err;
    }
    assert.ok(isRetryTimeoutError(caught));
    if (!isRetryTimeoutError(caught)) return;
    assert.equal(caught.attempts, 1);
    assert.ok(caught.elapsedMs >= 30_000);
  });

  it("does not fire on a fast success well inside the deadline", async () => {
    const { fn, calls } = fakeFetch([new Response("{}", { status: 200 })]);
    const clock = fakeClock();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      {
        idempotent: true,
        fetchImpl: fn,
        sleep: clock.sleep,
        now: clock.now,
        deadlineMs: 90_000,
      },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
  });

  it("does not fire on a fast 5xx-then-recover within the deadline", async () => {
    const { fn, calls } = fakeFetch([err500(), new Response("{}", { status: 200 })]);
    const clock = fakeClock();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      {
        idempotent: true,
        fetchImpl: fn,
        sleep: clock.sleep,
        now: clock.now,
        rand: () => 0,
        deadlineMs: 90_000,
      },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
  });

  it("default deadline applies when caller does not set deadlineMs", async () => {
    // No deadlineMs passed -- the default OVERALL_DEADLINE_MS (90s) is in
    // effect. A retry burst that fits well inside 90s succeeds normally.
    const { fn, calls } = fakeFetch([err500(), err500(), new Response("{}", { status: 200 })]);
    const clock = fakeClock();
    const res = await fetchWithRetry(
      "https://x",
      { method: "GET" },
      {
        idempotent: true,
        fetchImpl: fn,
        sleep: clock.sleep,
        now: clock.now,
        rand: () => 0,
      },
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 3);
  });
});

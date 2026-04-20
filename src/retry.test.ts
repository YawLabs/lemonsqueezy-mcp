import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backoffDelay, fetchWithRetry, isAbortTimeoutError, parseRetryAfterMs } from "./retry.js";

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

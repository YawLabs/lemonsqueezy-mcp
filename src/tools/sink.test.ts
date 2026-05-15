import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sinkTools } from "./sink.js";

// ─── Test helpers ───

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let lastRequest: CapturedRequest | undefined;
const originalFetch = globalThis.fetch;

/**
 * Install a stub `globalThis.fetch` that records the captured URL/method/headers
 * and replies with either canned JSON or a forced status/body. The sink tools
 * don't post JSON, so we don't bother capturing request bodies here.
 */
function stubFetch(
  reply: { status?: number; body?: unknown; text?: string; throwError?: Error } = { status: 200, body: { ok: true } },
) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    lastRequest = { url, method, headers };

    if (reply.throwError) {
      throw reply.throwError;
    }

    const status = reply.status ?? 200;
    const text = reply.text ?? (reply.body !== undefined ? JSON.stringify(reply.body) : "");
    return new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

// Mirrors the loose `Function`-typed helper in `handlers.test.ts`. The sink
// tools have heterogeneous input shapes (some require `id`, some take no
// fields); narrowing the union to the concrete tool's signature at every call
// site would add noise without buying anything in tests.
// biome-ignore lint/complexity/noBannedTypes: test helper needs generic function matching
type LooseTool = { name: string; handler: Function };
function findTool(name: string): LooseTool {
  const tool = sinkTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found in sinkTools`);
  return tool as unknown as LooseTool;
}

// ─── Setup / teardown ───

const savedEnv = {
  LEMONSQUEEZY_SINK_URL: process.env.LEMONSQUEEZY_SINK_URL,
  LEMONSQUEEZY_SINK_ADMIN_TOKEN: process.env.LEMONSQUEEZY_SINK_ADMIN_TOKEN,
};

beforeEach(() => {
  lastRequest = undefined;
  delete process.env.LEMONSQUEEZY_SINK_URL;
  delete process.env.LEMONSQUEEZY_SINK_ADMIN_TOKEN;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── Registration / discovery ───

describe("sinkTools registration", () => {
  it("exports the three expected tool names", () => {
    const names = sinkTools.map((t) => t.name).sort();
    assert.deepEqual(names, ["ls_sink_event_mark_processed", "ls_sink_events_list", "ls_sink_stats"]);
  });

  it("every tool has annotations and a Zod schema", () => {
    for (const tool of sinkTools) {
      assert.ok(tool.annotations, `${tool.name} missing annotations`);
      assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
      assert.equal(typeof tool.handler, "function");
    }
  });
});

// ─── Graceful fallback when env unset ───

describe("Sink tools when env vars are unset", () => {
  it("ls_sink_events_list returns a structured 'not configured' error", async () => {
    const tool = findTool("ls_sink_events_list");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Sink not configured/);
    assert.match(result.error ?? "", /LEMONSQUEEZY_SINK_URL/);
    assert.match(result.error ?? "", /LEMONSQUEEZY_SINK_ADMIN_TOKEN/);
    assert.match(result.error ?? "", /github\.com\/YawLabs\/lemonsqueezy-webhook-sink/);
  });

  it("ls_sink_event_mark_processed returns a structured 'not configured' error", async () => {
    const tool = findTool("ls_sink_event_mark_processed");
    const result = await tool.handler({ id: 1 });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Sink not configured/);
  });

  it("ls_sink_stats returns a structured 'not configured' error", async () => {
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Sink not configured/);
  });

  it("names the specific missing var when only one is unset", async () => {
    process.env.LEMONSQUEEZY_SINK_URL = "https://sink.example";
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /LEMONSQUEEZY_SINK_ADMIN_TOKEN/);
    assert.doesNotMatch(result.error ?? "", /LEMONSQUEEZY_SINK_URL/);
  });
});

// ─── Happy-path HTTP ───

describe("Sink tools happy path", () => {
  beforeEach(() => {
    process.env.LEMONSQUEEZY_SINK_URL = "https://sink.example.com";
    process.env.LEMONSQUEEZY_SINK_ADMIN_TOKEN = "test-token-abc";
  });

  it("ls_sink_events_list calls GET /events with bearer auth", async () => {
    stubFetch({ status: 200, body: { events: [{ id: 1, event_name: "order_created" }] } });
    const tool = findTool("ls_sink_events_list");
    const result = await tool.handler({});
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { events: [{ id: 1, event_name: "order_created" }] });
    assert.equal(lastRequest!.method, "GET");
    assert.equal(lastRequest!.url, "https://sink.example.com/events");
    assert.equal(lastRequest!.headers.Authorization, "Bearer test-token-abc");
  });

  it("ls_sink_events_list forwards since/type/limit as query params", async () => {
    stubFetch({ status: 200, body: { events: [] } });
    const tool = findTool("ls_sink_events_list");
    await tool.handler({ since: 1700000000000, type: "order_created", limit: 50 });
    const url = lastRequest!.url;
    assert.ok(url.includes("since=1700000000000"), `URL missing since=: ${url}`);
    assert.ok(url.includes("type=order_created"), `URL missing type=: ${url}`);
    assert.ok(url.includes("limit=50"), `URL missing limit=: ${url}`);
  });

  it("ls_sink_events_list omits unspecified params (no trailing ?)", async () => {
    stubFetch({ status: 200, body: { events: [] } });
    const tool = findTool("ls_sink_events_list");
    await tool.handler({});
    assert.equal(lastRequest!.url, "https://sink.example.com/events");
  });

  it("strips trailing slash from LEMONSQUEEZY_SINK_URL", async () => {
    process.env.LEMONSQUEEZY_SINK_URL = "https://sink.example.com///";
    stubFetch({ status: 200, body: { events: [] } });
    const tool = findTool("ls_sink_events_list");
    await tool.handler({});
    assert.equal(lastRequest!.url, "https://sink.example.com/events");
  });

  it("ls_sink_event_mark_processed POSTs to /events/:id/processed", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const tool = findTool("ls_sink_event_mark_processed");
    const result = await tool.handler({ id: 42 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { ok: true });
    assert.equal(lastRequest!.method, "POST");
    assert.equal(lastRequest!.url, "https://sink.example.com/events/42/processed");
    assert.equal(lastRequest!.headers.Authorization, "Bearer test-token-abc");
  });

  it("ls_sink_stats calls GET /stats", async () => {
    stubFetch({ status: 200, body: { total: 17, unprocessed: 3, lastReceivedAt: 1700000000000 } });
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { total: 17, unprocessed: 3, lastReceivedAt: 1700000000000 });
    assert.equal(lastRequest!.method, "GET");
    assert.equal(lastRequest!.url, "https://sink.example.com/stats");
  });
});

// ─── Error paths ───

describe("Sink tools error paths", () => {
  beforeEach(() => {
    process.env.LEMONSQUEEZY_SINK_URL = "https://sink.example.com";
    process.env.LEMONSQUEEZY_SINK_ADMIN_TOKEN = "test-token-abc";
  });

  it("401 from the sink surfaces as a clear unauthorized error", async () => {
    stubFetch({ status: 401, body: { error: "unauthorized" } });
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /401/);
    assert.match(result.error ?? "", /LEMONSQUEEZY_SINK_ADMIN_TOKEN/);
  });

  it("404 from the sink hints at WEBHOOK_SINK_ADMIN_TOKEN being unset", async () => {
    stubFetch({ status: 404, body: { error: "admin endpoints disabled" } });
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /404/);
    assert.match(result.error ?? "", /WEBHOOK_SINK_ADMIN_TOKEN/);
  });

  it("non-2xx with a non-JSON body surfaces the raw text", async () => {
    stubFetch({ status: 500, text: "internal server error" });
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /500/);
    assert.match(result.error ?? "", /internal server error/);
  });

  it("network failure surfaces as an unreachable error", async () => {
    stubFetch({ throwError: new TypeError("fetch failed") });
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /unreachable/);
    assert.match(result.error ?? "", /fetch failed/);
  });

  it("AbortSignal timeout surfaces as a timeout error", async () => {
    // Simulate AbortSignal.timeout()'s rejection. The platform throws a
    // DOMException with name "TimeoutError"; constructing one cross-runtime
    // is awkward, so we use an Error with the same name -- the handler
    // checks `err.name === "TimeoutError"` first.
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    stubFetch({ throwError: timeoutErr });
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /timed out/);
  });

  it("invalid JSON in a 2xx body surfaces as a clear error", async () => {
    stubFetch({ status: 200, text: "<html>not json</html>" });
    const tool = findTool("ls_sink_stats");
    const result = await tool.handler({});
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /invalid JSON/);
  });
});

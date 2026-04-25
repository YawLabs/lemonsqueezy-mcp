import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { logEvent } from "./logger.js";

type WriteFn = typeof process.stderr.write;

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr) as WriteFn;
  const override = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as WriteFn;
  process.stderr.write = override;
  return {
    lines,
    restore: () => {
      process.stderr.write = original;
    },
  };
}

describe("logEvent", () => {
  const originalEnv = process.env.LEMONSQUEEZY_LOG;

  beforeEach(() => {
    delete process.env.LEMONSQUEEZY_LOG;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LEMONSQUEEZY_LOG;
    else process.env.LEMONSQUEEZY_LOG = originalEnv;
  });

  it("is a no-op when LEMONSQUEEZY_LOG is unset", () => {
    const cap = captureStderr();
    try {
      logEvent({ event: "tool_call", tool: "x", status: "ok" });
      assert.equal(cap.lines.length, 0);
    } finally {
      cap.restore();
    }
  });

  it("is a no-op when LEMONSQUEEZY_LOG is other value", () => {
    process.env.LEMONSQUEEZY_LOG = "text";
    const cap = captureStderr();
    try {
      logEvent({ event: "tool_call", tool: "x", status: "ok" });
      assert.equal(cap.lines.length, 0);
    } finally {
      cap.restore();
    }
  });

  it("writes a JSON line to stderr when enabled", () => {
    process.env.LEMONSQUEEZY_LOG = "json";
    const cap = captureStderr();
    try {
      logEvent({ event: "tool_call", tool: "ls_x", status: "ok", latency_ms: 42 });
      assert.equal(cap.lines.length, 1);
      const line = cap.lines[0] ?? "";
      assert.ok(line.endsWith("\n"));
      const parsed = JSON.parse(line.trim());
      assert.equal(parsed.event, "tool_call");
      assert.equal(parsed.tool, "ls_x");
      assert.equal(parsed.status, "ok");
      assert.equal(parsed.latency_ms, 42);
      assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      cap.restore();
    }
  });

  it("includes audit and inputs flags for destructive entries", () => {
    process.env.LEMONSQUEEZY_LOG = "json";
    const cap = captureStderr();
    try {
      logEvent({
        event: "tool_call",
        tool: "ls_refund_order",
        status: "ok",
        audit: true,
        inputs: { orderId: "1", amount: 500 },
      });
      const parsed = JSON.parse((cap.lines[0] ?? "").trim());
      assert.equal(parsed.audit, true);
      assert.deepEqual(parsed.inputs, { orderId: "1", amount: 500 });
    } finally {
      cap.restore();
    }
  });

  it("emits a degraded fallback entry when inputs cannot be serialized", () => {
    process.env.LEMONSQUEEZY_LOG = "json";
    const cap = captureStderr();
    try {
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      assert.doesNotThrow(() =>
        logEvent({
          event: "tool_call",
          tool: "ls_refund_order",
          status: "ok",
          latency_ms: 7,
          audit: true,
          inputs: cycle,
        }),
      );
      assert.equal(cap.lines.length, 1);
      const parsed = JSON.parse((cap.lines[0] ?? "").trim());
      assert.equal(parsed.event, "tool_call");
      assert.equal(parsed.tool, "ls_refund_order");
      assert.equal(parsed.status, "ok");
      assert.equal(parsed.latency_ms, 7);
      assert.equal(parsed.audit, true);
      assert.equal(parsed.log_error, "inputs_not_serializable");
      assert.equal(parsed.inputs, undefined);
    } finally {
      cap.restore();
    }
  });
});

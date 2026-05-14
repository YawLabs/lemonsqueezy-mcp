import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { _resetAuditBufferForTest, type AuditEntry, pushAuditEntry, readAuditEntries } from "./audit-buffer.js";

function entry(tool: string, extras: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: new Date().toISOString(),
    event: "tool_call",
    tool,
    status: "ok",
    latency_ms: 1,
    audit: true,
    ...extras,
  };
}

describe("audit-buffer", () => {
  beforeEach(() => {
    _resetAuditBufferForTest();
  });
  afterEach(() => {
    _resetAuditBufferForTest();
  });

  it("push then read returns all entries, most-recent-first", () => {
    pushAuditEntry(entry("a"));
    pushAuditEntry(entry("b"));
    pushAuditEntry(entry("c"));
    const out = readAuditEntries();
    assert.equal(out.length, 3);
    assert.equal(out[0]?.tool, "c");
    assert.equal(out[1]?.tool, "b");
    assert.equal(out[2]?.tool, "a");
  });

  it("ring cap drops the oldest entries when overflowing", () => {
    _resetAuditBufferForTest(1000);
    for (let i = 0; i < 1100; i++) {
      pushAuditEntry(entry(`t${i}`));
    }
    const out = readAuditEntries();
    assert.equal(out.length, 1000);
    // Newest entry (t1099) is first.
    assert.equal(out[0]?.tool, "t1099");
    // Oldest retained entry is t100 -- t0..t99 (100 entries) were dropped.
    assert.equal(out[out.length - 1]?.tool, "t100");
  });

  it("respects an explicit limit parameter", () => {
    for (let i = 0; i < 10; i++) pushAuditEntry(entry(`t${i}`));
    const out = readAuditEntries(3);
    assert.equal(out.length, 3);
    assert.equal(out[0]?.tool, "t9");
    assert.equal(out[1]?.tool, "t8");
    assert.equal(out[2]?.tool, "t7");
  });

  it("limit >= buffer size returns the whole buffer", () => {
    pushAuditEntry(entry("a"));
    pushAuditEntry(entry("b"));
    const out = readAuditEntries(999);
    assert.equal(out.length, 2);
  });

  it("limit <= 0 returns an empty array", () => {
    pushAuditEntry(entry("a"));
    assert.deepEqual(readAuditEntries(0), []);
    assert.deepEqual(readAuditEntries(-5), []);
  });

  it("_resetAuditBufferForTest clears the buffer", () => {
    pushAuditEntry(entry("a"));
    pushAuditEntry(entry("b"));
    assert.equal(readAuditEntries().length, 2);
    _resetAuditBufferForTest();
    assert.equal(readAuditEntries().length, 0);
  });

  it("co-exists with multiple entries for the same tool (no dedupe)", () => {
    pushAuditEntry(entry("ls_refund_order", { request_id: "req-1" }));
    pushAuditEntry(entry("ls_refund_order", { request_id: "req-2" }));
    pushAuditEntry(entry("ls_refund_order", { request_id: "req-3" }));
    const out = readAuditEntries();
    assert.equal(out.length, 3);
    // Most-recent-first ordering preserves all three.
    assert.equal(out[0]?.request_id, "req-3");
    assert.equal(out[1]?.request_id, "req-2");
    assert.equal(out[2]?.request_id, "req-1");
  });

  it("stores entries by reference (no defensive clone)", () => {
    // Documents the intentional choice: pushAuditEntry stores the entry
    // object as-is. The caller (src/index.ts) passes already-redacted
    // inputs; cloning would burn cycles on data already in final form.
    const e = entry("a", { inputs: { foo: "bar" } });
    pushAuditEntry(e);
    const [stored] = readAuditEntries();
    assert.equal(stored, e);
    // And the inputs object inside is the same reference, too.
    assert.equal(stored?.inputs, e.inputs);
  });

  it("readAuditEntries returns a fresh array each call", () => {
    pushAuditEntry(entry("a"));
    const a = readAuditEntries();
    const b = readAuditEntries();
    assert.notEqual(a, b);
    // Mutating a returned array must not affect the buffer.
    a.length = 0;
    assert.equal(readAuditEntries().length, 1);
  });
});

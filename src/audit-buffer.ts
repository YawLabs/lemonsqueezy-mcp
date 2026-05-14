import type { LogEntry } from "./logger.js";

/**
 * An entry stored in the in-memory audit ring buffer.
 *
 * Shape mirrors `LogEntry` (when `audit: true`) but adds a `ts` field so
 * each entry is self-describing once read out of the buffer -- the timestamp
 * the logger normally prepends as it serializes is captured here instead.
 *
 * Entries are stored AS-IS (not cloned). The caller passes already-redacted
 * material (see `src/index.ts`, which passes `redactSecrets(input)`); cloning
 * would just spend cycles on data the caller has already prepared. Do not
 * mutate an entry after handing it to `pushAuditEntry`.
 */
export type AuditEntry = { ts: string } & LogEntry;

// Default ring buffer capacity. Sized so a busy destructive-tool burst
// (refunds, cancellations, subscription updates) still leaves headroom
// for ~hours of activity before old entries roll off, while keeping
// memory bounded -- a single entry with redacted inputs is well under
// 2 KB, so 1000 entries is < 2 MB.
const DEFAULT_CAP = 1000;

let buffer: AuditEntry[] = [];
let cap = DEFAULT_CAP;

/**
 * Append an entry to the ring buffer. When the buffer is at capacity the
 * oldest entry is dropped so the most-recent N are always retained.
 *
 * Entries are stored by reference (not cloned) -- see the `AuditEntry`
 * docstring for the rationale.
 */
export function pushAuditEntry(entry: AuditEntry): void {
  buffer.push(entry);
  if (buffer.length > cap) {
    // Trim from the front. `splice` keeps the array identity stable so
    // any retained references to `buffer` stay valid.
    buffer.splice(0, buffer.length - cap);
  }
}

/**
 * Return up to `limit` most-recent entries in most-recent-first order.
 * Defaults to returning everything currently buffered.
 *
 * The returned array is a fresh array, but the entries inside it are the
 * same object references stored in the buffer (see `AuditEntry` rationale).
 */
export function readAuditEntries(limit?: number): AuditEntry[] {
  // Walk newest -> oldest. Slice avoids mutating the underlying buffer
  // when callers reverse or splice the result.
  const reversed = buffer.slice().reverse();
  if (limit === undefined || limit >= reversed.length) return reversed;
  if (limit <= 0) return [];
  return reversed.slice(0, limit);
}

/**
 * Test-only helper -- empties the buffer and resets the cap to default.
 * Exported so tests can isolate state between runs without exposing
 * mutation hooks to production callers.
 */
export function _resetAuditBufferForTest(cap_?: number): void {
  buffer = [];
  cap = cap_ ?? DEFAULT_CAP;
}

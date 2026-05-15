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

// True circular buffer: a fixed-capacity backing array with a write head
// (`next`) and a populated count (`size`). Overflow is O(1) -- the new
// entry overwrites the oldest slot in place. Previous implementation used
// `Array.splice(0, n)` which is O(N) per overflow; not observable at
// 1000 cap on a stdio server, but the circular form is also simpler.
let backing: (AuditEntry | undefined)[] = new Array(DEFAULT_CAP);
let cap = DEFAULT_CAP;
let next = 0;
let size = 0;

/**
 * Append an entry to the ring buffer. When the buffer is at capacity the
 * oldest entry is overwritten in place so the most-recent N are always
 * retained.
 *
 * Entries are stored by reference (not cloned) -- see the `AuditEntry`
 * docstring for the rationale.
 */
export function pushAuditEntry(entry: AuditEntry): void {
  backing[next] = entry;
  next = (next + 1) % cap;
  if (size < cap) size += 1;
}

/**
 * Return up to `limit` most-recent entries in most-recent-first order.
 * Defaults to returning everything currently buffered.
 *
 * The returned array is a fresh array, but the entries inside it are the
 * same object references stored in the buffer (see `AuditEntry` rationale).
 */
export function readAuditEntries(limit?: number): AuditEntry[] {
  if (limit !== undefined && limit <= 0) return [];
  const wanted = limit === undefined ? size : Math.min(limit, size);
  if (wanted === 0) return [];

  const out: AuditEntry[] = new Array(wanted);
  // The newest entry sits at backing[(next - 1 + cap) % cap]; walk backwards.
  let cursor = (next - 1 + cap) % cap;
  for (let i = 0; i < wanted; i++) {
    // Buffer is dense when size > 0, so the entry at every visited slot
    // is defined. The `as AuditEntry` assertion documents that invariant.
    out[i] = backing[cursor] as AuditEntry;
    cursor = (cursor - 1 + cap) % cap;
  }
  return out;
}

/**
 * Test-only helper -- empties the buffer and resets the cap to the
 * supplied value (or default). Exported so tests can isolate state
 * between runs without exposing mutation hooks to production callers.
 */
export function _resetAuditBufferForTest(cap_?: number): void {
  cap = cap_ ?? DEFAULT_CAP;
  backing = new Array(cap);
  next = 0;
  size = 0;
}

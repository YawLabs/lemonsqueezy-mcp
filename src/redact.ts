/**
 * Defense-in-depth redactor for audit-logged tool inputs.
 *
 * Today no destructive tool accepts a secret-typed input (webhook secret
 * tools are non-destructive). If `ls_create_webhook` or `ls_update_webhook`
 * is ever flipped to destructiveHint:true, the webhook signing secret would
 * land in the audit log unredacted. This redactor future-proofs the surface:
 *
 * Two redaction strategies, both applied:
 *
 *   1. Key-name match. Any object key whose name matches SECRET_KEY_RE has
 *      its value replaced with "[REDACTED]". The regex is anchored so
 *      business identifiers (licenseKey, instanceId, storeId, orderId,
 *      webhookId) are preserved -- `licenseKey` does NOT match `^key$`.
 *
 *   2. Value-shape match. Any string value that looks like a LemonSqueezy
 *      / generic JWT bearer token (three dot-separated base64url segments
 *      with a `eyJ` JOSE header prefix) is redacted regardless of the key
 *      it appears under. Closes the gap where a tool with a free-form
 *      `customData` / `metadata` parameter accepts an object whose values
 *      happen to be tokens -- the key name there is the caller's, not
 *      ours, and we can't enumerate it. UUIDs, hyphenated license keys,
 *      and opaque short identifiers do not match the JWT shape.
 */

const SECRET_KEY_RE =
  /^(secret|password|token|api[_-]?key|bearer|authorization|signing[_-]?secret|private[_-]?key|pin|ssn|social[_-]?security[_-]?number|credit[_-]?card|card[_-]?number|cvv|cvc)$/i;

// JOSE-header JWTs always start with `eyJ` (the base64 of `{"`). Three
// dot-separated base64url segments, each at least 4 chars. The total
// length floor (>= 20) keeps a stray `eyJ.x.y` from being flagged.
const JWT_VALUE_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;

const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";

// Hard depth cap as a belt-and-braces complement to the ancestor-path cycle
// guard. A pathological input nested 33+ levels deep stops descending; the
// audit trail keeps the top-level shape and surfaces "[CIRCULAR]" at the
// boundary so an operator can see truncation happened. It also bounds
// recursion depth on a long chain.
//
// It is NOT what bounds total work -- the memo in `redactInner` is. See the
// note on `redactSecrets`.
const MAX_DEPTH = 32;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function looksLikeBearerToken(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length < 20) return false;
  return JWT_VALUE_RE.test(value);
}

/**
 * A completed subtree, plus the depth it was computed at.
 *
 * The depth matters because MAX_DEPTH truncation is position-dependent: a node
 * first reached at depth 30 may have had its children cut off, while the same
 * node reached later at depth 2 has budget to expand fully. Reusing a cached
 * result is only sound when the cached run had at least as much remaining
 * budget as the current position -- i.e. `cached.depth <= depth`.
 */
type MemoEntry = { depth: number; result: unknown };

function redactInner(
  value: unknown,
  ancestors: WeakSet<object>,
  memo: WeakMap<object, MemoEntry>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return CIRCULAR;
  if (typeof value === "string" && looksLikeBearerToken(value)) return REDACTED;
  if (value === null || typeof value !== "object") return value;

  const isArray = Array.isArray(value);
  // Non-plain objects (Date, Buffer, class instances) pass through by
  // reference without descending.
  if (!isArray && !isPlainObject(value)) return value;

  // Back-edge: this node is an ANCESTOR on the current path, so descending
  // again would not terminate.
  if (ancestors.has(value)) return CIRCULAR;

  const cached = memo.get(value);
  if (cached !== undefined && cached.depth <= depth) return cached.result;

  ancestors.add(value);
  let result: unknown;
  if (isArray) {
    result = (value as unknown[]).map((item) => redactInner(item, ancestors, memo, depth + 1));
  } else {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redactInner(val, ancestors, memo, depth + 1);
    }
    result = out;
  }
  ancestors.delete(value);
  memo.set(value, { depth, result });
  return result;
}

/**
 * Returns a deep copy of `input` with the values of any secret-named keys
 * replaced by "[REDACTED]". Does not mutate the input. Circular references
 * are replaced with "[CIRCULAR]" at the back-edge -- the call always
 * terminates.
 *
 * The cycle guard tracks the ANCESTOR PATH (entries are removed on the way
 * back up), not every node ever seen. A permanent visited set also terminates,
 * but it reports a false "[CIRCULAR]" for a merely SHARED reference: given
 * `{ a: x, b: x }` with a plain-object `x`, the second occurrence is not a
 * cycle and must redact normally.
 *
 * An ancestor set ALONE is O(paths), not O(nodes) -- and a "diamond chain"
 * where every level holds two references to the same child has 2^depth paths
 * over only depth+1 objects. Measured before the memo was added: 23 objects
 * took 3.2 seconds, doubling per level, which at MAX_DEPTH would block the
 * stdio server for the better part of an hour from inside the audit path. The
 * `memo` restores linear behaviour by reusing a completed subtree instead of
 * re-walking it; because an entry is only reused when it was computed with at
 * least as much depth budget as the current position, each node is recomputed
 * at most MAX_DEPTH times in the worst case.
 *
 * Consequence worth knowing: a shared input node yields the SAME output object
 * in every position it appears, so the result can be a DAG. That is fine for
 * `JSON.stringify` (which only rejects true cycles) and for the audit buffer,
 * which stores entries by reference.
 */
export function redactSecrets(input: unknown): unknown {
  return redactInner(input, new WeakSet(), new WeakMap(), 0);
}

/**
 * Defense-in-depth redactor for audit-logged tool inputs.
 *
 * Every destructive call's inputs pass through here before they reach any of
 * the three audit sinks: the stderr `tool_call` line, the in-memory audit
 * ring, and the `lemonsqueezy://audit-log` MCP resource that serializes it.
 * Secret-bearing inputs do reach this path: `ls_update_webhook` is
 * destructive when it sets `secret`, and `ls_deactivate_license` is
 * destructive on every call and carries the raw `licenseKey`. `api.ts` also
 * runs an upstream error body through it when the body carries no message it
 * recognizes, before that body is logged or returned as the error text.
 *
 * Three redaction strategies, all applied:
 *
 *   1. Key-name match. Any object key whose name matches SECRET_KEY_RE has
 *      its value replaced with "[REDACTED]". The regex is anchored so
 *      business identifiers (instanceId, storeId, orderId, webhookId,
 *      licenseKeyId) are preserved, and so are keys that merely contain a
 *      secret word (`secretQuestion`, `tokenizer`).
 *
 *   2. License-key mask. A key whose name matches LICENSE_KEY_RE (licenseKey,
 *      license_key, license-key, any case) is masked by `maskLicenseKey`: a
 *      string of 16 or more characters becomes "[REDACTED:last4=XXXX]", and
 *      anything else -- a shorter string, a number, an object -- becomes
 *      "[REDACTED]". A license key authenticates the License API on its own
 *      (see tools/licenses.ts), so it is a bearer credential, not an
 *      identifier. It is masked rather than blanked so an auditor can still
 *      tell which key an entry refers to. The regex is anchored, so the
 *      opaque management-API IDs `licenseKeyId` / `license_key_id` /
 *      `licenseKeyInstanceId` pass through unchanged. Masking goes by key
 *      name only: a license-key value under some other key name is not
 *      caught here.
 *
 *   3. Value-shape match. Any string value that looks like a LemonSqueezy
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

// Anchored: `licenseKeyId`, `license_key_id` and `licenseKeyInstanceId` are
// opaque management-API IDs and must NOT match.
const LICENSE_KEY_RE = /^license[_-]?key$/i;

// Below this length the last four characters are too large a share of the
// value to print, so a short value is blanked outright. A UUID-shaped key
// (36 characters) prints 4 of them.
const MIN_LICENSE_KEY_MASK_LENGTH = 16;

const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";

/**
 * The value written in place of a license key (strategy 2 in the header).
 * Fails closed: only a string long enough to fingerprint keeps its last four
 * characters; every other value is fully redacted. Exported so tests derive
 * the expected string from the implementation instead of restating it.
 */
export function maskLicenseKey(value: unknown): string {
  if (typeof value !== "string" || value.length < MIN_LICENSE_KEY_MASK_LENGTH) return REDACTED;
  return `[REDACTED:last4=${value.slice(-4)}]`;
}

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
      out[key] = SECRET_KEY_RE.test(key)
        ? REDACTED
        : LICENSE_KEY_RE.test(key)
          ? maskLicenseKey(val)
          : redactInner(val, ancestors, memo, depth + 1);
    }
    result = out;
  }
  ancestors.delete(value);
  memo.set(value, { depth, result });
  return result;
}

/**
 * Returns a deep copy of `input` with the values of any secret-named keys
 * replaced by "[REDACTED]" and any license-key-named keys masked by
 * `maskLicenseKey`. Does not mutate the input. Circular references
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

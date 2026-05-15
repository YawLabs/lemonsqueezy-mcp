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

// Hard depth cap as a belt-and-braces complement to the visited-set cycle
// guard. A pathological input nested 33+ levels deep stops descending; the
// audit trail keeps the top-level shape and surfaces "[CIRCULAR]" at the
// boundary so an operator can see truncation happened.
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

function redactInner(value: unknown, visited: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return CIRCULAR;
  if (typeof value === "string" && looksLikeBearerToken(value)) return REDACTED;
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    if (visited.has(value)) return CIRCULAR;
    visited.add(value);
    return value.map((item) => redactInner(item, visited, depth + 1));
  }

  if (!isPlainObject(value)) return value;

  if (visited.has(value)) return CIRCULAR;
  visited.add(value);

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = redactInner(val, visited, depth + 1);
    }
  }
  return out;
}

/**
 * Returns a deep copy of `input` with the values of any secret-named keys
 * replaced by "[REDACTED]". Does not mutate the input. Circular references
 * are replaced with "[CIRCULAR]" at the back-edge -- the call always
 * terminates.
 */
export function redactSecrets(input: unknown): unknown {
  return redactInner(input, new WeakSet(), 0);
}

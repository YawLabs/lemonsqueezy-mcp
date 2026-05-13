/**
 * Defense-in-depth redactor for audit-logged tool inputs.
 *
 * Today no destructive tool accepts a secret-typed input (webhook secret
 * tools are non-destructive). If `ls_create_webhook` or `ls_update_webhook`
 * is ever flipped to destructiveHint:true, the webhook signing secret would
 * land in the audit log unredacted. This redactor future-proofs the surface:
 * any object key matching SECRET_KEY_RE has its value replaced with
 * "[REDACTED]" before the entry is handed to the logger.
 *
 * Ordinary identifiers (`licenseKey`, `instanceId`, `storeId`, `orderId`,
 * `webhookId`) are NOT matched -- they belong in the audit log so an
 * operator can trace what happened. The regex anchors to the full key name.
 */

const SECRET_KEY_RE = /^(secret|password|token|api[_-]?key|bearer|authorization|signing[_-]?secret)$/i;

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

function redactInner(value: unknown, visited: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return CIRCULAR;
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

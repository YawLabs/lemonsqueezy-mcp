// Scope: the store allowlist (LEMONSQUEEZY_ALLOWED_STORE_IDS) gates tools by
// three layered mechanisms, each closing part of the cross-store leakage gap:
//
//   1. Tools whose input schema carries a `storeId` field are forced to
//      specify a storeId that's in the allowlist (checkStoreScopedToolInput).
//   2. List-by-parent tools without a `storeId` field (e.g. ls_list_prices,
//      ls_list_files) can declare `requiredFilters: ["variantId", ...]` --
//      when the allowlist is active, at least one such filter must be set,
//      forcing the caller to scope by a parent resource ID. This is opt-in
//      per tool because not every list endpoint has a meaningful parent
//      filter (ls_list_affiliates is an example).
//   3. Many destructive ID-targeted tools -- refunds, subscription cancel/
//      update, customer archive, discount/webhook delete, license-key
//      disable, usage records -- route by their own resource ID and bypass
//      the allowlist entirely.
//
// Even with (1) and (2) in place, a caller scoping by a parent ID that
// belongs to a non-allowed store will still get cross-store data back. The
// LemonSqueezy API key's visibility is the true boundary. Pair this allowlist
// with a least-privilege API key scoped to the same stores when the boundary
// needs to be enforced rather than advisory.

export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailError";
  }
}

type Options = {
  allowedStoreIds: Set<string> | null;
  maxRefundAmountCents: number | null;
  rateLimitPerMinute: number | null;
};

let cachedOptions: Options | null = null;
let destructiveTimestamps: number[] = [];

function readNumber(name: string, raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number (got ${JSON.stringify(raw)})`);
  }
  return n;
}

function loadOptions(): Options {
  if (cachedOptions) return cachedOptions;
  const allowed = process.env.LEMONSQUEEZY_ALLOWED_STORE_IDS;
  const allowedSet = allowed
    ? new Set(
        allowed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  cachedOptions = {
    allowedStoreIds: allowedSet && allowedSet.size > 0 ? allowedSet : null,
    maxRefundAmountCents: readNumber(
      "LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS",
      process.env.LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS,
    ),
    rateLimitPerMinute: readNumber(
      "LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT",
      process.env.LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT,
    ),
  };
  return cachedOptions;
}

export function checkStoreAllowed(storeId: string | undefined | null): void {
  if (!storeId) return;
  const o = loadOptions();
  if (!o.allowedStoreIds) return;
  if (!o.allowedStoreIds.has(String(storeId))) {
    throw new GuardrailError(`Store ID ${storeId} is not in LEMONSQUEEZY_ALLOWED_STORE_IDS allowlist`);
  }
}

export function checkRefundAmount(cents: number): void {
  const o = loadOptions();
  if (o.maxRefundAmountCents === null) return;
  if (cents > o.maxRefundAmountCents) {
    throw new GuardrailError(
      `Refund amount ${cents} cents exceeds LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS (${o.maxRefundAmountCents})`,
    );
  }
}

export function checkDestructiveRateLimit(now: number = Date.now()): void {
  const o = loadOptions();
  if (o.rateLimitPerMinute === null) return;
  const cutoff = now - 60_000;
  destructiveTimestamps = destructiveTimestamps.filter((t) => t > cutoff);
  if (destructiveTimestamps.length >= o.rateLimitPerMinute) {
    throw new GuardrailError(`Destructive call rate limit exceeded (${o.rateLimitPerMinute}/min). Wait and retry.`);
  }
  destructiveTimestamps.push(now);
}

export function isStoreAllowlistActive(): boolean {
  return loadOptions().allowedStoreIds !== null;
}

type ScopableTool = {
  inputSchema: { shape: Record<string, unknown> };
  requiredFilters?: readonly string[];
};

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Apply the store allowlist gate to a tool input. When the allowlist is set:
 *
 *   - If the tool's input schema carries a `storeId` field, the call must
 *     specify a valid storeId -- otherwise a list-style call (e.g.
 *     ls_list_subscriptions) without a filter would silently return data
 *     from every store the API key can see.
 *   - If the tool declares `requiredFilters: [...]` (used for list-by-parent
 *     tools that lack a `storeId` field), at least one of those filter keys
 *     must be present with a defined non-empty value in the input. This is
 *     a partial mitigation -- a caller can still scope by a parent ID that
 *     belongs to a non-allowed store, so pair with a scoped API key for
 *     true cross-store enforcement.
 *
 * The full tool object is passed in (not just a boolean) so this function
 * can read both `inputSchema.shape` and `requiredFilters` directly.
 */
export function checkStoreScopedToolInput(tool: ScopableTool, input: Record<string, unknown>): void {
  const toolAcceptsStoreId = "storeId" in tool.inputSchema.shape;
  if (toolAcceptsStoreId) {
    const raw = input.storeId;
    if (raw !== undefined && raw !== null && raw !== "") {
      checkStoreAllowed(String(raw));
    } else if (isStoreAllowlistActive()) {
      throw new GuardrailError("storeId is required when LEMONSQUEEZY_ALLOWED_STORE_IDS is set");
    }
  }

  if (tool.requiredFilters && tool.requiredFilters.length > 0 && isStoreAllowlistActive()) {
    const anyPresent = tool.requiredFilters.some((key) => isPresent(input[key]));
    if (!anyPresent) {
      throw new GuardrailError(
        `At least one of [${tool.requiredFilters.join(", ")}] is required when LEMONSQUEEZY_ALLOWED_STORE_IDS is set`,
      );
    }
  }
}

type ToolForDestructiveCheck = {
  annotations?: { destructiveHint?: boolean };
  isDestructive?: (input: Record<string, unknown>) => boolean;
};

/**
 * Compute whether a specific call to a tool should be treated as destructive.
 * Most tools rely on the static `destructiveHint` annotation; tools whose
 * destructive-ness depends on the input (e.g. `ls_update_license_key` is
 * destructive only when `disabled: true`) can declare an `isDestructive`
 * predicate that overrides the static hint per call.
 */
export function isDestructiveCall(tool: ToolForDestructiveCheck, input: Record<string, unknown>): boolean {
  if (typeof tool.isDestructive === "function") return tool.isDestructive(input);
  return tool.annotations?.destructiveHint === true;
}

export function _resetGuardrailsForTest(): void {
  cachedOptions = null;
  destructiveTimestamps = [];
}

// Scope: the store allowlist (LEMONSQUEEZY_ALLOWED_STORE_IDS) only gates tools
// whose input schema carries a `storeId` field. Many destructive ID-targeted
// tools — refunds, subscription cancel/update, customer archive,
// discount/webhook delete, license-key disable, usage records — route by their
// own resource ID and bypass the allowlist entirely. Pair with a
// least-privilege LemonSqueezy API key scoped to the same stores when the
// boundary needs to be enforced rather than advisory.

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

/**
 * Apply the store allowlist gate to a tool input. When the allowlist is set
 * and the tool accepts a `storeId`, the call must specify it — otherwise a
 * list-style call (e.g. ls_list_subscriptions) without a filter would silently
 * return data from every store the API key can see.
 *
 * `toolAcceptsStoreId` is computed once per registration from the tool's
 * input schema; pass `false` for tools that have no `storeId` field at all.
 */
export function checkStoreScopedToolInput(toolAcceptsStoreId: boolean, input: Record<string, unknown>): void {
  if (!toolAcceptsStoreId) return;
  const raw = input.storeId;
  if (raw !== undefined && raw !== null && raw !== "") {
    checkStoreAllowed(String(raw));
    return;
  }
  if (isStoreAllowlistActive()) {
    throw new GuardrailError("storeId is required when LEMONSQUEEZY_ALLOWED_STORE_IDS is set");
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

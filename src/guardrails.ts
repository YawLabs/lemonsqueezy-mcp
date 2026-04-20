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

export function _resetGuardrailsForTest(): void {
  cachedOptions = null;
  destructiveTimestamps = [];
}

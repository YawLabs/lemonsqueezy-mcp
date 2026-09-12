/**
 * Surface the price a customer is ACTUALLY charged.
 *
 * Lemon Squeezy puts a `unit_price` on every price record and a `price` on
 * every variant, and on a tiered scheme BOTH are vestigial -- they hold a
 * value that is not what anyone pays. A "volume" price with
 * `unit_price: 2000` and `tiers: [{ unit_price: 10000 }]` bills $100.00 per
 * unit, not $20.00.
 *
 * That is not a hypothetical. Three per-seat products in one store read
 * `unit_price: 2000` while actually billing $25, $100 and $200 per seat; an
 * agent reading the obvious field reported all three as "$20/seat" and built
 * margin tables on it. The field is not merely unhelpful, it is CONFIDENTLY
 * WRONG and identical across products that differ -- which is exactly the
 * shape a reader cannot catch by eyeballing one record.
 *
 * So the server computes it. Every price record that flows through the price
 * tools -- and every price record EMBEDDED in another resource's payload via
 * `?include=price` -- gains `effective_unit_price` plus a `_note` saying where
 * the number came from. The raw fields are left untouched: this only ever ADDS
 * keys, so nothing that reads the upstream shape breaks.
 *
 * Which field is authoritative is per-scheme, and the API docs are explicit
 * about it (https://docs.lemonsqueezy.com/api/prices/the-price-object):
 *
 *   * `volume` / `graduated` -- `unit_price` is "not used ... (tier data is
 *     used instead)" and `tiers[]` is returned. TIERED: read the tier.
 *   * `package` -- `tiers` is NOT returned ("a list of pricing tier objects
 *     when using volume and graduated pricing"), and `unit_price` IS charged
 *     -- but for a block of `package_size` units, not for one unit.
 *   * `standard` -- `unit_price` is charged, per unit. Nothing to derive.
 *
 * Treating `package` as tiered is therefore wrong in the most expensive
 * direction: it discards a price the record actually carries and tells the
 * reader not to trust the one correct field.
 */

import type { ApiResponse } from "./api.js";

/**
 * Schemes whose real per-unit price lives in `tiers[]`, not `unit_price`.
 * `package` is deliberately NOT here -- see the header. It charges
 * `unit_price` per block of `package_size`, and gets its own branch.
 */
const TIERED_SCHEMES = new Set(["volume", "graduated"]);

export interface PriceTier {
  last_unit?: number | string;
  unit_price?: number | null;
  unit_price_decimal?: string | null;
  fixed_fee?: number | null;
}

export interface PriceAttributes {
  scheme?: string | null;
  unit_price?: number | null;
  unit_price_decimal?: string | null;
  tiers?: PriceTier[] | null;
  package_size?: number | null;
  setup_fee_enabled?: boolean | null;
  setup_fee?: number | null;
  [k: string]: unknown;
}

export interface EffectivePrice {
  /** Cents actually charged per unit, or null when it cannot be determined. */
  effective_unit_price: number | null;
  /** Where the number came from, in words, for a reader skimming the payload. */
  effective_unit_price_note: string;
  /** Present and true only when `unit_price` is charged to nobody. */
  unit_price_is_not_charged?: true;
  /**
   * Present and true only on `package` pricing with `package_size` > 1, where
   * `unit_price` IS charged but buys a whole block of units. Without this a
   * reader treats a $50-per-5-seats price as $50 per seat -- the same class of
   * misread the tiered flag above exists to prevent, one scheme over.
   */
  unit_price_is_per_package?: true;
}

/**
 * Read a price out of a decimal/integer field pair. `unit_price_decimal` wins
 * when present: LS uses it for sub-cent precision, and the integer
 * `unit_price` is rounded (or null) there, so preferring the integer silently
 * loses fractions of a cent.
 */
function numericPrice(
  decimal: string | null | undefined,
  integer: number | null | undefined,
): { value: number; source: "unit_price_decimal" | "unit_price" } | null {
  if (typeof decimal === "string" && decimal.trim() !== "") {
    const parsed = Number(decimal);
    if (Number.isFinite(parsed)) return { value: parsed, source: "unit_price_decimal" };
  }
  if (typeof integer === "number" && Number.isFinite(integer)) return { value: integer, source: "unit_price" };
  return null;
}

/** Pick a tier's price. */
function tierPrice(tier: PriceTier): number | null {
  return numericPrice(tier.unit_price_decimal, tier.unit_price)?.value ?? null;
}

/**
 * Fees that ride ALONGSIDE the per-unit rate: a tier's `fixed_fee` and the
 * record's `setup_fee`.
 *
 * They are deliberately not folded into `effective_unit_price` -- that field
 * is a per-unit rate and a per-period or one-off fee is not -- but dropping
 * them in silence from a number documented as "actually charged" is how the
 * next wrong quote gets built. So they are named in the note whenever they
 * are non-zero, and stay out of the arithmetic.
 */
function feeNote(attrs: PriceAttributes, tier?: PriceTier): string {
  const parts: string[] = [];
  if (tier && typeof tier.fixed_fee === "number" && tier.fixed_fee !== 0) {
    parts.push(`this tier also carries a fixed_fee of ${tier.fixed_fee} cents per billing period`);
  }
  if (typeof attrs.setup_fee === "number" && attrs.setup_fee !== 0 && attrs.setup_fee_enabled !== false) {
    parts.push(`a one-off setup_fee of ${attrs.setup_fee} cents applies`);
  }
  if (parts.length === 0) return "";
  return ` NOTE: ${parts.join(", and ")} -- neither is included in effective_unit_price.`;
}

/**
 * Compute the charged per-unit price for one price record.
 *
 * Tiered schemes: the FIRST tier is reported. For volume/graduated pricing the
 * charged rate depends on quantity, so a single number cannot be complete --
 * the first tier is what a 1-seat subscription pays, which is the figure a
 * per-seat margin calculation needs, and the note says so rather than
 * pretending the answer is quantity-independent.
 */
export function computeEffectivePrice(attrs: PriceAttributes): EffectivePrice {
  const scheme = typeof attrs.scheme === "string" ? attrs.scheme : "";
  const tiers = Array.isArray(attrs.tiers) ? attrs.tiers : null;

  if (TIERED_SCHEMES.has(scheme)) {
    if (tiers && tiers.length > 0) {
      const firstTier = tiers[0] as PriceTier;
      const first = tierPrice(firstTier);
      if (first !== null) {
        return {
          effective_unit_price: first,
          effective_unit_price_note:
            `scheme "${scheme}": charged price comes from tiers[0].unit_price (${first} cents). ` +
            `The record's own unit_price (${String(attrs.unit_price)}) is NOT charged. ` +
            (tiers.length > 1
              ? `${tiers.length} tiers exist, so the rate varies with quantity -- this is the first tier.`
              : "A single tier covers all quantities.") +
            feeNote(attrs, firstTier),
          unit_price_is_not_charged: true,
        };
      }
    }
    return {
      effective_unit_price: null,
      effective_unit_price_note:
        `scheme "${scheme}" is tiered but no usable tiers[] were returned, so the charged price ` +
        `cannot be determined here. Do NOT fall back to unit_price -- it is not the charged amount.`,
      unit_price_is_not_charged: true,
    };
  }

  // `package`: unit_price IS charged, but it buys `package_size` units. No
  // `unit_price_is_not_charged` flag -- that would be a lie here; the field
  // holds a real charge, it is just not a per-unit one.
  if (scheme === "package") {
    const perPackage = numericPrice(attrs.unit_price_decimal, attrs.unit_price);
    if (perPackage === null) {
      return {
        effective_unit_price: null,
        effective_unit_price_note: `scheme "package": no usable price field on this record, so the charged price cannot be determined here.`,
      };
    }
    const declared = attrs.package_size;
    const sizeIsUsable = typeof declared === "number" && Number.isFinite(declared) && declared > 0;
    const size = sizeIsUsable ? declared : 1;
    const perUnit = perPackage.value / size;
    const parts = [
      `scheme "package": the customer is charged ${perPackage.value} cents (from ${perPackage.source}) per package of ${size} unit(s).`,
    ];
    if (size !== 1) parts.push(`So the per-unit price is ${perUnit} cents.`);
    if (!sizeIsUsable) parts.push(`package_size was ${String(declared)} on this record, so 1 was assumed.`);
    parts.push("unit_price IS charged here -- it is the price of a whole package, not of one unit.");
    return {
      effective_unit_price: perUnit,
      effective_unit_price_note: parts.join(" ") + feeNote(attrs),
      ...(size !== 1 ? { unit_price_is_per_package: true as const } : {}),
    };
  }

  // "standard" (and anything unrecognised that still carries a flat price):
  // unit_price IS the charged amount.
  const flat = numericPrice(attrs.unit_price_decimal, attrs.unit_price);
  if (flat !== null) {
    return {
      effective_unit_price: flat.value,
      effective_unit_price_note:
        `scheme "${scheme || "standard"}": flat price, ` +
        (flat.source === "unit_price_decimal" ? "from unit_price_decimal." : "unit_price is the charged amount.") +
        feeNote(attrs),
    };
  }
  return {
    effective_unit_price: null,
    effective_unit_price_note: `scheme "${scheme || "unknown"}": no usable price field on this record.`,
  };
}

/** One JSON:API resource object, loosely typed -- we only touch `attributes`. */
interface Resource {
  type?: unknown;
  attributes?: unknown;
  [k: string]: unknown;
}

function annotateResource(resource: unknown): unknown {
  if (resource === null || typeof resource !== "object") return resource;
  const r = resource as Resource;
  if (r.attributes === null || typeof r.attributes !== "object") return resource;
  const attrs = r.attributes as PriceAttributes;
  return { ...r, attributes: { ...attrs, ...computeEffectivePrice(attrs) } };
}

/**
 * Annotate a resource ONLY if it is a price record. Used for `included[]`,
 * which is a mixed bag -- a price payload's includes are variants, and a
 * subscription item's includes can be a subscription, a price and usage
 * records in one array.
 */
function annotateIfPrice(resource: unknown): unknown {
  if (resource === null || typeof resource !== "object") return resource;
  if ((resource as Resource).type !== "prices") return resource;
  return annotateResource(resource);
}

function annotateIncluded(body: Record<string, unknown>): Record<string, unknown> {
  const included = body.included;
  if (!Array.isArray(included)) return body;
  return { ...body, included: included.map(annotateIfPrice) };
}

/**
 * Annotate a payload whose PRIMARY data is price records. Handles both shapes
 * the API returns: `{ data: {...} }` from a get and `{ data: [...] }` from a
 * list, plus any price records sitting in `included[]`. Anything else passes
 * through untouched -- an error body must not be reshaped on its way to the
 * caller.
 */
export function annotatePricePayload(body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;
  const b = body as Record<string, unknown>;
  let out = b;
  if (Array.isArray(b.data)) out = { ...b, data: b.data.map(annotateResource) };
  else if (b.data !== null && typeof b.data === "object") out = { ...b, data: annotateResource(b.data) };
  return annotateIncluded(out);
}

/**
 * Annotate price records EMBEDDED in another resource's payload -- what
 * `?include=price` on a subscription item returns. The primary `data` is left
 * alone: it is a subscription item, not a price, and computing an
 * `effective_unit_price` for it would be inventing a field.
 *
 * Without this, the seat-based-billing path (subscription item -> its price)
 * hands back a raw, unwarned `unit_price` while the price tools two calls
 * away warn about exactly that field.
 */
export function annotateEmbeddedPrices(body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;
  return annotateIncluded(body as Record<string, unknown>);
}

type Handler = (input: Record<string, unknown>) => Promise<ApiResponse>;

/**
 * Wrap a handler so the price records in its response carry the price actually
 * charged. `annotate` says WHERE those records are: the primary data (price
 * endpoints) or only `included[]` (everything else).
 *
 * Failures pass through untouched: an error body has no price records to
 * annotate, and reshaping one would only obscure the error.
 */
function withPriceAnnotation<H extends Handler>(handler: H, annotate: (body: unknown) => unknown): H {
  const wrapped = async (input: Record<string, unknown>): Promise<ApiResponse> => {
    const res = await handler(input);
    if (!res.ok || res.data === undefined) return res;
    return { ...res, data: annotate(res.data) };
  };
  // Preserve any metadata the factory attached. `listHandler` carries
  // `filterMap`, which the allowlist-alignment invariants in
  // tools/tools.test.ts introspect -- and those invariants SKIP a handler
  // that has none, so dropping it here would quietly remove the tool from
  // the gate rather than fail it. tools.test.ts asserts the property survives.
  return Object.assign(wrapped, handler) as unknown as H;
}

/** For endpoints whose primary data IS price records. */
export function withEffectivePrice<H extends Handler>(handler: H): H {
  return withPriceAnnotation(handler, annotatePricePayload);
}

/** For endpoints that can carry price records in `included[]` via `?include=price`. */
export function withEmbeddedEffectivePrice<H extends Handler>(handler: H): H {
  return withPriceAnnotation(handler, annotateEmbeddedPrices);
}

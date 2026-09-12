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
 * tools gains `effective_unit_price` plus a `_note` saying where the number
 * came from, and tiered records get `unit_price_is_not_charged: true`. The
 * raw fields are left untouched -- this only ever ADDS keys, so nothing that
 * reads the upstream shape breaks.
 */

/** Schemes whose real per-unit price lives in `tiers[]`, not `unit_price`. */
const TIERED_SCHEMES = new Set(["volume", "graduated", "package"]);

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
  [k: string]: unknown;
}

export interface EffectivePrice {
  /** Cents actually charged per unit, or null when it cannot be determined. */
  effective_unit_price: number | null;
  /** Where the number came from, in words, for a reader skimming the payload. */
  effective_unit_price_note: string;
  /** Present and true only when `unit_price` would mislead. */
  unit_price_is_not_charged?: true;
}

/**
 * Pick a tier's price. `unit_price_decimal` wins when present: LS uses it for
 * sub-cent precision, and the integer `unit_price` is rounded (or null)
 * there, so preferring the integer silently loses fractions of a cent.
 */
function tierPrice(tier: PriceTier): number | null {
  if (typeof tier.unit_price_decimal === "string" && tier.unit_price_decimal.trim() !== "") {
    const parsed = Number(tier.unit_price_decimal);
    if (Number.isFinite(parsed)) return parsed;
  }
  return typeof tier.unit_price === "number" ? tier.unit_price : null;
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
      const first = tierPrice(tiers[0] as PriceTier);
      if (first !== null) {
        return {
          effective_unit_price: first,
          effective_unit_price_note:
            `scheme "${scheme}": charged price comes from tiers[0].unit_price (${first} cents). ` +
            `The record's own unit_price (${String(attrs.unit_price)}) is NOT charged. ` +
            (tiers.length > 1
              ? `${tiers.length} tiers exist, so the rate varies with quantity -- this is the first tier.`
              : "A single tier covers all quantities."),
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

  // "standard" (and anything unrecognised that still carries a flat price):
  // unit_price IS the charged amount.
  if (typeof attrs.unit_price_decimal === "string" && attrs.unit_price_decimal.trim() !== "") {
    const parsed = Number(attrs.unit_price_decimal);
    if (Number.isFinite(parsed)) {
      return {
        effective_unit_price: parsed,
        effective_unit_price_note: `scheme "${scheme || "standard"}": flat price, from unit_price_decimal.`,
      };
    }
  }
  if (typeof attrs.unit_price === "number") {
    return {
      effective_unit_price: attrs.unit_price,
      effective_unit_price_note: `scheme "${scheme || "standard"}": flat price, unit_price is the charged amount.`,
    };
  }
  return {
    effective_unit_price: null,
    effective_unit_price_note: `scheme "${scheme || "unknown"}": no usable price field on this record.`,
  };
}

/** One JSON:API resource object, loosely typed -- we only touch `attributes`. */
interface Resource {
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
 * Annotate a price payload in place of the raw one. Handles both shapes the
 * API returns: `{ data: {...} }` from a get and `{ data: [...] }` from a list.
 * Anything else passes through untouched -- an error body must not be
 * reshaped on its way to the caller.
 */
export function annotatePricePayload(body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;
  const b = body as { data?: unknown };
  if (Array.isArray(b.data)) return { ...b, data: b.data.map(annotateResource) };
  if (b.data !== null && typeof b.data === "object") return { ...b, data: annotateResource(b.data) };
  return body;
}

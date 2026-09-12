import { z } from "zod";
import type { ApiResponse } from "../api.js";
import { crossStoreFilterNote, getHandler, listHandler, lsIdSchema } from "../api.js";
import { annotatePricePayload } from "../effective-price.js";

/**
 * Wrap a price handler so every record carries the price actually charged.
 *
 * LS returns a `unit_price` on every price record, and on a tiered scheme it
 * is NOT what the customer pays -- the real number is in `tiers[]`. Reading
 * the obvious field is a mistake the payload actively invites, so the server
 * does the derivation instead of documenting it and hoping. See
 * ../effective-price.ts for the full rationale and the incident behind it.
 *
 * Failures pass through untouched: an error body has no price records to
 * annotate, and reshaping one would only obscure the error.
 */
function withEffectivePrice<H extends (input: Record<string, unknown>) => Promise<ApiResponse>>(handler: H): H {
  const wrapped = async (input: Record<string, unknown>): Promise<ApiResponse> => {
    const res = await handler(input);
    if (!res.ok || res.data === undefined) return res;
    return { ...res, data: annotatePricePayload(res.data) };
  };
  // Preserve any metadata the factory attached (listHandler carries
  // `filterMap`, which tools.test.ts introspects for the allowlist-alignment
  // invariant -- dropping it would silently break that gate).
  return Object.assign(wrapped, handler) as unknown as H;
}

// Single source of truth: the same array drives both the runtime allowlist
// gate (`requiredFilters`) and the disclosure in the tool description, so a
// change to one cannot leave the other stale.
const LIST_PRICES_FILTERS = ["variantId"] as const;

export const priceTools = [
  {
    name: "ls_get_price",
    authorityClass: "read" as const,
    description:
      "Get a specific price by ID, including amount, currency, and billing interval. " +
      "Every record is annotated with `effective_unit_price` (cents actually charged) and " +
      "`effective_unit_price_note`. READ THAT, not `unit_price`: on a tiered scheme " +
      "(volume/graduated/package) `unit_price` is vestigial and is NOT the charged amount " +
      "-- the real per-unit price lives in `tiers[]`, and such records also carry " +
      "`unit_price_is_not_charged: true`.",
    annotations: {
      title: "Get price",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      priceId: lsIdSchema.describe("The price ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'variant')"),
    }),
    handler: withEffectivePrice(getHandler("/prices", "priceId")),
  },
  {
    name: "ls_list_prices",
    authorityClass: "read" as const,
    description: `List all prices, optionally filtered by variant. Results are paginated — check meta.page in the response for currentPage, lastPage, and total. Every record is annotated with \`effective_unit_price\` (cents actually charged) and \`effective_unit_price_note\`. READ THAT, not \`unit_price\`: on a tiered scheme (volume/graduated/package) \`unit_price\` is vestigial and is NOT the charged amount -- the real per-unit price lives in \`tiers[]\`, and such records also carry \`unit_price_is_not_charged: true\`. NOTE that several price records can exist per variant; the CURRENT one is the newest by \`created_at\` (results are sorted newest-first). ${crossStoreFilterNote(LIST_PRICES_FILTERS)}`,
    annotations: {
      title: "List prices",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      variantId: lsIdSchema.optional().describe("Filter by variant ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'variant')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    requiredFilters: LIST_PRICES_FILTERS,
    handler: withEffectivePrice(listHandler("/prices", { variantId: "variant_id" })),
  },
] as const;

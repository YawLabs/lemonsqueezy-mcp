import { z } from "zod";
import { crossStoreFilterNote, getHandler, listHandler, lsIdSchema } from "../api.js";

// Single source of truth: the same array drives both the runtime allowlist
// gate (`requiredFilters`) and the disclosure in the tool description, so a
// change to one cannot leave the other stale.
const LIST_PRICES_FILTERS = ["variantId"] as const;

export const priceTools = [
  {
    name: "ls_get_price",
    authorityClass: "read" as const,
    description: "Get a specific price by ID, including amount, currency, and billing interval.",
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
    handler: getHandler("/prices", "priceId"),
  },
  {
    name: "ls_list_prices",
    authorityClass: "read" as const,
    description: `List all prices, optionally filtered by variant. Results are paginated — check meta.page in the response for currentPage, lastPage, and total. ${crossStoreFilterNote(LIST_PRICES_FILTERS)}`,
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
    handler: listHandler("/prices", { variantId: "variant_id" }),
  },
] as const;

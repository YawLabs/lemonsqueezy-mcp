import { z } from "zod";
import { getHandler, listHandler, lsIdSchema } from "../api.js";

export const variantTools = [
  {
    name: "ls_get_variant",
    authorityClass: "read" as const,
    description: "Get a specific product variant by ID, including price, billing interval, and trial settings.",
    annotations: {
      title: "Get variant",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      variantId: lsIdSchema.describe("The variant ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'product,files')"),
    }),
    handler: getHandler("/variants", "variantId"),
  },
  {
    name: "ls_list_variants",
    authorityClass: "read" as const,
    description:
      "List all variants, optionally filtered by product. Results are paginated — check meta.page in the response for currentPage, lastPage, and total. Cross-store note: when LEMONSQUEEZY_ALLOWED_STORE_IDS is set, this tool requires at least one of: productId. Even with that set, pair with a scoped LemonSqueezy API key for true cross-store enforcement -- the API key's visibility is the true boundary.",
    annotations: {
      title: "List variants",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      productId: lsIdSchema.optional().describe("Filter by product ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'product,files')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    requiredFilters: ["productId"] as const,
    handler: listHandler("/variants", { productId: "product_id" }),
  },
] as const;

import { z } from "zod";
import { getHandler, listHandler, lsIdSchema } from "../api.js";

export const storeTools = [
  {
    name: "ls_get_store",
    authorityClass: "read" as const,
    description: "Get a specific store by ID, including name, slug, currency, and sales statistics.",
    annotations: {
      title: "Get store",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: lsIdSchema.describe("The store ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'products,discounts,license-keys,subscriptions,webhooks')",
        ),
    }),
    handler: getHandler("/stores", "storeId"),
  },
  {
    name: "ls_list_stores",
    authorityClass: "read" as const,
    description:
      "List all stores for the authenticated user. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List stores",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      include: z
        .string()
        .max(10000)
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'products,discounts,license-keys,subscriptions,webhooks')",
        ),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/stores"),
  },
] as const;

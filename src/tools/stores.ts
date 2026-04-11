import { z } from "zod";
import { getHandler, listHandler } from "../api.js";

export const storeTools = [
  {
    name: "ls_get_store",
    description: "Get a specific store by ID, including name, slug, currency, and sales statistics.",
    annotations: {
      title: "Get store",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().describe("The store ID"),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'products,discounts,license-keys,subscriptions,webhooks')",
        ),
    }),
    handler: getHandler("/stores", "storeId"),
  },
  {
    name: "ls_list_stores",
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

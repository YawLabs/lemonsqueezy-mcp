import { z } from "zod";
import { getHandler, listHandler, lsIdSchema } from "../api.js";

export const productTools = [
  {
    name: "ls_get_product",
    authorityClass: "read" as const,
    description: "Get a specific product by ID, including name, description, price, and status.",
    annotations: {
      title: "Get product",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      productId: lsIdSchema.describe("The product ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,variants')"),
    }),
    handler: getHandler("/products", "productId"),
  },
  {
    name: "ls_list_products",
    authorityClass: "read" as const,
    description:
      "List all products, optionally filtered by store. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List products",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: lsIdSchema.optional().describe("Filter by store ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,variants')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/products", { storeId: "store_id" }),
  },
] as const;

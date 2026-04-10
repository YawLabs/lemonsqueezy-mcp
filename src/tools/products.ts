import { z } from "zod";
import { apiGet, buildQuery } from "../api.js";

export const productTools = [
  {
    name: "ls_get_product",
    description: "Get a specific product by ID, including name, description, price, and status.",
    annotations: {
      title: "Get product",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      productId: z.string().describe("The product ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'store,variants')"),
    }),
    handler: async (input: { productId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/products/${input.productId}${query}`);
    },
  },
  {
    name: "ls_list_products",
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
      storeId: z.string().optional().describe("Filter by store ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'store,variants')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: { storeId?: string; include?: string; pageNumber?: number; pageSize?: number }) => {
      const filter: Record<string, string> = {};
      if (input.storeId) filter.store_id = input.storeId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/products${query}`);
    },
  },
] as const;

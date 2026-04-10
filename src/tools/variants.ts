import { z } from "zod";
import { apiGet, buildQuery } from "../api.js";

export const variantTools = [
  {
    name: "ls_get_variant",
    description: "Get a specific product variant by ID, including price, billing interval, and trial settings.",
    annotations: {
      title: "Get variant",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      variantId: z.string().describe("The variant ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'product,files')"),
    }),
    handler: async (input: { variantId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/variants/${input.variantId}${query}`);
    },
  },
  {
    name: "ls_list_variants",
    description:
      "List all variants, optionally filtered by product. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List variants",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      productId: z.string().optional().describe("Filter by product ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'product,files')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: { productId?: string; include?: string; pageNumber?: number; pageSize?: number }) => {
      const filter: Record<string, string> = {};
      if (input.productId) filter.product_id = input.productId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/variants${query}`);
    },
  },
] as const;

import { z } from "zod";
import { apiGet, buildQuery } from "../api.js";

export const priceTools = [
  {
    name: "ls_get_price",
    description: "Get a specific price by ID, including amount, currency, and billing interval.",
    annotations: {
      title: "Get price",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      priceId: z.string().describe("The price ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'variant')"),
    }),
    handler: async (input: { priceId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/prices/${input.priceId}${query}`);
    },
  },
  {
    name: "ls_list_prices",
    description:
      "List all prices, optionally filtered by variant. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List prices",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      variantId: z.string().optional().describe("Filter by variant ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'variant')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: { variantId?: string; include?: string; pageNumber?: number; pageSize?: number }) => {
      const filter: Record<string, string> = {};
      if (input.variantId) filter.variant_id = input.variantId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/prices${query}`);
    },
  },
] as const;

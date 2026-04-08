import { z } from "zod";
import { apiGet, buildQuery } from "../api.js";

export const discountRedemptionTools = [
  {
    name: "ls_get_discount_redemption",
    description: "Get a specific discount redemption by ID, showing when and where a discount was used.",
    annotations: {
      title: "Get discount redemption",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      discountRedemptionId: z.string().describe("The discount redemption ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'discount,order')"),
    }),
    handler: async (input: { discountRedemptionId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/discount-redemptions/${input.discountRedemptionId}${query}`);
    },
  },
  {
    name: "ls_list_discount_redemptions",
    description: "List all discount redemptions, optionally filtered by discount or order.",
    annotations: {
      title: "List discount redemptions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      discountId: z.string().optional().describe("Filter by discount ID"),
      orderId: z.string().optional().describe("Filter by order ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'discount,order')"),
      pageNumber: z.number().optional().describe("Page number (1-indexed)"),
      pageSize: z.number().optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      discountId?: string;
      orderId?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.discountId) filter.discount_id = input.discountId;
      if (input.orderId) filter.order_id = input.orderId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/discount-redemptions${query}`);
    },
  },
] as const;

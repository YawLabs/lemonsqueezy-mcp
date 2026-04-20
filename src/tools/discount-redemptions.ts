import { z } from "zod";
import { getHandler, listHandler } from "../api.js";

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
      discountRedemptionId: z.string().max(10000).describe("The discount redemption ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'discount,order')"),
    }),
    handler: getHandler("/discount-redemptions", "discountRedemptionId"),
  },
  {
    name: "ls_list_discount_redemptions",
    description:
      "List all discount redemptions, optionally filtered by discount or order. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List discount redemptions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      discountId: z.string().max(10000).optional().describe("Filter by discount ID"),
      orderId: z.string().max(10000).optional().describe("Filter by order ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'discount,order')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/discount-redemptions", { discountId: "discount_id", orderId: "order_id" }),
  },
] as const;

import { z } from "zod";
import { apiGet, buildQuery } from "../api.js";

export const orderItemTools = [
  {
    name: "ls_get_order_item",
    description: "Get a specific order item by ID, including product name, variant, price, and quantity.",
    annotations: {
      title: "Get order item",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      orderItemId: z.string().describe("The order item ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'order,product,variant')"),
    }),
    handler: async (input: { orderItemId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/order-items/${input.orderItemId}${query}`);
    },
  },
  {
    name: "ls_list_order_items",
    description: "List all order items, optionally filtered by order or product.",
    annotations: {
      title: "List order items",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      orderId: z.string().optional().describe("Filter by order ID"),
      productId: z.string().optional().describe("Filter by product ID"),
      variantId: z.string().optional().describe("Filter by variant ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'order,product,variant')"),
      pageNumber: z.number().optional().describe("Page number (1-indexed)"),
      pageSize: z.number().optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      orderId?: string;
      productId?: string;
      variantId?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.orderId) filter.order_id = input.orderId;
      if (input.productId) filter.product_id = input.productId;
      if (input.variantId) filter.variant_id = input.variantId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/order-items${query}`);
    },
  },
] as const;

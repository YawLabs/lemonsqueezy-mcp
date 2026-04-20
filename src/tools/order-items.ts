import { z } from "zod";
import { getHandler, listHandler } from "../api.js";

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
      orderItemId: z.string().max(10000).describe("The order item ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'order,product,variant')"),
    }),
    handler: getHandler("/order-items", "orderItemId"),
  },
  {
    name: "ls_list_order_items",
    description:
      "List all order items, optionally filtered by order or product. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List order items",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      orderId: z.string().max(10000).optional().describe("Filter by order ID"),
      productId: z.string().max(10000).optional().describe("Filter by product ID"),
      variantId: z.string().max(10000).optional().describe("Filter by variant ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'order,product,variant')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/order-items", { orderId: "order_id", productId: "product_id", variantId: "variant_id" }),
  },
] as const;

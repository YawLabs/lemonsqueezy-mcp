import { z } from "zod";
import { getHandler, listHandler, lsIdSchema } from "../api.js";

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
      orderItemId: lsIdSchema.describe("The order item ID"),
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
      "List all order items, optionally filtered by order or product. Results are paginated — check meta.page in the response for currentPage, lastPage, and total. Cross-store note: when LEMONSQUEEZY_ALLOWED_STORE_IDS is set, this tool requires at least one of: orderId, productId, variantId. Even with that set, pair with a scoped LemonSqueezy API key for true cross-store enforcement -- the API key's visibility is the true boundary.",
    annotations: {
      title: "List order items",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      orderId: lsIdSchema.optional().describe("Filter by order ID"),
      productId: lsIdSchema.optional().describe("Filter by product ID"),
      variantId: lsIdSchema.optional().describe("Filter by variant ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'order,product,variant')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    requiredFilters: ["orderId", "productId", "variantId"] as const,
    handler: listHandler("/order-items", { orderId: "order_id", productId: "product_id", variantId: "variant_id" }),
  },
] as const;

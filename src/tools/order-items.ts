import { z } from "zod";
import { crossStoreFilterNote, getHandler, listHandler, lsIdSchema } from "../api.js";

// Drives both `requiredFilters` and the description disclosure -- see prices.ts.
const LIST_ORDER_ITEMS_FILTERS = ["orderId", "productId", "variantId"] as const;

export const orderItemTools = [
  {
    name: "ls_get_order_item",
    authorityClass: "read" as const,
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
    authorityClass: "read" as const,
    description: `List all order items, optionally filtered by order or product. Results are paginated — check meta.page in the response for currentPage, lastPage, and total. ${crossStoreFilterNote(LIST_ORDER_ITEMS_FILTERS)}`,
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
    requiredFilters: LIST_ORDER_ITEMS_FILTERS,
    handler: listHandler("/order-items", { orderId: "order_id", productId: "product_id", variantId: "variant_id" }),
  },
] as const;

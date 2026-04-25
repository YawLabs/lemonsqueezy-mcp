import { z } from "zod";
import { apiGet, apiPatch, encodePath, getHandler, listHandler } from "../api.js";

export const subscriptionItemTools = [
  {
    name: "ls_get_subscription_item",
    description: "Get a specific subscription item by ID, including quantity, pricing, and associated subscription.",
    annotations: {
      title: "Get subscription item",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionItemId: z.string().max(10000).describe("The subscription item ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'subscription,price,usage-records')"),
    }),
    handler: getHandler("/subscription-items", "subscriptionItemId"),
  },
  {
    name: "ls_list_subscription_items",
    description:
      "List all subscription items, optionally filtered by subscription or price. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List subscription items",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionId: z.string().max(10000).optional().describe("Filter by subscription ID"),
      priceId: z.string().max(10000).optional().describe("Filter by price ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'subscription,price,usage-records')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/subscription-items", { subscriptionId: "subscription_id", priceId: "price_id" }),
  },
  {
    name: "ls_update_subscription_item",
    description: "Update a subscription item's quantity. Used for seat-based or quantity-based billing.",
    annotations: {
      title: "Update subscription item",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionItemId: z.string().max(10000).describe("The subscription item ID to update"),
      quantity: z.number().int().min(1).describe("New quantity for the subscription item"),
    }),
    handler: async (input: { subscriptionItemId: string; quantity: number }) => {
      return apiPatch(`/subscription-items/${encodePath(input.subscriptionItemId)}`, {
        data: {
          type: "subscription-items",
          id: input.subscriptionItemId,
          attributes: { quantity: input.quantity },
        },
      });
    },
  },
  {
    name: "ls_get_subscription_item_usage",
    description: "Get the current usage for a metered subscription item within the current billing period.",
    annotations: {
      title: "Get subscription item usage",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionItemId: z.string().max(10000).describe("The subscription item ID"),
    }),
    handler: async (input: { subscriptionItemId: string }) => {
      return apiGet(`/subscription-items/${encodePath(input.subscriptionItemId)}/current-usage`);
    },
  },
] as const;

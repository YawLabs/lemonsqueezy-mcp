import { z } from "zod";
import { apiGet, apiPatch, buildQuery } from "../api.js";

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
      subscriptionItemId: z.string().describe("The subscription item ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'subscription,price,usage-records')"),
    }),
    handler: async (input: { subscriptionItemId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/subscription-items/${input.subscriptionItemId}${query}`);
    },
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
      subscriptionId: z.string().optional().describe("Filter by subscription ID"),
      priceId: z.string().optional().describe("Filter by price ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'subscription,price,usage-records')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      subscriptionId?: string;
      priceId?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.subscriptionId) filter.subscription_id = input.subscriptionId;
      if (input.priceId) filter.price_id = input.priceId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/subscription-items${query}`);
    },
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
      subscriptionItemId: z.string().describe("The subscription item ID to update"),
      quantity: z.number().int().min(1).describe("New quantity for the subscription item"),
    }),
    handler: async (input: { subscriptionItemId: string; quantity: number }) => {
      return apiPatch(`/subscription-items/${input.subscriptionItemId}`, {
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
      subscriptionItemId: z.string().describe("The subscription item ID"),
    }),
    handler: async (input: { subscriptionItemId: string }) => {
      return apiGet(`/subscription-items/${input.subscriptionItemId}/current-usage`);
    },
  },
] as const;

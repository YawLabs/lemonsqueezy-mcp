import { z } from "zod";
import { apiGet, apiPatch, crossStoreFilterNote, encodePath, getHandler, listHandler, lsIdSchema } from "../api.js";
// A subscription item is the only resource with a `price` relationship, so
// `?include=price` here is the one path outside the price tools that hands
// back price records -- and it is the seat-based-billing path, where a raw
// `unit_price` is most likely to be read as the per-seat rate. Annotate the
// embedded records so this route carries the same warning the price tools do.
import { withEmbeddedEffectivePrice } from "../effective-price.js";

// Drives both `requiredFilters` and the description disclosure -- see prices.ts.
const LIST_SUBSCRIPTION_ITEMS_FILTERS = ["subscriptionId", "priceId"] as const;

export const subscriptionItemTools = [
  {
    name: "ls_get_subscription_item",
    authorityClass: "read" as const,
    description:
      "Get a specific subscription item by ID, including quantity, pricing, and associated subscription. " +
      "Pass `include=price` for the price record behind it; embedded price records are annotated with " +
      "`effective_unit_price` (cents actually charged per unit) -- read that, not the record's `unit_price`, " +
      "which is vestigial on tiered pricing and per-package on package pricing.",
    annotations: {
      title: "Get subscription item",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionItemId: lsIdSchema.describe("The subscription item ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'subscription,price,usage-records')"),
    }),
    handler: withEmbeddedEffectivePrice(getHandler("/subscription-items", "subscriptionItemId")),
  },
  {
    name: "ls_list_subscription_items",
    authorityClass: "read" as const,
    description: `List all subscription items, optionally filtered by subscription or price. Results are paginated — check meta.page in the response for currentPage, lastPage, and total. Pass \`include=price\` for the price records behind them; embedded price records are annotated with \`effective_unit_price\` (cents actually charged per unit) -- read that, not a record's \`unit_price\`, which is vestigial on tiered pricing and per-package on package pricing. ${crossStoreFilterNote(LIST_SUBSCRIPTION_ITEMS_FILTERS)}`,
    annotations: {
      title: "List subscription items",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionId: lsIdSchema.optional().describe("Filter by subscription ID"),
      priceId: lsIdSchema.optional().describe("Filter by price ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'subscription,price,usage-records')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    requiredFilters: LIST_SUBSCRIPTION_ITEMS_FILTERS,
    handler: withEmbeddedEffectivePrice(
      listHandler("/subscription-items", { subscriptionId: "subscription_id", priceId: "price_id" }),
    ),
  },
  {
    name: "ls_update_subscription_item",
    authorityClass: "recurring" as const,
    description: "Update a subscription item's quantity. Used for seat-based or quantity-based billing.",
    annotations: {
      title: "Update subscription item",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionItemId: lsIdSchema.describe("The subscription item ID to update"),
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
    authorityClass: "read" as const,
    description: "Get the current usage for a metered subscription item within the current billing period.",
    annotations: {
      title: "Get subscription item usage",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionItemId: lsIdSchema.describe("The subscription item ID"),
    }),
    handler: async (input: { subscriptionItemId: string }) => {
      return apiGet(`/subscription-items/${encodePath(input.subscriptionItemId)}/current-usage`);
    },
  },
] as const;

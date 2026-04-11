import { z } from "zod";
import { apiDelete, apiPatch, getHandler, listHandler } from "../api.js";

export const subscriptionTools = [
  {
    name: "ls_get_subscription",
    description:
      "Get a specific subscription by ID, including status, billing interval, renewal date, and customer info.",
    annotations: {
      title: "Get subscription",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionId: z.string().describe("The subscription ID"),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order,order-item,product,variant,subscription-items,subscription-invoices')",
        ),
    }),
    handler: getHandler("/subscriptions", "subscriptionId"),
  },
  {
    name: "ls_list_subscriptions",
    description:
      "List all subscriptions, optionally filtered by store, order, product, variant, or status. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List subscriptions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().optional().describe("Filter by store ID"),
      orderId: z.string().optional().describe("Filter by order ID"),
      orderItemId: z.string().optional().describe("Filter by order item ID"),
      productId: z.string().optional().describe("Filter by product ID"),
      variantId: z.string().optional().describe("Filter by variant ID"),
      userEmail: z.string().optional().describe("Filter by user email"),
      status: z
        .enum(["on_trial", "active", "paused", "past_due", "unpaid", "cancelled", "expired"])
        .optional()
        .describe("Filter by subscription status"),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order,order-item,product,variant')",
        ),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/subscriptions", {
      storeId: "store_id",
      orderId: "order_id",
      orderItemId: "order_item_id",
      productId: "product_id",
      variantId: "variant_id",
      userEmail: "user_email",
      status: "status",
    }),
  },
  {
    name: "ls_update_subscription",
    description:
      "Update a subscription. Can change the variant (plan switch), pause/unpause, set billing anchor, or update invoice details. Use ls_cancel_subscription for cancellation.",
    annotations: {
      title: "Update subscription",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionId: z.string().describe("The subscription ID to update"),
      variantId: z.string().optional().describe("New variant ID for plan switching"),
      pause: z
        .enum(["void", "free", "resume"])
        .optional()
        .describe("Pause mode: 'void' (pause, skip billing), 'free' (pause, keep access free), or 'resume' to unpause"),
      cancelled: z
        .literal(false)
        .optional()
        .describe(
          "Set to false to un-cancel a subscription before it expires. To cancel, use ls_cancel_subscription instead.",
        ),
      billingAnchor: z.number().int().min(1).max(28).optional().describe("Day of month (1-28) to anchor billing to"),
      invoiceImmediately: z
        .boolean()
        .optional()
        .describe("If true, invoice immediately when updating (default false for prorated changes)"),
      disableProrations: z.boolean().optional().describe("If true, disable prorations when changing plans"),
      trialEndsAt: z
        .string()
        .optional()
        .describe("Set trial end date (ISO 8601 format). Set to null to end trial immediately."),
    }),
    handler: async (input: {
      subscriptionId: string;
      variantId?: string;
      pause?: string;
      cancelled?: false;
      billingAnchor?: number;
      invoiceImmediately?: boolean;
      disableProrations?: boolean;
      trialEndsAt?: string;
    }) => {
      const attributes: Record<string, unknown> = {};
      if (input.variantId !== undefined) attributes.variant_id = Number(input.variantId);
      if (input.pause !== undefined) attributes.pause = input.pause === "resume" ? null : { mode: input.pause };
      if (input.cancelled !== undefined) attributes.cancelled = input.cancelled;
      if (input.billingAnchor !== undefined) attributes.billing_anchor = input.billingAnchor;
      if (input.invoiceImmediately !== undefined) attributes.invoice_immediately = input.invoiceImmediately;
      if (input.disableProrations !== undefined) attributes.disable_prorations = input.disableProrations;
      if (input.trialEndsAt !== undefined) attributes.trial_ends_at = input.trialEndsAt;

      return apiPatch(`/subscriptions/${input.subscriptionId}`, {
        data: {
          type: "subscriptions",
          id: input.subscriptionId,
          attributes,
        },
      });
    },
  },
  {
    name: "ls_cancel_subscription",
    description:
      "Cancel a subscription. The subscription remains active until the end of the current billing period, then expires.",
    annotations: {
      title: "Cancel subscription",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionId: z.string().describe("The subscription ID to cancel"),
    }),
    handler: async (input: { subscriptionId: string }) => {
      return apiDelete(`/subscriptions/${input.subscriptionId}`);
    },
  },
] as const;

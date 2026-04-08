import { z } from "zod";
import { apiDelete, apiGet, apiPatch, buildQuery } from "../api.js";

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
    handler: async (input: { subscriptionId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/subscriptions/${input.subscriptionId}${query}`);
    },
  },
  {
    name: "ls_list_subscriptions",
    description: "List all subscriptions, optionally filtered by store, order, product, variant, or status.",
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
        .string()
        .optional()
        .describe("Filter by status (on_trial, active, paused, past_due, unpaid, cancelled, expired)"),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order,order-item,product,variant')",
        ),
      pageNumber: z.number().optional().describe("Page number (1-indexed)"),
      pageSize: z.number().optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      storeId?: string;
      orderId?: string;
      orderItemId?: string;
      productId?: string;
      variantId?: string;
      userEmail?: string;
      status?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.storeId) filter.store_id = input.storeId;
      if (input.orderId) filter.order_id = input.orderId;
      if (input.orderItemId) filter.order_item_id = input.orderItemId;
      if (input.productId) filter.product_id = input.productId;
      if (input.variantId) filter.variant_id = input.variantId;
      if (input.userEmail) filter.user_email = input.userEmail;
      if (input.status) filter.status = input.status;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/subscriptions${query}`);
    },
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
      variantId: z.number().optional().describe("New variant ID for plan switching"),
      pause: z
        .string()
        .optional()
        .describe("Pause mode: 'void' (pause immediately, no invoice) or 'free' (pause immediately, no charge)"),
      cancelled: z.boolean().optional().describe("Set to false to resume a cancelled subscription (before it expires)"),
      billingAnchor: z.number().optional().describe("Day of month (1-28) to anchor billing to"),
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
      variantId?: number;
      pause?: string;
      cancelled?: boolean;
      billingAnchor?: number;
      invoiceImmediately?: boolean;
      disableProrations?: boolean;
      trialEndsAt?: string;
    }) => {
      const attributes: Record<string, unknown> = {};
      if (input.variantId !== undefined) attributes.variant_id = input.variantId;
      if (input.pause !== undefined) attributes.pause = input.pause === "" ? null : { mode: input.pause };
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

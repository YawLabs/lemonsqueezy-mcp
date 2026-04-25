import { z } from "zod";
import { apiPost, encodePath, getHandler, listHandler } from "../api.js";
import { checkRefundAmount } from "../guardrails.js";

export const orderTools = [
  {
    name: "ls_get_order",
    description: "Get a specific order by ID, including status, total, currency, customer info, and payment details.",
    annotations: {
      title: "Get order",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      orderId: z.string().max(10000).describe("The order ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order-items,subscriptions,license-keys,discount-redemptions')",
        ),
    }),
    handler: getHandler("/orders", "orderId"),
  },
  {
    name: "ls_list_orders",
    description:
      "List all orders, optionally filtered by store or user email. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List orders",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().max(10000).optional().describe("Filter by store ID"),
      userEmail: z.string().email().max(320).optional().describe("Filter by user email"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order-items,subscriptions,license-keys,discount-redemptions')",
        ),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/orders", { storeId: "store_id", userEmail: "user_email" }),
  },
  {
    name: "ls_generate_order_invoice",
    description: "Generate a PDF invoice for an order. Returns a download URL for the invoice.",
    annotations: {
      title: "Generate order invoice",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      orderId: z.string().max(10000).describe("The order ID"),
      name: z.string().max(10000).optional().describe("Customer name on the invoice"),
      address: z.string().max(10000).optional().describe("Customer address on the invoice"),
      city: z.string().max(10000).optional().describe("Customer city"),
      state: z.string().max(10000).optional().describe("Customer state/region"),
      zipCode: z.string().max(10000).optional().describe("Customer ZIP/postal code"),
      country: z.string().max(10000).optional().describe("Customer country"),
      notes: z.string().max(10000).optional().describe("Additional notes to include on the invoice"),
      locale: z.string().max(10000).optional().describe("Invoice language locale (e.g. 'en', 'fr', 'de')"),
    }),
    handler: async (input: {
      orderId: string;
      name?: string;
      address?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
      notes?: string;
      locale?: string;
    }) => {
      const params = new URLSearchParams();
      if (input.name !== undefined) params.set("name", input.name);
      if (input.address !== undefined) params.set("address", input.address);
      if (input.city !== undefined) params.set("city", input.city);
      if (input.state !== undefined) params.set("state", input.state);
      if (input.zipCode !== undefined) params.set("zip_code", input.zipCode);
      if (input.country !== undefined) params.set("country", input.country);
      if (input.notes !== undefined) params.set("notes", input.notes);
      if (input.locale !== undefined) params.set("locale", input.locale);
      const qs = params.toString();
      return apiPost(`/orders/${encodePath(input.orderId)}/generate-invoice${qs ? `?${qs}` : ""}`);
    },
  },
  {
    name: "ls_refund_order",
    description:
      "Issue a refund for an order. This is irreversible — the refund amount is in cents (e.g. 1000 = $10.00).",
    annotations: {
      title: "Refund order",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      orderId: z.string().max(10000).describe("The order ID to refund"),
      amount: z.number().int().min(1).describe("Refund amount in cents (e.g. 1000 = $10.00)"),
    }),
    handler: async (input: { orderId: string; amount: number }) => {
      checkRefundAmount(input.amount);
      return apiPost(`/orders/${encodePath(input.orderId)}/refund`, {
        data: { type: "orders", id: input.orderId, attributes: { amount: input.amount } },
      });
    },
  },
] as const;

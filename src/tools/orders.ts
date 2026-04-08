import { z } from "zod";
import { apiGet, apiPost, buildQuery } from "../api.js";

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
      orderId: z.string().describe("The order ID"),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order-items,subscriptions,license-keys,discount-redemptions')",
        ),
    }),
    handler: async (input: { orderId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/orders/${input.orderId}${query}`);
    },
  },
  {
    name: "ls_list_orders",
    description: "List all orders, optionally filtered by store, email, or user email.",
    annotations: {
      title: "List orders",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().optional().describe("Filter by store ID"),
      userEmail: z.string().optional().describe("Filter by user email"),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order-items,subscriptions,license-keys,discount-redemptions')",
        ),
      pageNumber: z.number().optional().describe("Page number (1-indexed)"),
      pageSize: z.number().optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      storeId?: string;
      userEmail?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.storeId) filter.store_id = input.storeId;
      if (input.userEmail) filter.user_email = input.userEmail;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/orders${query}`);
    },
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
      orderId: z.string().describe("The order ID"),
      name: z.string().optional().describe("Customer name on the invoice"),
      address: z.string().optional().describe("Customer address on the invoice"),
      city: z.string().optional().describe("Customer city"),
      state: z.string().optional().describe("Customer state/region"),
      zipCode: z.string().optional().describe("Customer ZIP/postal code"),
      country: z.string().optional().describe("Customer country"),
      notes: z.string().optional().describe("Additional notes to include on the invoice"),
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
    }) => {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.address !== undefined) body.address = input.address;
      if (input.city !== undefined) body.city = input.city;
      if (input.state !== undefined) body.state = input.state;
      if (input.zipCode !== undefined) body.zip_code = input.zipCode;
      if (input.country !== undefined) body.country = input.country;
      if (input.notes !== undefined) body.notes = input.notes;

      return apiPost(`/orders/${input.orderId}/generate-invoice`, body);
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
      orderId: z.string().describe("The order ID to refund"),
      amount: z.number().describe("Refund amount in cents (e.g. 1000 = $10.00)"),
    }),
    handler: async (input: { orderId: string; amount: number }) => {
      return apiPost(`/orders/${input.orderId}/refund`, {
        data: { type: "orders", id: input.orderId, attributes: { amount: input.amount } },
      });
    },
  },
] as const;

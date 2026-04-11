import { z } from "zod";
import { apiPost, getHandler, listHandler } from "../api.js";

export const subscriptionInvoiceTools = [
  {
    name: "ls_get_subscription_invoice",
    description:
      "Get a specific subscription invoice by ID, including status, total, billing reason, and payment details.",
    annotations: {
      title: "Get subscription invoice",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionInvoiceId: z.string().describe("The subscription invoice ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,subscription')"),
    }),
    handler: getHandler("/subscription-invoices", "subscriptionInvoiceId"),
  },
  {
    name: "ls_list_subscription_invoices",
    description:
      "List all subscription invoices, optionally filtered by store, subscription, or status. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List subscription invoices",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().optional().describe("Filter by store ID"),
      subscriptionId: z.string().optional().describe("Filter by subscription ID"),
      status: z.enum(["pending", "paid", "void", "refunded"]).optional().describe("Filter by invoice status"),
      refunded: z.boolean().optional().describe("Filter by refunded status"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,subscription')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/subscription-invoices", {
      storeId: "store_id",
      subscriptionId: "subscription_id",
      status: "status",
      refunded: "refunded",
    }),
  },
  {
    name: "ls_generate_subscription_invoice",
    description: "Generate a PDF invoice for a subscription invoice. Returns a download URL.",
    annotations: {
      title: "Generate subscription invoice",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionInvoiceId: z.string().describe("The subscription invoice ID"),
      name: z.string().optional().describe("Customer name on the invoice"),
      address: z.string().optional().describe("Customer address on the invoice"),
      city: z.string().optional().describe("Customer city"),
      state: z.string().optional().describe("Customer state/region"),
      zipCode: z.string().optional().describe("Customer ZIP/postal code"),
      country: z.string().optional().describe("Customer country"),
      notes: z.string().optional().describe("Additional notes to include on the invoice"),
      locale: z.string().optional().describe("Invoice language locale (e.g. 'en', 'fr', 'de')"),
    }),
    handler: async (input: {
      subscriptionInvoiceId: string;
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
      return apiPost(`/subscription-invoices/${input.subscriptionInvoiceId}/generate-invoice${qs ? `?${qs}` : ""}`);
    },
  },
  {
    name: "ls_refund_subscription_invoice",
    description:
      "Issue a refund for a subscription invoice. This is irreversible — the refund amount is in cents (e.g. 1000 = $10.00).",
    annotations: {
      title: "Refund subscription invoice",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionInvoiceId: z.string().describe("The subscription invoice ID to refund"),
      amount: z.number().int().min(1).describe("Refund amount in cents (e.g. 1000 = $10.00)"),
    }),
    handler: async (input: { subscriptionInvoiceId: string; amount: number }) => {
      return apiPost(`/subscription-invoices/${input.subscriptionInvoiceId}/refund`, {
        data: {
          type: "subscription-invoices",
          id: input.subscriptionInvoiceId,
          attributes: { amount: input.amount },
        },
      });
    },
  },
] as const;

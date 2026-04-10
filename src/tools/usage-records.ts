import { z } from "zod";
import { apiGet, apiPost, buildQuery } from "../api.js";

export const usageRecordTools = [
  {
    name: "ls_get_usage_record",
    description: "Get a specific usage record by ID, including quantity and action type.",
    annotations: {
      title: "Get usage record",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      usageRecordId: z.string().describe("The usage record ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'subscription-item')"),
    }),
    handler: async (input: { usageRecordId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/usage-records/${input.usageRecordId}${query}`);
    },
  },
  {
    name: "ls_list_usage_records",
    description:
      "List all usage records, optionally filtered by subscription item. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List usage records",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionItemId: z.string().optional().describe("Filter by subscription item ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'subscription-item')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      subscriptionItemId?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.subscriptionItemId) filter.subscription_item_id = input.subscriptionItemId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/usage-records${query}`);
    },
  },
  {
    name: "ls_create_usage_record",
    description:
      "Report usage for a metered subscription item. Use 'increment' action to add to the current usage, or 'set' to replace it.",
    annotations: {
      title: "Create usage record",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      subscriptionItemId: z.string().describe("The subscription item ID to report usage for"),
      quantity: z.number().int().min(0).describe("The usage quantity to report"),
      action: z
        .enum(["increment", "set"])
        .optional()
        .describe("How to apply the quantity: 'increment' (add to current, default) or 'set' (replace current)"),
    }),
    handler: async (input: { subscriptionItemId: string; quantity: number; action?: string }) => {
      const attributes: Record<string, unknown> = {
        quantity: input.quantity,
      };
      if (input.action !== undefined) attributes.action = input.action;

      return apiPost("/usage-records", {
        data: {
          type: "usage-records",
          attributes,
          relationships: {
            "subscription-item": {
              data: { type: "subscription-items", id: input.subscriptionItemId },
            },
          },
        },
      });
    },
  },
] as const;

import { z } from "zod";
import { apiDelete, apiGet, apiPatch, apiPost, buildQuery } from "../api.js";

export const webhookTools = [
  {
    name: "ls_get_webhook",
    description: "Get a specific webhook by ID, including URL, events, and last sent timestamp.",
    annotations: {
      title: "Get webhook",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      webhookId: z.string().describe("The webhook ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'store')"),
    }),
    handler: async (input: { webhookId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/webhooks/${input.webhookId}${query}`);
    },
  },
  {
    name: "ls_list_webhooks",
    description:
      "List all webhooks, optionally filtered by store. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List webhooks",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().optional().describe("Filter by store ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'store')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: { storeId?: string; include?: string; pageNumber?: number; pageSize?: number }) => {
      const filter: Record<string, string> = {};
      if (input.storeId) filter.store_id = input.storeId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/webhooks${query}`);
    },
  },
  {
    name: "ls_create_webhook",
    description:
      "Create a new webhook to receive event notifications. The signing secret is returned only once — save it immediately.",
    annotations: {
      title: "Create webhook",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().describe("The store ID"),
      url: z.string().describe("The URL to send webhook events to"),
      events: z
        .array(z.string())
        .describe(
          "Event types to subscribe to (e.g. ['order_created', 'subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_payment_success', 'subscription_payment_failed', 'license_key_created'])",
        ),
      secret: z.string().min(6).max(40).describe("A signing secret for verifying webhook payloads"),
    }),
    handler: async (input: { storeId: string; url: string; events: string[]; secret: string }) => {
      return apiPost("/webhooks", {
        data: {
          type: "webhooks",
          attributes: {
            url: input.url,
            events: input.events,
            secret: input.secret,
          },
          relationships: {
            store: { data: { type: "stores", id: input.storeId } },
          },
        },
      });
    },
  },
  {
    name: "ls_update_webhook",
    description: "Update an existing webhook's URL, events, or secret.",
    annotations: {
      title: "Update webhook",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      webhookId: z.string().describe("The webhook ID to update"),
      url: z.string().optional().describe("New URL to send webhook events to"),
      events: z.array(z.string()).optional().describe("Updated list of event types to subscribe to"),
      secret: z.string().optional().describe("New signing secret"),
    }),
    handler: async (input: { webhookId: string; url?: string; events?: string[]; secret?: string }) => {
      const attributes: Record<string, unknown> = {};
      if (input.url !== undefined) attributes.url = input.url;
      if (input.events !== undefined) attributes.events = input.events;
      if (input.secret !== undefined) attributes.secret = input.secret;

      return apiPatch(`/webhooks/${input.webhookId}`, {
        data: {
          type: "webhooks",
          id: input.webhookId,
          attributes,
        },
      });
    },
  },
  {
    name: "ls_delete_webhook",
    description: "Permanently delete a webhook. This is irreversible.",
    annotations: {
      title: "Delete webhook",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      webhookId: z.string().describe("The webhook ID to delete"),
    }),
    handler: async (input: { webhookId: string }) => {
      return apiDelete(`/webhooks/${input.webhookId}`);
    },
  },
] as const;

import { z } from "zod";
import { apiDelete, apiPatch, apiPost, encodePath, getHandler, listHandler, lsIdSchema } from "../api.js";
import { ToolInputError } from "../guardrails.js";

// z.string().url() accepts every URL-parseable scheme (mailto:, file:,
// javascript:, ftp:, chrome-extension:, etc.). LemonSqueezy webhooks only
// deliver over http/https; anything else stored as a webhook target is
// unreachable in the best case and an injection sink in the worst. Refine
// the URL to reject non-http(s) schemes at the schema level so callers get
// a clear local error instead of an upstream 422 (or a silently-accepted
// dead webhook).
const httpsUrlSchema = z
  .string()
  .url()
  .max(10000)
  .refine((u) => /^https?:\/\//i.test(u), { message: "url must start with http:// or https://" });

export const webhookTools = [
  {
    name: "ls_get_webhook",
    authorityClass: "read" as const,
    description: "Get a specific webhook by ID, including URL, events, and last sent timestamp.",
    annotations: {
      title: "Get webhook",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      webhookId: lsIdSchema.describe("The webhook ID"),
      include: z.string().max(10000).optional().describe("Comma-separated related resources to include (e.g. 'store')"),
    }),
    handler: getHandler("/webhooks", "webhookId"),
  },
  {
    name: "ls_list_webhooks",
    authorityClass: "read" as const,
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
      storeId: lsIdSchema.optional().describe("Filter by store ID"),
      include: z.string().max(10000).optional().describe("Comma-separated related resources to include (e.g. 'store')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/webhooks", { storeId: "store_id" }),
  },
  {
    name: "ls_create_webhook",
    authorityClass: "webhook" as const,
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
      storeId: lsIdSchema.describe("The store ID"),
      url: httpsUrlSchema.describe("The URL to send webhook events to (must be a valid http/https URL)"),
      events: z
        .array(z.string())
        .min(1)
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
    authorityClass: "webhook" as const,
    description:
      "Update an existing webhook's URL, events, or secret. Setting `secret` rotates the signing secret and breaks signature verification on the receiver until they update their copy -- this is treated as destructive (rate-limited and audited).",
    annotations: {
      title: "Update webhook",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    // Rotating the signing secret silently breaks signature verification on
    // every receiver until they redeploy with the new value. URL and events
    // changes are observable on the next event but don't break anything in
    // flight, so they stay on the regular path.
    isDestructive: (input: Record<string, unknown>) => input.secret !== undefined,
    inputSchema: z.object({
      webhookId: lsIdSchema.describe("The webhook ID to update"),
      url: httpsUrlSchema.optional().describe("New URL to send webhook events to (must be a valid http/https URL)"),
      events: z.array(z.string()).min(1).optional().describe("Updated list of event types to subscribe to"),
      secret: z.string().min(6).max(40).optional().describe("New signing secret"),
    }),
    handler: async (input: { webhookId: string; url?: string; events?: string[]; secret?: string }) => {
      const attributes: Record<string, unknown> = {};
      if (input.url !== undefined) attributes.url = input.url;
      if (input.events !== undefined) attributes.events = input.events;
      if (input.secret !== undefined) attributes.secret = input.secret;

      // An empty PATCH is a meaningless call that the API would 422 with a
      // less clear message. Reject locally so the caller sees what they did
      // wrong before a round-trip. Matches ls_update_customer /
      // ls_update_subscription / ls_update_license_key.
      if (Object.keys(attributes).length === 0) {
        throw new ToolInputError("ls_update_webhook requires at least one of: url, events, secret");
      }

      return apiPatch(`/webhooks/${encodePath(input.webhookId)}`, {
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
    authorityClass: "webhook" as const,
    description: "Permanently delete a webhook. This is irreversible.",
    annotations: {
      title: "Delete webhook",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      webhookId: lsIdSchema.describe("The webhook ID to delete"),
    }),
    handler: async (input: { webhookId: string }) => {
      return apiDelete(`/webhooks/${encodePath(input.webhookId)}`);
    },
  },
] as const;

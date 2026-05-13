import { z } from "zod";
import { apiPatch, encodePath, getHandler, listHandler, lsIdSchema } from "../api.js";

export const licenseKeyTools = [
  {
    name: "ls_get_license_key",
    description: "Get a specific license key by ID, including key value, status, activation limit, and expiry date.",
    annotations: {
      title: "Get license key",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKeyId: lsIdSchema.describe("The license key ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order,order-item,product,license-key-instances')",
        ),
    }),
    handler: getHandler("/license-keys", "licenseKeyId"),
  },
  {
    name: "ls_list_license_keys",
    description:
      "List all license keys, optionally filtered by store, order, or product. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List license keys",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: lsIdSchema.optional().describe("Filter by store ID"),
      orderId: lsIdSchema.optional().describe("Filter by order ID"),
      orderItemId: lsIdSchema.optional().describe("Filter by order item ID"),
      productId: lsIdSchema.optional().describe("Filter by product ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe(
          "Comma-separated related resources to include (e.g. 'store,customer,order,order-item,product,license-key-instances')",
        ),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/license-keys", {
      storeId: "store_id",
      orderId: "order_id",
      orderItemId: "order_item_id",
      productId: "product_id",
    }),
  },
  {
    name: "ls_update_license_key",
    description:
      "Update a license key's activation limit, expiry date, or disabled status. Setting `disabled: true` revokes customer access and is treated as destructive (rate-limited and audited).",
    annotations: {
      title: "Update license key",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    // Disabling a license key revokes a customer's access outright. Changing
    // the activation limit can also revoke access -- setting it to 0, or to
    // any value below the customer's current activation count, kicks
    // already-activated instances offline. We can't tell from the input alone
    // whether a given limit change shrinks or grows, so treat ANY
    // `activationLimit` change as destructive alongside `disabled: true`.
    // Benign edits (expiry) stay on the regular path.
    isDestructive: (input: Record<string, unknown>) => input.disabled === true || input.activationLimit !== undefined,
    inputSchema: z.object({
      licenseKeyId: lsIdSchema.describe("The license key ID to update"),
      activationLimit: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Maximum number of activations allowed (0 = unlimited)"),
      disabled: z.boolean().optional().describe("Set to true to disable this license key"),
      expiresAt: z
        .string()
        .max(10000)
        .nullable()
        .optional()
        .describe("Expiry date (ISO 8601 format). Set to null to remove expiry."),
    }),
    handler: async (input: {
      licenseKeyId: string;
      activationLimit?: number;
      disabled?: boolean;
      expiresAt?: string | null;
    }) => {
      const attributes: Record<string, unknown> = {};
      if (input.activationLimit !== undefined) attributes.activation_limit = input.activationLimit;
      if (input.disabled !== undefined) attributes.disabled = input.disabled;
      if (input.expiresAt !== undefined) attributes.expires_at = input.expiresAt;

      return apiPatch(`/license-keys/${encodePath(input.licenseKeyId)}`, {
        data: {
          type: "license-keys",
          id: input.licenseKeyId,
          attributes,
        },
      });
    },
  },
] as const;

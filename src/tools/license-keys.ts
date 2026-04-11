import { z } from "zod";
import { apiPatch, getHandler, listHandler } from "../api.js";

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
      licenseKeyId: z.string().describe("The license key ID"),
      include: z
        .string()
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
      storeId: z.string().optional().describe("Filter by store ID"),
      orderId: z.string().optional().describe("Filter by order ID"),
      orderItemId: z.string().optional().describe("Filter by order item ID"),
      productId: z.string().optional().describe("Filter by product ID"),
      include: z
        .string()
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
    description: "Update a license key's activation limit, expiry date, or disabled status.",
    annotations: {
      title: "Update license key",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKeyId: z.string().describe("The license key ID to update"),
      activationLimit: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Maximum number of activations allowed (0 = unlimited)"),
      disabled: z.boolean().optional().describe("Set to true to disable this license key"),
      expiresAt: z.string().optional().describe("Expiry date (ISO 8601 format). Set to null to remove expiry."),
    }),
    handler: async (input: {
      licenseKeyId: string;
      activationLimit?: number;
      disabled?: boolean;
      expiresAt?: string;
    }) => {
      const attributes: Record<string, unknown> = {};
      if (input.activationLimit !== undefined) attributes.activation_limit = input.activationLimit;
      if (input.disabled !== undefined) attributes.disabled = input.disabled;
      if (input.expiresAt !== undefined) attributes.expires_at = input.expiresAt;

      return apiPatch(`/license-keys/${input.licenseKeyId}`, {
        data: {
          type: "license-keys",
          id: input.licenseKeyId,
          attributes,
        },
      });
    },
  },
] as const;

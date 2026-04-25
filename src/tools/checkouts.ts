import { z } from "zod";
import { apiPost, getHandler, listHandler } from "../api.js";

export const checkoutTools = [
  {
    name: "ls_get_checkout",
    description: "Get a specific checkout by ID, including URL, expiry, and custom data.",
    annotations: {
      title: "Get checkout",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      checkoutId: z.string().max(10000).describe("The checkout ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,variant')"),
    }),
    handler: getHandler("/checkouts", "checkoutId"),
  },
  {
    name: "ls_list_checkouts",
    description:
      "List all checkouts, optionally filtered by store or variant. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List checkouts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().max(10000).optional().describe("Filter by store ID"),
      variantId: z.string().max(10000).optional().describe("Filter by variant ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,variant')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/checkouts", { storeId: "store_id", variantId: "variant_id" }),
  },
  {
    name: "ls_create_checkout",
    description:
      "Create a new checkout URL for a product variant. Returns a URL where the customer can complete their purchase. Supports custom pricing, prefilled customer data, and checkout customization.",
    annotations: {
      title: "Create checkout",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().max(10000).describe("The store ID"),
      variantId: z.string().max(10000).describe("The variant ID for the product being purchased"),
      customPrice: z.number().int().min(0).optional().describe("Custom price in cents (overrides the variant price)"),
      enabledVariants: z
        .array(z.string())
        .optional()
        .describe("Array of variant IDs to show on the checkout (for products with multiple variants)"),
      email: z.string().max(10000).optional().describe("Prefill customer email"),
      name: z.string().max(10000).optional().describe("Prefill customer name"),
      billingAddressCountry: z.string().max(10000).optional().describe("Prefill billing country (ISO 3166-1 alpha-2)"),
      billingAddressZip: z.string().max(10000).optional().describe("Prefill billing ZIP/postal code"),
      taxNumber: z.string().max(10000).optional().describe("Prefill tax/VAT number"),
      discountCode: z.string().max(10000).optional().describe("Pre-apply a discount code"),
      customData: z.record(z.string(), z.unknown()).optional().describe("Custom data object to attach to the order"),
      expiresAt: z.string().max(10000).optional().describe("Checkout expiry date (ISO 8601 format)"),
    }),
    handler: async (input: {
      storeId: string;
      variantId: string;
      customPrice?: number;
      enabledVariants?: string[];
      email?: string;
      name?: string;
      billingAddressCountry?: string;
      billingAddressZip?: string;
      taxNumber?: string;
      discountCode?: string;
      customData?: Record<string, unknown>;
      expiresAt?: string;
    }) => {
      const attributes: Record<string, unknown> = {};

      if (input.customPrice !== undefined) attributes.custom_price = input.customPrice;
      if (input.enabledVariants !== undefined) attributes.product_options = { enabled_variants: input.enabledVariants };
      if (input.expiresAt !== undefined) attributes.expires_at = input.expiresAt;

      const checkoutData: Record<string, unknown> = {};
      if (input.email !== undefined) checkoutData.email = input.email;
      if (input.name !== undefined) checkoutData.name = input.name;
      if (input.billingAddressCountry !== undefined || input.billingAddressZip !== undefined) {
        const billingAddress: Record<string, unknown> = {};
        if (input.billingAddressCountry !== undefined) billingAddress.country = input.billingAddressCountry;
        if (input.billingAddressZip !== undefined) billingAddress.zip = input.billingAddressZip;
        checkoutData.billing_address = billingAddress;
      }
      if (input.taxNumber !== undefined) checkoutData.tax_number = input.taxNumber;
      if (input.discountCode !== undefined) checkoutData.discount_code = input.discountCode;
      if (input.customData !== undefined) {
        checkoutData.custom = input.customData;
      }

      if (Object.keys(checkoutData).length > 0) attributes.checkout_data = checkoutData;

      return apiPost("/checkouts", {
        data: {
          type: "checkouts",
          attributes,
          relationships: {
            store: { data: { type: "stores", id: input.storeId } },
            variant: { data: { type: "variants", id: input.variantId } },
          },
        },
      });
    },
  },
] as const;

import { z } from "zod";
import { apiGet, apiPost, buildQuery } from "../api.js";

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
      checkoutId: z.string().describe("The checkout ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'store,variant')"),
    }),
    handler: async (input: { checkoutId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/checkouts/${input.checkoutId}${query}`);
    },
  },
  {
    name: "ls_list_checkouts",
    description: "List all checkouts, optionally filtered by store or variant.",
    annotations: {
      title: "List checkouts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().optional().describe("Filter by store ID"),
      variantId: z.string().optional().describe("Filter by variant ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'store,variant')"),
      pageNumber: z.number().optional().describe("Page number (1-indexed)"),
      pageSize: z.number().optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      storeId?: string;
      variantId?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.storeId) filter.store_id = input.storeId;
      if (input.variantId) filter.variant_id = input.variantId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/checkouts${query}`);
    },
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
      storeId: z.string().describe("The store ID"),
      variantId: z.string().describe("The variant ID for the product being purchased"),
      customPrice: z.number().optional().describe("Custom price in cents (overrides the variant price)"),
      enabledVariants: z
        .array(z.number())
        .optional()
        .describe("Array of variant IDs to show on the checkout (for products with multiple variants)"),
      email: z.string().optional().describe("Prefill customer email"),
      name: z.string().optional().describe("Prefill customer name"),
      billingAddressCountry: z.string().optional().describe("Prefill billing country (ISO 3166-1 alpha-2)"),
      billingAddressZip: z.string().optional().describe("Prefill billing ZIP/postal code"),
      taxNumber: z.string().optional().describe("Prefill tax/VAT number"),
      discountCode: z.string().optional().describe("Pre-apply a discount code"),
      customData: z.string().optional().describe("Custom JSON data to attach to the order (as a JSON string)"),
      expiresAt: z.string().optional().describe("Checkout expiry date (ISO 8601 format)"),
    }),
    handler: async (input: {
      storeId: string;
      variantId: string;
      customPrice?: number;
      enabledVariants?: number[];
      email?: string;
      name?: string;
      billingAddressCountry?: string;
      billingAddressZip?: string;
      taxNumber?: string;
      discountCode?: string;
      customData?: string;
      expiresAt?: string;
    }) => {
      const attributes: Record<string, unknown> = {};

      if (input.customPrice !== undefined) attributes.custom_price = input.customPrice;
      if (input.enabledVariants) attributes.product_options = { enabled_variants: input.enabledVariants };
      if (input.expiresAt !== undefined) attributes.expires_at = input.expiresAt;

      const checkoutData: Record<string, unknown> = {};
      if (input.email !== undefined) checkoutData.email = input.email;
      if (input.name !== undefined) checkoutData.name = input.name;
      if (input.billingAddressCountry !== undefined)
        checkoutData.billing_address = { country: input.billingAddressCountry };
      if (input.billingAddressZip !== undefined) {
        checkoutData.billing_address = {
          ...((checkoutData.billing_address as Record<string, unknown>) || {}),
          zip: input.billingAddressZip,
        };
      }
      if (input.taxNumber !== undefined) checkoutData.tax_number = input.taxNumber;
      if (input.discountCode !== undefined) checkoutData.discount_code = input.discountCode;
      if (input.customData !== undefined) {
        try {
          checkoutData.custom = JSON.parse(input.customData);
        } catch {
          checkoutData.custom = input.customData;
        }
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

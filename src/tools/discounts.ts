import { z } from "zod";
import { apiDelete, apiGet, apiPost, buildQuery } from "../api.js";

export const discountTools = [
  {
    name: "ls_get_discount",
    description: "Get a specific discount by ID, including code, amount, type, and usage limits.",
    annotations: {
      title: "Get discount",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      discountId: z.string().describe("The discount ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,variants,discount-redemptions')"),
    }),
    handler: async (input: { discountId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/discounts/${input.discountId}${query}`);
    },
  },
  {
    name: "ls_list_discounts",
    description:
      "List all discounts, optionally filtered by store. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List discounts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().optional().describe("Filter by store ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,variants,discount-redemptions')"),
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
      return apiGet(`/discounts${query}`);
    },
  },
  {
    name: "ls_create_discount",
    description:
      "Create a new discount code. Supports percentage or fixed amount discounts with optional duration and usage limits.",
    annotations: {
      title: "Create discount",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().describe("The store ID to create the discount in"),
      name: z.string().describe("Internal name for the discount"),
      code: z.string().describe("The discount code customers will enter (e.g. 'SAVE20')"),
      amount: z
        .number()
        .int()
        .min(1)
        .describe(
          "Discount amount — in cents for 'fixed' type (e.g. 1000 = $10.00), or percentage for 'percent' type (e.g. 20 = 20%)",
        ),
      amountType: z.enum(["percent", "fixed"]).describe("Discount type: 'percent' or 'fixed'"),
      duration: z
        .enum(["once", "repeating", "forever"])
        .optional()
        .describe(
          "How long the discount applies: 'once' (first payment only), 'repeating' (for N months), or 'forever' (default)",
        ),
      durationInMonths: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Number of months the discount applies (required when duration is 'repeating')"),
      maxRedemptions: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Maximum number of times this discount can be redeemed (0 = unlimited)"),
      startsAt: z.string().optional().describe("When the discount becomes active (ISO 8601 format)"),
      expiresAt: z.string().optional().describe("When the discount expires (ISO 8601 format)"),
      isLimitedToProducts: z
        .boolean()
        .optional()
        .describe("If true, the discount only applies to specific variants (set via variantIds)"),
      variantIds: z
        .array(z.string())
        .optional()
        .describe("Array of variant IDs this discount applies to (requires isLimitedToProducts: true)"),
    }),
    handler: async (input: {
      storeId: string;
      name: string;
      code: string;
      amount: number;
      amountType: string;
      duration?: string;
      durationInMonths?: number;
      maxRedemptions?: number;
      startsAt?: string;
      expiresAt?: string;
      isLimitedToProducts?: boolean;
      variantIds?: string[];
    }) => {
      const attributes: Record<string, unknown> = {
        name: input.name,
        code: input.code,
        amount: input.amount,
        amount_type: input.amountType,
      };
      if (input.duration !== undefined) attributes.duration = input.duration;
      if (input.durationInMonths !== undefined) attributes.duration_in_months = input.durationInMonths;
      if (input.maxRedemptions !== undefined) attributes.max_redemptions = input.maxRedemptions;
      if (input.startsAt !== undefined) attributes.starts_at = input.startsAt;
      if (input.expiresAt !== undefined) attributes.expires_at = input.expiresAt;
      if (input.isLimitedToProducts !== undefined) attributes.is_limited_to_products = input.isLimitedToProducts;

      const relationships: Record<string, unknown> = {
        store: { data: { type: "stores", id: input.storeId } },
      };

      if (input.variantIds?.length) {
        relationships.variants = {
          data: input.variantIds.map((id) => ({ type: "variants", id })),
        };
      }

      return apiPost("/discounts", {
        data: {
          type: "discounts",
          attributes,
          relationships,
        },
      });
    },
  },
  {
    name: "ls_delete_discount",
    description: "Permanently delete a discount. This is irreversible.",
    annotations: {
      title: "Delete discount",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      discountId: z.string().describe("The discount ID to delete"),
    }),
    handler: async (input: { discountId: string }) => {
      return apiDelete(`/discounts/${input.discountId}`);
    },
  },
] as const;

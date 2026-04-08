import { z } from "zod";
import { apiGet, apiPatch, apiPost, buildQuery } from "../api.js";

export const customerTools = [
  {
    name: "ls_get_customer",
    description:
      "Get a specific customer by ID, including name, email, city, country, MRR, total revenue, and customer portal URL.",
    annotations: {
      title: "Get customer",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      customerId: z.string().describe("The customer ID"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,orders,subscriptions,license-keys')"),
    }),
    handler: async (input: { customerId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/customers/${input.customerId}${query}`);
    },
  },
  {
    name: "ls_list_customers",
    description: "List all customers, optionally filtered by store or email.",
    annotations: {
      title: "List customers",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().optional().describe("Filter by store ID"),
      email: z.string().optional().describe("Filter by customer email"),
      include: z
        .string()
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'store,orders,subscriptions,license-keys')"),
      pageNumber: z.number().optional().describe("Page number (1-indexed)"),
      pageSize: z.number().optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      storeId?: string;
      email?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.storeId) filter.store_id = input.storeId;
      if (input.email) filter.email = input.email;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/customers${query}`);
    },
  },
  {
    name: "ls_create_customer",
    description: "Create a new customer in a store.",
    annotations: {
      title: "Create customer",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      storeId: z.string().describe("The store ID to create the customer in"),
      name: z.string().describe("Customer's full name"),
      email: z.string().describe("Customer's email address"),
      city: z.string().optional().describe("Customer's city"),
      region: z.string().optional().describe("Customer's region/state"),
      country: z.string().optional().describe("Customer's country (ISO 3166-1 alpha-2 code, e.g. 'US')"),
    }),
    handler: async (input: {
      storeId: string;
      name: string;
      email: string;
      city?: string;
      region?: string;
      country?: string;
    }) => {
      const attributes: Record<string, unknown> = {
        name: input.name,
        email: input.email,
      };
      if (input.city) attributes.city = input.city;
      if (input.region) attributes.region = input.region;
      if (input.country) attributes.country = input.country;

      return apiPost("/customers", {
        data: {
          type: "customers",
          attributes,
          relationships: {
            store: { data: { type: "stores", id: input.storeId } },
          },
        },
      });
    },
  },
  {
    name: "ls_update_customer",
    description: "Update an existing customer's name, email, city, region, country, or status.",
    annotations: {
      title: "Update customer",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      customerId: z.string().describe("The customer ID to update"),
      name: z.string().optional().describe("New name"),
      email: z.string().optional().describe("New email"),
      city: z.string().optional().describe("New city"),
      region: z.string().optional().describe("New region/state"),
      country: z.string().optional().describe("New country (ISO 3166-1 alpha-2 code)"),
      status: z.string().optional().describe("New status ('archived' to archive the customer)"),
    }),
    handler: async (input: {
      customerId: string;
      name?: string;
      email?: string;
      city?: string;
      region?: string;
      country?: string;
      status?: string;
    }) => {
      const attributes: Record<string, unknown> = {};
      if (input.name !== undefined) attributes.name = input.name;
      if (input.email !== undefined) attributes.email = input.email;
      if (input.city !== undefined) attributes.city = input.city;
      if (input.region !== undefined) attributes.region = input.region;
      if (input.country !== undefined) attributes.country = input.country;
      if (input.status !== undefined) attributes.status = input.status;

      return apiPatch(`/customers/${input.customerId}`, {
        data: {
          type: "customers",
          id: input.customerId,
          attributes,
        },
      });
    },
  },
  {
    name: "ls_archive_customer",
    description:
      "Archive a customer. Sets their status to 'archived'. This is reversible by updating their status back.",
    annotations: {
      title: "Archive customer",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      customerId: z.string().describe("The customer ID to archive"),
    }),
    handler: async (input: { customerId: string }) => {
      return apiPatch(`/customers/${input.customerId}`, {
        data: {
          type: "customers",
          id: input.customerId,
          attributes: { status: "archived" },
        },
      });
    },
  },
] as const;

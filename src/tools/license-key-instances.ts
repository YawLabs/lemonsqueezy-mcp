import { z } from "zod";
import { apiGet, buildQuery } from "../api.js";

export const licenseKeyInstanceTools = [
  {
    name: "ls_get_license_key_instance",
    description: "Get a specific license key instance (activation) by ID, including instance name and creation date.",
    annotations: {
      title: "Get license key instance",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKeyInstanceId: z.string().describe("The license key instance ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'license-key')"),
    }),
    handler: async (input: { licenseKeyInstanceId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/license-key-instances/${input.licenseKeyInstanceId}${query}`);
    },
  },
  {
    name: "ls_list_license_key_instances",
    description: "List all license key instances (activations), optionally filtered by license key.",
    annotations: {
      title: "List license key instances",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKeyId: z.string().optional().describe("Filter by license key ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'license-key')"),
      pageNumber: z.number().optional().describe("Page number (1-indexed)"),
      pageSize: z.number().optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: {
      licenseKeyId?: string;
      include?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => {
      const filter: Record<string, string> = {};
      if (input.licenseKeyId) filter.license_key_id = input.licenseKeyId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/license-key-instances${query}`);
    },
  },
] as const;

import { z } from "zod";
import { getHandler, listHandler } from "../api.js";

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
    handler: getHandler("/license-key-instances", "licenseKeyInstanceId"),
  },
  {
    name: "ls_list_license_key_instances",
    description:
      "List all license key instances (activations), optionally filtered by license key. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
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
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/license-key-instances", { licenseKeyId: "license_key_id" }),
  },
] as const;

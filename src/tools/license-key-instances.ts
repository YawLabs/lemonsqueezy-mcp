import { z } from "zod";
import { crossStoreFilterNote, getHandler, listHandler, lsIdSchema } from "../api.js";

// Drives both `requiredFilters` and the description disclosure -- see prices.ts.
const LIST_LICENSE_KEY_INSTANCES_FILTERS = ["licenseKeyId"] as const;

export const licenseKeyInstanceTools = [
  {
    name: "ls_get_license_key_instance",
    authorityClass: "read" as const,
    description: "Get a specific license key instance (activation) by ID, including instance name and creation date.",
    annotations: {
      title: "Get license key instance",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKeyInstanceId: lsIdSchema.describe("The license key instance ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'license-key')"),
    }),
    handler: getHandler("/license-key-instances", "licenseKeyInstanceId"),
  },
  {
    name: "ls_list_license_key_instances",
    authorityClass: "read" as const,
    description: `List all license key instances (activations), optionally filtered by license key. Results are paginated — check meta.page in the response for currentPage, lastPage, and total. ${crossStoreFilterNote(LIST_LICENSE_KEY_INSTANCES_FILTERS)}`,
    annotations: {
      title: "List license key instances",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKeyId: lsIdSchema.optional().describe("Filter by license key ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'license-key')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    requiredFilters: LIST_LICENSE_KEY_INSTANCES_FILTERS,
    handler: listHandler("/license-key-instances", { licenseKeyId: "license_key_id" }),
  },
] as const;

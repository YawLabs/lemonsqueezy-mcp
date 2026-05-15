import { z } from "zod";
import { getHandler, listHandler, lsIdSchema } from "../api.js";

export const fileTools = [
  {
    name: "ls_get_file",
    authorityClass: "read" as const,
    description: "Get a specific file by ID, including name, size, download URL, and associated variant.",
    annotations: {
      title: "Get file",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      fileId: lsIdSchema.describe("The file ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'variant')"),
    }),
    handler: getHandler("/files", "fileId"),
  },
  {
    name: "ls_list_files",
    authorityClass: "read" as const,
    description:
      "List all files, optionally filtered by variant. Results are paginated — check meta.page in the response for currentPage, lastPage, and total. Cross-store note: when LEMONSQUEEZY_ALLOWED_STORE_IDS is set, this tool requires at least one of: variantId. Even with that set, pair with a scoped LemonSqueezy API key for true cross-store enforcement -- the API key's visibility is the true boundary.",
    annotations: {
      title: "List files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      variantId: lsIdSchema.optional().describe("Filter by variant ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'variant')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    requiredFilters: ["variantId"] as const,
    handler: listHandler("/files", { variantId: "variant_id" }),
  },
] as const;

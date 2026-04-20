import { z } from "zod";
import { getHandler, listHandler } from "../api.js";

export const fileTools = [
  {
    name: "ls_get_file",
    description: "Get a specific file by ID, including name, size, download URL, and associated variant.",
    annotations: {
      title: "Get file",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      fileId: z.string().max(10000).describe("The file ID"),
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
    description:
      "List all files, optionally filtered by variant. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      variantId: z.string().max(10000).optional().describe("Filter by variant ID"),
      include: z
        .string()
        .max(10000)
        .optional()
        .describe("Comma-separated related resources to include (e.g. 'variant')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/files", { variantId: "variant_id" }),
  },
] as const;

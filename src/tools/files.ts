import { z } from "zod";
import { apiGet, buildQuery } from "../api.js";

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
      fileId: z.string().describe("The file ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'variant')"),
    }),
    handler: async (input: { fileId: string; include?: string }) => {
      const query = buildQuery({ include: input.include?.split(",") });
      return apiGet(`/files/${input.fileId}${query}`);
    },
  },
  {
    name: "ls_list_files",
    description: "List all files, optionally filtered by variant.",
    annotations: {
      title: "List files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      variantId: z.string().optional().describe("Filter by variant ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'variant')"),
      pageNumber: z.number().optional().describe("Page number (1-indexed)"),
      pageSize: z.number().optional().describe("Results per page (1-100)"),
    }),
    handler: async (input: { variantId?: string; include?: string; pageNumber?: number; pageSize?: number }) => {
      const filter: Record<string, string> = {};
      if (input.variantId) filter.variant_id = input.variantId;
      const query = buildQuery({
        include: input.include?.split(","),
        filter,
        page: { number: input.pageNumber, size: input.pageSize },
      });
      return apiGet(`/files${query}`);
    },
  },
] as const;

import { z } from "zod";
import { getHandler, listHandler } from "../api.js";

export const affiliateTools = [
  {
    name: "ls_get_affiliate",
    description: "Get a specific affiliate by ID, including commission rate, status, and earnings.",
    annotations: {
      title: "Get affiliate",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      affiliateId: z.string().describe("The affiliate ID"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'store,user')"),
    }),
    handler: getHandler("/affiliates", "affiliateId"),
  },
  {
    name: "ls_list_affiliates",
    description:
      "List all affiliates for the authenticated user's stores, optionally filtered by user email. Results are paginated — check meta.page in the response for currentPage, lastPage, and total.",
    annotations: {
      title: "List affiliates",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      userEmail: z.string().email().optional().describe("Filter by affiliate's user email"),
      include: z.string().optional().describe("Comma-separated related resources to include (e.g. 'store,user')"),
      pageNumber: z.number().int().min(1).optional().describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
    }),
    handler: listHandler("/affiliates", { userEmail: "user_email" }),
  },
] as const;

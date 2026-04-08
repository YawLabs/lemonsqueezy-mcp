import { z } from "zod";
import { apiGet } from "../api.js";

export const userTools = [
  {
    name: "ls_get_user",
    description: "Get the authenticated user's information including name, email, and avatar.",
    annotations: {
      title: "Get authenticated user",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({}),
    handler: async () => {
      return apiGet("/users/me");
    },
  },
] as const;

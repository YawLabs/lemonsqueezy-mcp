import { z } from "zod";
import { licenseRequest } from "../api.js";

export const licenseTools = [
  {
    name: "ls_activate_license",
    description:
      "Activate a license key for an instance. Does not require an API key — uses the license key itself for auth.",
    annotations: {
      title: "Activate license",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKey: z.string().describe("The license key to activate"),
      instanceName: z.string().describe("A name for this activation instance (e.g. machine name, user identifier)"),
    }),
    handler: async (input: { licenseKey: string; instanceName: string }) => {
      return licenseRequest("/licenses/activate", {
        license_key: input.licenseKey,
        instance_name: input.instanceName,
      });
    },
  },
  {
    name: "ls_validate_license",
    description:
      "Validate a license key or specific instance. Does not require an API key — uses the license key itself for auth.",
    annotations: {
      title: "Validate license",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKey: z.string().describe("The license key to validate"),
      instanceId: z.string().optional().describe("Optional instance ID to validate a specific activation"),
    }),
    handler: async (input: { licenseKey: string; instanceId?: string }) => {
      const body: Record<string, string> = { license_key: input.licenseKey };
      if (input.instanceId) body.instance_id = input.instanceId;
      return licenseRequest("/licenses/validate", body);
    },
  },
  {
    name: "ls_deactivate_license",
    description:
      "Deactivate a license key instance. Does not require an API key — uses the license key itself for auth.",
    annotations: {
      title: "Deactivate license",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      licenseKey: z.string().describe("The license key"),
      instanceId: z.string().describe("The instance ID to deactivate"),
    }),
    handler: async (input: { licenseKey: string; instanceId: string }) => {
      return licenseRequest("/licenses/deactivate", {
        license_key: input.licenseKey,
        instance_id: input.instanceId,
      });
    },
  },
] as const;

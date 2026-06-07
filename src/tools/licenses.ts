import { z } from "zod";
import { licenseRequest } from "../api.js";

// The three License-API tools below are intentionally NOT destructiveHint:true,
// so they bypass the audit buffer and the destructive rate limit. ls_activate
// grants access and ls_validate is read-only -- neither is access-revoking.
// ls_deactivate DOES revoke an instance's access, but its input carries the raw
// `licenseKey`, which redactSecrets() deliberately preserves (it is a business
// identifier, not a secret-named key -- see redact.ts). Auditing it would write
// live license keys into the in-memory buffer and the lemonsqueezy://audit-log
// MCP resource. Admin-side revocation that SHOULD be audited goes through
// ls_update_license_key (disabled:true), whose input is an opaque licenseKeyId,
// not the key itself.
export const licenseTools = [
  {
    name: "ls_activate_license",
    authorityClass: "key" as const,
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
      licenseKey: z.string().max(10000).describe("The license key to activate"),
      instanceName: z
        .string()
        .max(10000)
        .describe("A name for this activation instance (e.g. machine name, user identifier)"),
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
    authorityClass: "read" as const,
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
      licenseKey: z.string().max(10000).describe("The license key to validate"),
      instanceId: z.string().max(10000).optional().describe("Optional instance ID to validate a specific activation"),
    }),
    handler: async (input: { licenseKey: string; instanceId?: string }) => {
      const body: Record<string, string> = { license_key: input.licenseKey };
      if (input.instanceId !== undefined) body.instance_id = input.instanceId;
      return licenseRequest("/licenses/validate", body);
    },
  },
  {
    name: "ls_deactivate_license",
    authorityClass: "key" as const,
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
      licenseKey: z.string().max(10000).describe("The license key"),
      instanceId: z.string().max(10000).describe("The instance ID to deactivate"),
    }),
    handler: async (input: { licenseKey: string; instanceId: string }) => {
      return licenseRequest("/licenses/deactivate", {
        license_key: input.licenseKey,
        instance_id: input.instanceId,
      });
    },
  },
] as const;

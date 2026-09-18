import { z } from "zod";
import { licenseRequest } from "../api.js";

// The three License-API tools authenticate with the caller-supplied license
// key, not the API key (`licenseRequest` in api.ts sends no Authorization
// header), and have no storeId field or requiredFilters. So neither a scoped
// API key nor LEMONSQUEEZY_ALLOWED_STORE_IDS limits them: they work on any
// account's keys. The class gates (LEMONSQUEEZY_DISABLE_CLASSES and
// LEMONSQUEEZY_RATE_LIMIT_PER_CLASS) and, for deactivate, the destructive
// rate limit and audit log are the only per-call controls (see item 4 of the
// scope note at the top of guardrails.ts).
//
//   - ls_deactivate_license is destructive on every call (static
//     destructiveHint:true, no predicate): it revokes an instance's access and
//     no input makes it a read. Its `licenseKey` input is a bearer credential,
//     so redactSecrets() masks it by key name before it reaches any audit sink
//     -- stderr, the audit ring, and the lemonsqueezy://audit-log resource
//     (see LICENSE_KEY_RE / maskLicenseKey in redact.ts). The flip and the mask
//     ship together: without the mask, auditing would write live keys to all
//     three.
//   - ls_activate_license stays destructiveHint:false: activation is additive
//     (MCP defines false as "performs only additive updates").
//   - ls_validate_license is read-only, and in class `read`, not `key`.
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
      "Deactivate a license key instance, revoking that instance's access. Destructive: rate-limited and audited, with the license key masked in the audit entry. Does not require an API key — uses the license key itself for auth.",
    annotations: {
      title: "Deactivate license",
      readOnlyHint: false,
      destructiveHint: true,
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

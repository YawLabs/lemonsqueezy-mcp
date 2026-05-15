#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pushAuditEntry, readAuditEntries } from "./audit-buffer.js";
import {
  checkClassAllowed,
  checkClassRateLimit,
  checkDestructiveRateLimit,
  checkStoreScopedToolInput,
  GuardrailError,
  isDestructiveCall,
} from "./guardrails.js";
import { logEvent } from "./logger.js";
import { redactSecrets } from "./redact.js";
import { affiliateTools } from "./tools/affiliates.js";
import { checkoutTools } from "./tools/checkouts.js";
import { customerTools } from "./tools/customers.js";
import { discountRedemptionTools } from "./tools/discount-redemptions.js";
import { discountTools } from "./tools/discounts.js";
import { fileTools } from "./tools/files.js";
import { licenseKeyInstanceTools } from "./tools/license-key-instances.js";
import { licenseKeyTools } from "./tools/license-keys.js";
import { licenseTools } from "./tools/licenses.js";
import { orderItemTools } from "./tools/order-items.js";
import { orderTools } from "./tools/orders.js";
import { priceTools } from "./tools/prices.js";
import { productTools } from "./tools/products.js";
import { storeTools } from "./tools/stores.js";
import { subscriptionInvoiceTools } from "./tools/subscription-invoices.js";
import { subscriptionItemTools } from "./tools/subscription-items.js";
import { subscriptionTools } from "./tools/subscriptions.js";
import { usageRecordTools } from "./tools/usage-records.js";
import { userTools } from "./tools/users.js";
import { variantTools } from "./tools/variants.js";
import { webhookTools } from "./tools/webhooks.js";

// Injected at build time by esbuild; falls back to reading package.json for tsc builds.
declare const __VERSION__: string | undefined;
const version =
  typeof __VERSION__ !== "undefined"
    ? __VERSION__
    : ((await import("node:module")).createRequire(import.meta.url)("../package.json") as { version: string }).version;

// ─── CLI subcommands (run instead of MCP server) ───

const subcommand = process.argv[2];

if (subcommand === "version" || subcommand === "--version") {
  console.log(version);
  process.exit(0);
}

// ─── No subcommand — start the MCP server ───

const allTools = [
  ...userTools,
  ...storeTools,
  ...customerTools,
  ...productTools,
  ...variantTools,
  ...priceTools,
  ...fileTools,
  ...orderTools,
  ...orderItemTools,
  ...subscriptionTools,
  ...subscriptionInvoiceTools,
  ...subscriptionItemTools,
  ...usageRecordTools,
  ...discountTools,
  ...discountRedemptionTools,
  ...licenseKeyTools,
  ...licenseKeyInstanceTools,
  ...checkoutTools,
  ...webhookTools,
  ...licenseTools,
  ...affiliateTools,
];

const server = new McpServer({
  name: "@yawlabs/lemonsqueezy-mcp",
  version,
});

// Register all tools with annotations
for (const tool of allTools) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema.shape,
    tool.annotations,
    async (input: Record<string, unknown>) => {
      // The MCP SDK validates `input` against `tool.inputSchema.shape` before
      // invoking this wrapper -- see `validateToolInput` in
      // @modelcontextprotocol/sdk/server/mcp.js, which runs safeParseAsync
      // against the registered schema and only calls the handler on success.
      // So by the time isDestructiveCall and checkStoreScopedToolInput run,
      // fields like `pause` / `status` / `storeId` are already type- and
      // shape-checked. The `Record<string, unknown>` parameter type is the
      // SDK's contract surface, not a signal that the input is unvalidated.
      // If the SDK ever changes to skip pre-validation, the destructive-
      // routing audit invariant breaks because malformed inputs could miss
      // the predicate -- run validation here as well in that case.
      const isDestructive = isDestructiveCall(tool, input);
      const start = Date.now();
      try {
        // Authority-class gates run first -- if the operator has disabled the
        // class or set a per-class rate limit, we want to reject before
        // touching the destructive timestamp ring or the storeId allowlist.
        // checkClassAllowed throws synchronously; checkClassRateLimit may also
        // throw. Both are recorded as guardrail_block in the catch below.
        checkClassAllowed(tool.authorityClass);
        checkClassRateLimit(tool.authorityClass);
        if (isDestructive) checkDestructiveRateLimit();
        checkStoreScopedToolInput(tool, input);

        const result = await (tool.handler as (input: unknown) => Promise<unknown>)(input);
        const response = result as { ok: boolean; data?: unknown; error?: string; requestId?: string };

        const latency_ms = Date.now() - start;
        // Inputs are logged ONLY for destructive calls. No destructive
        // tool today accepts a secret-typed input (webhook secret tools
        // are non-destructive), but redactSecrets() runs unconditionally
        // as defense-in-depth -- if a tool with secret-bearing inputs is
        // ever flipped to destructiveHint:true, the audit log won't leak.
        const successEntry = {
          event: "tool_call" as const,
          tool: tool.name,
          status: response.ok ? ("ok" as const) : ("error" as const),
          latency_ms,
          request_id: response.requestId,
          error: response.ok ? undefined : response.error,
          audit: isDestructive ? true : undefined,
          inputs: isDestructive ? redactSecrets(input) : undefined,
        };
        logEvent(successEntry);
        if (isDestructive) {
          pushAuditEntry({ ts: new Date().toISOString(), ...successEntry });
        }

        if (!response.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${response.error || "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        const text = JSON.stringify(response.data ?? { success: true }, null, 2);
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const latency_ms = Date.now() - start;
        const errorEntry = {
          event: "tool_call" as const,
          tool: tool.name,
          status: err instanceof GuardrailError ? ("guardrail_block" as const) : ("exception" as const),
          latency_ms,
          error: message,
          audit: isDestructive ? true : undefined,
          inputs: isDestructive ? redactSecrets(input) : undefined,
        };
        logEvent(errorEntry);
        if (isDestructive) {
          pushAuditEntry({ ts: new Date().toISOString(), ...errorEntry });
        }
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

// Expose the in-memory destructive-call audit log as a read-only MCP
// Resource so clients without stderr access can retrieve it structurally.
// The buffer is filled in the tool wrapper above (after every destructive
// success/failure log line). The resource is read-only -- there is no
// matching write side.
//
// SDK signature (mcp.d.ts:87):
//   resource(name, uri, metadata, readCallback): RegisteredResource
// readCallback returns { contents: [{ uri, mimeType?, text }] }
//   -- see ReadResourceResultSchema in @modelcontextprotocol/sdk types.
server.resource(
  "Recent destructive-call audit log",
  "lemonsqueezy://audit-log",
  {
    description:
      "The most recent destructive tool calls and their outcomes (rate limit, refund cap, etc.). Bounded ring buffer; resets on server restart.",
    mimeType: "application/x-ndjson",
  },
  async (uri) => {
    const entries = readAuditEntries();
    const text = entries.map((e) => JSON.stringify(e)).join("\n");
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/x-ndjson",
          text,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

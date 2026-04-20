#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GuardrailError, checkDestructiveRateLimit, checkStoreAllowed } from "./guardrails.js";
import { logEvent } from "./logger.js";
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
  const isDestructive = tool.annotations?.destructiveHint === true;

  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema.shape,
    tool.annotations,
    async (input: Record<string, unknown>) => {
      const start = Date.now();
      try {
        if (isDestructive) checkDestructiveRateLimit();
        const storeId = input.storeId;
        if (typeof storeId === "string") checkStoreAllowed(storeId);

        const result = await (tool.handler as (input: unknown) => Promise<unknown>)(input);
        const response = result as { ok: boolean; data?: unknown; error?: string; requestId?: string };

        const latency_ms = Date.now() - start;
        logEvent({
          event: "tool_call",
          tool: tool.name,
          status: response.ok ? "ok" : "error",
          latency_ms,
          request_id: response.requestId,
          error: response.ok ? undefined : response.error,
          audit: isDestructive ? true : undefined,
          inputs: isDestructive ? input : undefined,
        });

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
        logEvent({
          event: "tool_call",
          tool: tool.name,
          status: err instanceof GuardrailError ? "guardrail_block" : "exception",
          latency_ms,
          error: message,
          audit: isDestructive ? true : undefined,
          inputs: isDestructive ? input : undefined,
        });
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);

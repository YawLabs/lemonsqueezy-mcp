#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadGuardrailOptions } from "./guardrails.js";
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
import { sinkTools } from "./tools/sink.js";
import { storeTools } from "./tools/stores.js";
import { subscriptionInvoiceTools } from "./tools/subscription-invoices.js";
import { subscriptionItemTools } from "./tools/subscription-items.js";
import { subscriptionTools } from "./tools/subscriptions.js";
import { usageRecordTools } from "./tools/usage-records.js";
import { userTools } from "./tools/users.js";
import { variantTools } from "./tools/variants.js";
import { webhookTools } from "./tools/webhooks.js";
import { createToolHandler, type RegisterableTool, readAuditLogResource } from "./wrapper.js";

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

// Parse every guardrail env var up front so a typo'd LEMONSQUEEZY_DISABLE_CLASSES
// or malformed LEMONSQUEEZY_RATE_LIMIT_PER_CLASS crashes boot rather than the
// first tool call.
loadGuardrailOptions();

// The array holds tools with heterogeneous strict input types
// (every tool has a different Zod schema). `RegisterableTool<any>`
// is the only type that absorbs the union; individual callers
// (tests, helpers) get full type safety by supplying TInput
// when they invoke createToolHandler.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const allTools: RegisterableTool<any>[] = [
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
  ...sinkTools,
];

const server = new McpServer({
  name: "@yawlabs/lemonsqueezy-mcp",
  version,
});

for (const tool of allTools) {
  server.tool(tool.name, tool.description, tool.inputSchema.shape, tool.annotations, createToolHandler(tool));
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
  async (uri) => readAuditLogResource(uri),
);

const transport = new StdioServerTransport();
await server.connect(transport);

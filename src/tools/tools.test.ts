import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { affiliateTools } from "./affiliates.js";
import { checkoutTools } from "./checkouts.js";
import { customerTools } from "./customers.js";
import { discountRedemptionTools } from "./discount-redemptions.js";
import { discountTools } from "./discounts.js";
import { fileTools } from "./files.js";
import { licenseKeyInstanceTools } from "./license-key-instances.js";
import { licenseKeyTools } from "./license-keys.js";
import { licenseTools } from "./licenses.js";
import { orderItemTools } from "./order-items.js";
import { orderTools } from "./orders.js";
import { priceTools } from "./prices.js";
import { productTools } from "./products.js";
import { storeTools } from "./stores.js";
import { subscriptionInvoiceTools } from "./subscription-invoices.js";
import { subscriptionItemTools } from "./subscription-items.js";
import { subscriptionTools } from "./subscriptions.js";
import { usageRecordTools } from "./usage-records.js";
import { userTools } from "./users.js";
import { variantTools } from "./variants.js";
import { webhookTools } from "./webhooks.js";

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

describe("Tool definitions", () => {
  it("should have no duplicate tool names", () => {
    const names = allTools.map((t) => t.name);
    const unique = new Set(names);
    assert.equal(
      names.length,
      unique.size,
      `Duplicate tool names found: ${names.filter((n, i) => names.indexOf(n) !== i)}`,
    );
  });

  it("should have the expected total tool count", () => {
    assert.equal(allTools.length, 61);
  });

  for (const tool of allTools) {
    describe(tool.name, () => {
      it("should have a non-empty name", () => {
        assert.ok(tool.name.length > 0);
      });

      it("should have a name prefixed with ls_", () => {
        assert.ok(tool.name.startsWith("ls_"), `Tool name ${tool.name} should start with ls_`);
      });

      it("should have a non-empty description", () => {
        assert.ok(tool.description.length > 0);
      });

      it("should have a Zod input schema", () => {
        assert.ok(tool.inputSchema);
        assert.ok(typeof tool.inputSchema.shape === "object");
      });

      it("should have an async handler function", () => {
        assert.equal(typeof tool.handler, "function");
      });

      it("should have annotations with required hints", () => {
        assert.ok(tool.annotations, `Tool ${tool.name} is missing annotations`);
        assert.equal(typeof tool.annotations.readOnlyHint, "boolean", `Tool ${tool.name} missing readOnlyHint`);
        assert.equal(typeof tool.annotations.destructiveHint, "boolean", `Tool ${tool.name} missing destructiveHint`);
        assert.equal(typeof tool.annotations.idempotentHint, "boolean", `Tool ${tool.name} missing idempotentHint`);
        assert.equal(typeof tool.annotations.openWorldHint, "boolean", `Tool ${tool.name} missing openWorldHint`);
      });
    });
  }
});

describe("Tool modules export correct counts", () => {
  it("userTools has 1 tool", () => assert.equal(userTools.length, 1));
  it("storeTools has 2 tools", () => assert.equal(storeTools.length, 2));
  it("customerTools has 5 tools", () => assert.equal(customerTools.length, 5));
  it("productTools has 2 tools", () => assert.equal(productTools.length, 2));
  it("variantTools has 2 tools", () => assert.equal(variantTools.length, 2));
  it("priceTools has 2 tools", () => assert.equal(priceTools.length, 2));
  it("fileTools has 2 tools", () => assert.equal(fileTools.length, 2));
  it("orderTools has 4 tools", () => assert.equal(orderTools.length, 4));
  it("orderItemTools has 2 tools", () => assert.equal(orderItemTools.length, 2));
  it("subscriptionTools has 4 tools", () => assert.equal(subscriptionTools.length, 4));
  it("subscriptionInvoiceTools has 4 tools", () => assert.equal(subscriptionInvoiceTools.length, 4));
  it("subscriptionItemTools has 4 tools", () => assert.equal(subscriptionItemTools.length, 4));
  it("usageRecordTools has 3 tools", () => assert.equal(usageRecordTools.length, 3));
  it("discountTools has 4 tools", () => assert.equal(discountTools.length, 4));
  it("discountRedemptionTools has 2 tools", () => assert.equal(discountRedemptionTools.length, 2));
  it("licenseKeyTools has 3 tools", () => assert.equal(licenseKeyTools.length, 3));
  it("licenseKeyInstanceTools has 2 tools", () => assert.equal(licenseKeyInstanceTools.length, 2));
  it("checkoutTools has 3 tools", () => assert.equal(checkoutTools.length, 3));
  it("webhookTools has 5 tools", () => assert.equal(webhookTools.length, 5));
  it("licenseTools has 3 tools", () => assert.equal(licenseTools.length, 3));
  it("affiliateTools has 2 tools", () => assert.equal(affiliateTools.length, 2));
});

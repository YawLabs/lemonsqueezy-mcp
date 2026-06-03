import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { GuardrailError, _resetGuardrailsForTest } from "../guardrails.js";
import { _resetApiKeyCacheForTest } from "../secret.js";
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

// ─── Test helpers ───

// biome-ignore lint/suspicious/noExplicitAny: test assertions need deep property access on arbitrary JSON bodies
type AnyBody = any;

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let lastRequest: CapturedRequest | undefined;
const originalFetch = globalThis.fetch;

function mockFetch(status = 200, responseData: unknown = { data: { id: "1" } }) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    let body: unknown;
    if (init?.body) {
      const raw = init.body.toString();
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    lastRequest = { url, method, headers, body };

    if (status === 204) {
      return new Response(null, {
        status: 204,
        headers: { "content-length": "0" },
      });
    }
    return new Response(JSON.stringify(responseData), {
      status,
      headers: { "Content-Type": "application/vnd.api+json" },
    });
  }) as typeof fetch;
}

// biome-ignore lint/complexity/noBannedTypes: test helper needs generic function matching
function findTool(tools: readonly { name: string; handler: Function }[], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

// Tools have heterogeneous Zod input schemas; tests need a uniform `.safeParse(...)`
// view to assert validation behavior.
type SchemaParser = { safeParse: (input: unknown) => { success: boolean } };
function inputSchema(tool: { name: string }): SchemaParser {
  return (tool as unknown as { inputSchema: SchemaParser }).inputSchema;
}

const BASE = "https://api.lemonsqueezy.com/v1";

// ─── Setup / teardown ───

// Save and clear ALL three key-source env vars so tests run in isolation.
// CI may inject LEMONSQUEEZY_TEST_API_KEY (for integration tests) or
// LEMONSQUEEZY_API_KEY_COMMAND -- either would take precedence over the
// in-test "test-key-123" stub via the secret.ts priority chain, breaking
// assertions that hard-code that string or expect "missing key" behavior.
const savedKeyEnv = {
  LEMONSQUEEZY_API_KEY: process.env.LEMONSQUEEZY_API_KEY,
  LEMONSQUEEZY_TEST_API_KEY: process.env.LEMONSQUEEZY_TEST_API_KEY,
  LEMONSQUEEZY_API_KEY_COMMAND: process.env.LEMONSQUEEZY_API_KEY_COMMAND,
};

before(() => {
  delete process.env.LEMONSQUEEZY_TEST_API_KEY;
  delete process.env.LEMONSQUEEZY_API_KEY_COMMAND;
  process.env.LEMONSQUEEZY_API_KEY = "test-key-123";
  _resetApiKeyCacheForTest();
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(savedKeyEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetApiKeyCacheForTest();
});

beforeEach(() => {
  lastRequest = undefined;
  mockFetch();
});

// ─── Users ───

describe("User handlers", () => {
  it("ls_get_user calls GET /users/me", async () => {
    const tool = findTool(userTools, "ls_get_user");
    await tool.handler({});
    assert.equal(lastRequest!.method, "GET");
    assert.equal(lastRequest!.url, `${BASE}/users/me`);
    assert.equal(lastRequest!.headers.Authorization, "Bearer test-key-123");
  });
});

// ─── Stores ───

describe("Store handlers", () => {
  it("ls_get_store calls GET /stores/:id", async () => {
    const tool = findTool(storeTools, "ls_get_store");
    await tool.handler({ storeId: "42" });
    assert.equal(lastRequest!.method, "GET");
    assert.ok(lastRequest!.url.startsWith(`${BASE}/stores/42`));
  });

  it("ls_get_store passes include param", async () => {
    const tool = findTool(storeTools, "ls_get_store");
    await tool.handler({ storeId: "42", include: "products,orders" });
    assert.ok(lastRequest!.url.includes("include=products%2Corders"));
  });

  it("ls_list_stores calls GET /stores", async () => {
    const tool = findTool(storeTools, "ls_list_stores");
    await tool.handler({});
    assert.equal(lastRequest!.method, "GET");
    assert.ok(lastRequest!.url.startsWith(`${BASE}/stores`));
  });

  it("ls_list_stores passes pagination", async () => {
    const tool = findTool(storeTools, "ls_list_stores");
    await tool.handler({ pageNumber: 2, pageSize: 10 });
    assert.ok(lastRequest!.url.includes("page[number]=2"));
    assert.ok(lastRequest!.url.includes("page[size]=10"));
  });
});

// ─── Customers ───

describe("Customer handlers", () => {
  it("ls_get_customer calls GET /customers/:id", async () => {
    const tool = findTool(customerTools, "ls_get_customer");
    await tool.handler({ customerId: "99" });
    assert.equal(lastRequest!.method, "GET");
    assert.ok(lastRequest!.url.startsWith(`${BASE}/customers/99`));
  });

  it("ls_list_customers applies filters", async () => {
    const tool = findTool(customerTools, "ls_list_customers");
    await tool.handler({ storeId: "1", email: "test@example.com" });
    assert.equal(lastRequest!.method, "GET");
    assert.ok(lastRequest!.url.includes("filter[store_id]=1"));
    assert.ok(lastRequest!.url.includes("filter[email]=test%40example.com"));
  });

  it("ls_create_customer sends correct JSON:API body", async () => {
    const tool = findTool(customerTools, "ls_create_customer");
    await tool.handler({ storeId: "1", name: "Jane", email: "jane@example.com", city: "NYC" });
    assert.equal(lastRequest!.method, "POST");
    assert.equal(lastRequest!.url, `${BASE}/customers`);
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "customers");
    assert.equal(body.data.attributes.name, "Jane");
    assert.equal(body.data.attributes.email, "jane@example.com");
    assert.equal(body.data.attributes.city, "NYC");
    assert.equal(body.data.relationships.store.data.id, "1");
  });

  it("ls_create_customer omits optional fields when not provided", async () => {
    const tool = findTool(customerTools, "ls_create_customer");
    await tool.handler({ storeId: "1", name: "Jane", email: "jane@example.com" });
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.city, undefined);
    assert.equal(body.data.attributes.region, undefined);
    assert.equal(body.data.attributes.country, undefined);
  });

  it("ls_update_customer sends PATCH with only provided fields", async () => {
    const tool = findTool(customerTools, "ls_update_customer");
    await tool.handler({ customerId: "99", name: "Updated" });
    assert.equal(lastRequest!.method, "PATCH");
    assert.equal(lastRequest!.url, `${BASE}/customers/99`);
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "customers");
    assert.equal(body.data.id, "99");
    assert.equal(body.data.attributes.name, "Updated");
    assert.equal(body.data.attributes.email, undefined);
  });

  it("ls_archive_customer sends PATCH with status=archived", async () => {
    const tool = findTool(customerTools, "ls_archive_customer");
    await tool.handler({ customerId: "99" });
    assert.equal(lastRequest!.method, "PATCH");
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.status, "archived");
  });
});

// ─── Products ───

describe("Product handlers", () => {
  it("ls_get_product calls GET /products/:id", async () => {
    const tool = findTool(productTools, "ls_get_product");
    await tool.handler({ productId: "10" });
    assert.equal(lastRequest!.method, "GET");
    assert.ok(lastRequest!.url.startsWith(`${BASE}/products/10`));
  });

  it("ls_list_products filters by store", async () => {
    const tool = findTool(productTools, "ls_list_products");
    await tool.handler({ storeId: "5" });
    assert.ok(lastRequest!.url.includes("filter[store_id]=5"));
  });
});

// ─── Variants ───

describe("Variant handlers", () => {
  it("ls_get_variant calls GET /variants/:id", async () => {
    const tool = findTool(variantTools, "ls_get_variant");
    await tool.handler({ variantId: "7" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/variants/7`));
  });

  it("ls_list_variants filters by product", async () => {
    const tool = findTool(variantTools, "ls_list_variants");
    await tool.handler({ productId: "10" });
    assert.ok(lastRequest!.url.includes("filter[product_id]=10"));
  });
});

// ─── Prices ───

describe("Price handlers", () => {
  it("ls_get_price calls GET /prices/:id", async () => {
    const tool = findTool(priceTools, "ls_get_price");
    await tool.handler({ priceId: "3" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/prices/3`));
  });

  it("ls_list_prices filters by variant", async () => {
    const tool = findTool(priceTools, "ls_list_prices");
    await tool.handler({ variantId: "7" });
    assert.ok(lastRequest!.url.includes("filter[variant_id]=7"));
  });
});

// ─── Files ───

describe("File handlers", () => {
  it("ls_get_file calls GET /files/:id", async () => {
    const tool = findTool(fileTools, "ls_get_file");
    await tool.handler({ fileId: "55" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/files/55`));
  });

  it("ls_list_files filters by variant", async () => {
    const tool = findTool(fileTools, "ls_list_files");
    await tool.handler({ variantId: "7" });
    assert.ok(lastRequest!.url.includes("filter[variant_id]=7"));
  });
});

// ─── Orders ───

describe("Order handlers", () => {
  it("ls_get_order calls GET /orders/:id", async () => {
    const tool = findTool(orderTools, "ls_get_order");
    await tool.handler({ orderId: "100" });
    assert.equal(lastRequest!.method, "GET");
    assert.ok(lastRequest!.url.startsWith(`${BASE}/orders/100`));
  });

  it("ls_list_orders filters by store and email", async () => {
    const tool = findTool(orderTools, "ls_list_orders");
    await tool.handler({ storeId: "1", userEmail: "a@b.com" });
    assert.ok(lastRequest!.url.includes("filter[store_id]=1"));
    assert.ok(lastRequest!.url.includes("filter[user_email]=a%40b.com"));
  });

  it("ls_generate_order_invoice sends POST with invoice details as query params", async () => {
    const tool = findTool(orderTools, "ls_generate_order_invoice");
    await tool.handler({ orderId: "100", name: "Acme", country: "US" });
    assert.equal(lastRequest!.method, "POST");
    assert.ok(lastRequest!.url.includes("/orders/100/generate-invoice?"));
    assert.ok(lastRequest!.url.includes("name=Acme"));
    assert.ok(lastRequest!.url.includes("country=US"));
    assert.equal(lastRequest!.body, undefined);
  });

  it("ls_generate_order_invoice sends all invoice fields as query params", async () => {
    const tool = findTool(orderTools, "ls_generate_order_invoice");
    await tool.handler({
      orderId: "100",
      name: "Acme Corp",
      address: "123 Main St",
      city: "New York",
      state: "NY",
      zipCode: "10001",
      country: "US",
      notes: "Thank you for your purchase",
    });
    const url = lastRequest!.url;
    assert.ok(url.includes("name=Acme+Corp"));
    assert.ok(url.includes("address=123+Main+St"));
    assert.ok(url.includes("city=New+York"));
    assert.ok(url.includes("state=NY"));
    assert.ok(url.includes("zip_code=10001"));
    assert.ok(url.includes("country=US"));
    assert.ok(url.includes("notes=Thank+you+for+your+purchase"));
    assert.equal(lastRequest!.body, undefined);
  });

  it("ls_refund_order sends POST with refund amount", async () => {
    const tool = findTool(orderTools, "ls_refund_order");
    await tool.handler({ orderId: "100", amount: 500 });
    assert.equal(lastRequest!.method, "POST");
    assert.ok(lastRequest!.url.includes("/orders/100/refund"));
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "orders");
    assert.equal(body.data.attributes.amount, 500);
  });
});

// ─── Order Items ───

describe("Order item handlers", () => {
  it("ls_get_order_item calls GET /order-items/:id", async () => {
    const tool = findTool(orderItemTools, "ls_get_order_item");
    await tool.handler({ orderItemId: "200" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/order-items/200`));
  });

  it("ls_list_order_items filters by order and product", async () => {
    const tool = findTool(orderItemTools, "ls_list_order_items");
    await tool.handler({ orderId: "100", productId: "10" });
    assert.ok(lastRequest!.url.includes("filter[order_id]=100"));
    assert.ok(lastRequest!.url.includes("filter[product_id]=10"));
  });
});

// ─── Subscriptions ───

describe("Subscription handlers", () => {
  it("ls_get_subscription calls GET /subscriptions/:id", async () => {
    const tool = findTool(subscriptionTools, "ls_get_subscription");
    await tool.handler({ subscriptionId: "300" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/subscriptions/300`));
  });

  it("ls_list_subscriptions filters by store and status", async () => {
    const tool = findTool(subscriptionTools, "ls_list_subscriptions");
    await tool.handler({ storeId: "1", status: "active" });
    assert.ok(lastRequest!.url.includes("filter[store_id]=1"));
    assert.ok(lastRequest!.url.includes("filter[status]=active"));
  });

  it("ls_update_subscription sends PATCH with attributes", async () => {
    const tool = findTool(subscriptionTools, "ls_update_subscription");
    await tool.handler({ subscriptionId: "300", variantId: "8", billingAnchor: 15 });
    assert.equal(lastRequest!.method, "PATCH");
    assert.equal(lastRequest!.url, `${BASE}/subscriptions/300`);
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "subscriptions");
    assert.equal(body.data.id, "300");
    assert.equal(body.data.attributes.variant_id, 8);
    assert.equal(body.data.attributes.billing_anchor, 15);
  });

  it("ls_update_subscription handles pause mode", async () => {
    const tool = findTool(subscriptionTools, "ls_update_subscription");
    await tool.handler({ subscriptionId: "300", pause: "void" });
    const body = lastRequest!.body as AnyBody;
    assert.deepEqual(body.data.attributes.pause, { mode: "void" });
  });

  it("ls_update_subscription unpause with 'resume' sets null", async () => {
    const tool = findTool(subscriptionTools, "ls_update_subscription");
    await tool.handler({ subscriptionId: "300", pause: "resume" });
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.pause, null);
  });

  it("ls_update_subscription handles cancelled, trialEndsAt, invoiceImmediately, disableProrations", async () => {
    const tool = findTool(subscriptionTools, "ls_update_subscription");
    await tool.handler({
      subscriptionId: "300",
      cancelled: false,
      trialEndsAt: "2026-06-01T00:00:00Z",
      invoiceImmediately: true,
      disableProrations: true,
    });
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.cancelled, false);
    assert.equal(body.data.attributes.trial_ends_at, "2026-06-01T00:00:00Z");
    assert.equal(body.data.attributes.invoice_immediately, true);
    assert.equal(body.data.attributes.disable_prorations, true);
  });

  it("ls_cancel_subscription sends DELETE", async () => {
    mockFetch(204);
    const tool = findTool(subscriptionTools, "ls_cancel_subscription");
    await tool.handler({ subscriptionId: "300" });
    assert.equal(lastRequest!.method, "DELETE");
    assert.equal(lastRequest!.url, `${BASE}/subscriptions/300`);
  });
});

// ─── Subscription Invoices ───

describe("Subscription invoice handlers", () => {
  it("ls_get_subscription_invoice calls GET", async () => {
    const tool = findTool(subscriptionInvoiceTools, "ls_get_subscription_invoice");
    await tool.handler({ subscriptionInvoiceId: "400" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/subscription-invoices/400`));
  });

  it("ls_list_subscription_invoices filters by status", async () => {
    const tool = findTool(subscriptionInvoiceTools, "ls_list_subscription_invoices");
    await tool.handler({ status: "paid" });
    assert.ok(lastRequest!.url.includes("filter[status]=paid"));
  });

  it("ls_generate_subscription_invoice sends POST with query params", async () => {
    const tool = findTool(subscriptionInvoiceTools, "ls_generate_subscription_invoice");
    await tool.handler({ subscriptionInvoiceId: "400", name: "Acme" });
    assert.equal(lastRequest!.method, "POST");
    assert.ok(lastRequest!.url.includes("/subscription-invoices/400/generate-invoice?"));
    assert.ok(lastRequest!.url.includes("name=Acme"));
    assert.equal(lastRequest!.body, undefined);
  });

  it("ls_generate_subscription_invoice sends all invoice fields as query params", async () => {
    const tool = findTool(subscriptionInvoiceTools, "ls_generate_subscription_invoice");
    await tool.handler({
      subscriptionInvoiceId: "400",
      name: "Acme Corp",
      address: "456 Oak Ave",
      city: "Chicago",
      state: "IL",
      zipCode: "60601",
      country: "US",
      notes: "Subscription renewal",
    });
    const url = lastRequest!.url;
    assert.ok(url.includes("name=Acme+Corp"));
    assert.ok(url.includes("address=456+Oak+Ave"));
    assert.ok(url.includes("city=Chicago"));
    assert.ok(url.includes("state=IL"));
    assert.ok(url.includes("zip_code=60601"));
    assert.ok(url.includes("country=US"));
    assert.ok(url.includes("notes=Subscription+renewal"));
    assert.equal(lastRequest!.body, undefined);
  });

  it("ls_refund_subscription_invoice sends POST with amount", async () => {
    const tool = findTool(subscriptionInvoiceTools, "ls_refund_subscription_invoice");
    await tool.handler({ subscriptionInvoiceId: "400", amount: 1000 });
    assert.equal(lastRequest!.method, "POST");
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "subscription-invoices");
    assert.equal(body.data.attributes.amount, 1000);
  });
});

// ─── Subscription Items ───

describe("Subscription item handlers", () => {
  it("ls_get_subscription_item calls GET", async () => {
    const tool = findTool(subscriptionItemTools, "ls_get_subscription_item");
    await tool.handler({ subscriptionItemId: "500" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/subscription-items/500`));
  });

  it("ls_list_subscription_items filters by subscription", async () => {
    const tool = findTool(subscriptionItemTools, "ls_list_subscription_items");
    await tool.handler({ subscriptionId: "300" });
    assert.ok(lastRequest!.url.includes("filter[subscription_id]=300"));
  });

  it("ls_update_subscription_item sends PATCH with quantity", async () => {
    const tool = findTool(subscriptionItemTools, "ls_update_subscription_item");
    await tool.handler({ subscriptionItemId: "500", quantity: 5 });
    assert.equal(lastRequest!.method, "PATCH");
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "subscription-items");
    assert.equal(body.data.attributes.quantity, 5);
  });

  it("ls_get_subscription_item_usage calls GET /current-usage", async () => {
    const tool = findTool(subscriptionItemTools, "ls_get_subscription_item_usage");
    await tool.handler({ subscriptionItemId: "500" });
    assert.equal(lastRequest!.url, `${BASE}/subscription-items/500/current-usage`);
  });
});

// ─── Usage Records ───

describe("Usage record handlers", () => {
  it("ls_get_usage_record calls GET", async () => {
    const tool = findTool(usageRecordTools, "ls_get_usage_record");
    await tool.handler({ usageRecordId: "600" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/usage-records/600`));
  });

  it("ls_list_usage_records filters by subscription item", async () => {
    const tool = findTool(usageRecordTools, "ls_list_usage_records");
    await tool.handler({ subscriptionItemId: "500" });
    assert.ok(lastRequest!.url.includes("filter[subscription_item_id]=500"));
  });

  it("ls_create_usage_record sends correct JSON:API body", async () => {
    const tool = findTool(usageRecordTools, "ls_create_usage_record");
    await tool.handler({ subscriptionItemId: "500", quantity: 10, action: "increment" });
    assert.equal(lastRequest!.method, "POST");
    assert.equal(lastRequest!.url, `${BASE}/usage-records`);
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "usage-records");
    assert.equal(body.data.attributes.quantity, 10);
    assert.equal(body.data.attributes.action, "increment");
    assert.equal(body.data.relationships["subscription-item"].data.id, "500");
  });
});

// ─── Discounts ───

describe("Discount handlers", () => {
  it("ls_get_discount calls GET /discounts/:id", async () => {
    const tool = findTool(discountTools, "ls_get_discount");
    await tool.handler({ discountId: "700" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/discounts/700`));
  });

  it("ls_list_discounts filters by store", async () => {
    const tool = findTool(discountTools, "ls_list_discounts");
    await tool.handler({ storeId: "1" });
    assert.ok(lastRequest!.url.includes("filter[store_id]=1"));
  });

  it("ls_create_discount sends correct body", async () => {
    const tool = findTool(discountTools, "ls_create_discount");
    await tool.handler({
      storeId: "1",
      name: "Summer Sale",
      code: "SUMMER20",
      amount: 20,
      amountType: "percent",
      duration: "once",
    });
    assert.equal(lastRequest!.method, "POST");
    assert.equal(lastRequest!.url, `${BASE}/discounts`);
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "discounts");
    assert.equal(body.data.attributes.name, "Summer Sale");
    assert.equal(body.data.attributes.code, "SUMMER20");
    assert.equal(body.data.attributes.amount, 20);
    assert.equal(body.data.attributes.amount_type, "percent");
    assert.equal(body.data.attributes.duration, "once");
    assert.equal(body.data.relationships.store.data.id, "1");
  });

  it("ls_create_discount with all optional fields", async () => {
    const tool = findTool(discountTools, "ls_create_discount");
    await tool.handler({
      storeId: "1",
      name: "Repeating Discount",
      code: "REPEAT5",
      amount: 500,
      amountType: "fixed",
      duration: "repeating",
      durationInMonths: 3,
      maxRedemptions: 100,
      startsAt: "2026-05-01T00:00:00Z",
      expiresAt: "2026-08-01T00:00:00Z",
    });
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.amount, 500);
    assert.equal(body.data.attributes.amount_type, "fixed");
    assert.equal(body.data.attributes.duration, "repeating");
    assert.equal(body.data.attributes.duration_in_months, 3);
    assert.equal(body.data.attributes.max_redemptions, 100);
    assert.equal(body.data.attributes.starts_at, "2026-05-01T00:00:00Z");
    assert.equal(body.data.attributes.expires_at, "2026-08-01T00:00:00Z");
  });

  it("ls_create_discount with variant limitation", async () => {
    const tool = findTool(discountTools, "ls_create_discount");
    await tool.handler({
      storeId: "1",
      name: "VIP",
      code: "VIP10",
      amount: 10,
      amountType: "percent",
      isLimitedToProducts: true,
      variantIds: ["1", "2", "3"],
    });
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.is_limited_to_products, true);
    assert.ok(body.data.relationships.variants);
    assert.equal(body.data.relationships.variants.data.length, 3);
  });

  it("ls_delete_discount sends DELETE", async () => {
    mockFetch(204);
    const tool = findTool(discountTools, "ls_delete_discount");
    await tool.handler({ discountId: "700" });
    assert.equal(lastRequest!.method, "DELETE");
    assert.equal(lastRequest!.url, `${BASE}/discounts/700`);
  });
});

// ─── Discount Redemptions ───

describe("Discount redemption handlers", () => {
  it("ls_get_discount_redemption calls GET", async () => {
    const tool = findTool(discountRedemptionTools, "ls_get_discount_redemption");
    await tool.handler({ discountRedemptionId: "800" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/discount-redemptions/800`));
  });

  it("ls_list_discount_redemptions filters by discount", async () => {
    const tool = findTool(discountRedemptionTools, "ls_list_discount_redemptions");
    await tool.handler({ discountId: "700" });
    assert.ok(lastRequest!.url.includes("filter[discount_id]=700"));
  });
});

// ─── License Keys ───

describe("License key handlers", () => {
  it("ls_get_license_key calls GET", async () => {
    const tool = findTool(licenseKeyTools, "ls_get_license_key");
    await tool.handler({ licenseKeyId: "900" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/license-keys/900`));
  });

  it("ls_list_license_keys filters by store and product", async () => {
    const tool = findTool(licenseKeyTools, "ls_list_license_keys");
    await tool.handler({ storeId: "1", productId: "10" });
    assert.ok(lastRequest!.url.includes("filter[store_id]=1"));
    assert.ok(lastRequest!.url.includes("filter[product_id]=10"));
  });

  it("ls_update_license_key sends PATCH", async () => {
    const tool = findTool(licenseKeyTools, "ls_update_license_key");
    await tool.handler({ licenseKeyId: "900", activationLimit: 5, disabled: true });
    assert.equal(lastRequest!.method, "PATCH");
    assert.equal(lastRequest!.url, `${BASE}/license-keys/900`);
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "license-keys");
    assert.equal(body.data.attributes.activation_limit, 5);
    assert.equal(body.data.attributes.disabled, true);
  });

  it("ls_update_license_key forwards null expiresAt to clear expiry", async () => {
    const tool = findTool(licenseKeyTools, "ls_update_license_key");
    await tool.handler({ licenseKeyId: "900", expiresAt: null });
    assert.equal(lastRequest!.method, "PATCH");
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.expires_at, null);
  });
});

// ─── License Key Instances ───

describe("License key instance handlers", () => {
  it("ls_get_license_key_instance calls GET", async () => {
    const tool = findTool(licenseKeyInstanceTools, "ls_get_license_key_instance");
    await tool.handler({ licenseKeyInstanceId: "1000" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/license-key-instances/1000`));
  });

  it("ls_list_license_key_instances filters by license key", async () => {
    const tool = findTool(licenseKeyInstanceTools, "ls_list_license_key_instances");
    await tool.handler({ licenseKeyId: "900" });
    assert.ok(lastRequest!.url.includes("filter[license_key_id]=900"));
  });
});

// ─── Checkouts ───

describe("Checkout handlers", () => {
  it("ls_get_checkout calls GET /checkouts/:id", async () => {
    const tool = findTool(checkoutTools, "ls_get_checkout");
    await tool.handler({ checkoutId: "1100" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/checkouts/1100`));
  });

  it("ls_list_checkouts filters by store and variant", async () => {
    const tool = findTool(checkoutTools, "ls_list_checkouts");
    await tool.handler({ storeId: "1", variantId: "7" });
    assert.ok(lastRequest!.url.includes("filter[store_id]=1"));
    assert.ok(lastRequest!.url.includes("filter[variant_id]=7"));
  });

  it("ls_create_checkout sends correct body with relationships", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({ storeId: "1", variantId: "7", customPrice: 999, email: "buyer@example.com" });
    assert.equal(lastRequest!.method, "POST");
    assert.equal(lastRequest!.url, `${BASE}/checkouts`);
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "checkouts");
    assert.equal(body.data.attributes.custom_price, 999);
    assert.equal(body.data.attributes.checkout_data.email, "buyer@example.com");
    assert.equal(body.data.relationships.store.data.id, "1");
    assert.equal(body.data.relationships.variant.data.id, "7");
  });

  it("ls_create_checkout handles billing address fields", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({
      storeId: "1",
      variantId: "7",
      billingAddressCountry: "US",
      billingAddressZip: "10001",
    });
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.checkout_data.billing_address.country, "US");
    assert.equal(body.data.attributes.checkout_data.billing_address.zip, "10001");
  });

  it("ls_create_checkout passes custom data object", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({
      storeId: "1",
      variantId: "7",
      customData: { ref: "abc123" },
    });
    const body = lastRequest!.body as AnyBody;
    assert.deepEqual(body.data.attributes.checkout_data.custom, { ref: "abc123" });
  });

  it("ls_create_checkout with enabledVariants, discountCode, and expiresAt", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({
      storeId: "1",
      variantId: "7",
      enabledVariants: ["7", "8", "9"],
      discountCode: "SAVE10",
      expiresAt: "2026-12-31T23:59:59Z",
      taxNumber: "DE123456789",
    });
    const body = lastRequest!.body as AnyBody;
    assert.deepEqual(body.data.attributes.product_options, { enabled_variants: ["7", "8", "9"] });
    assert.equal(body.data.attributes.expires_at, "2026-12-31T23:59:59Z");
    assert.equal(body.data.attributes.checkout_data.discount_code, "SAVE10");
    assert.equal(body.data.attributes.checkout_data.tax_number, "DE123456789");
  });

  it("ls_create_checkout passes nested custom data object", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({
      storeId: "1",
      variantId: "7",
      customData: { campaign: "summer", tier: 2 },
    });
    const body = lastRequest!.body as AnyBody;
    assert.deepEqual(body.data.attributes.checkout_data.custom, { campaign: "summer", tier: 2 });
  });
});

// ─── Webhooks ───

describe("Webhook handlers", () => {
  it("ls_get_webhook calls GET /webhooks/:id", async () => {
    const tool = findTool(webhookTools, "ls_get_webhook");
    await tool.handler({ webhookId: "1200" });
    assert.ok(lastRequest!.url.startsWith(`${BASE}/webhooks/1200`));
  });

  it("ls_list_webhooks filters by store", async () => {
    const tool = findTool(webhookTools, "ls_list_webhooks");
    await tool.handler({ storeId: "1" });
    assert.ok(lastRequest!.url.includes("filter[store_id]=1"));
  });

  it("ls_create_webhook sends correct body", async () => {
    const tool = findTool(webhookTools, "ls_create_webhook");
    await tool.handler({
      storeId: "1",
      url: "https://example.com/hook",
      events: ["order_created", "subscription_created"],
      secret: "s3cret",
    });
    assert.equal(lastRequest!.method, "POST");
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "webhooks");
    assert.equal(body.data.attributes.url, "https://example.com/hook");
    assert.deepEqual(body.data.attributes.events, ["order_created", "subscription_created"]);
    assert.equal(body.data.attributes.secret, "s3cret");
    assert.equal(body.data.relationships.store.data.id, "1");
  });

  it("ls_update_webhook sends PATCH with partial attributes", async () => {
    const tool = findTool(webhookTools, "ls_update_webhook");
    await tool.handler({ webhookId: "1200", url: "https://new.example.com/hook" });
    assert.equal(lastRequest!.method, "PATCH");
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.type, "webhooks");
    assert.equal(body.data.id, "1200");
    assert.equal(body.data.attributes.url, "https://new.example.com/hook");
  });

  it("ls_update_webhook updates events and secret", async () => {
    const tool = findTool(webhookTools, "ls_update_webhook");
    await tool.handler({
      webhookId: "1200",
      events: ["order_created", "order_refunded", "subscription_cancelled"],
      secret: "new-secret",
    });
    const body = lastRequest!.body as AnyBody;
    assert.deepEqual(body.data.attributes.events, ["order_created", "order_refunded", "subscription_cancelled"]);
    assert.equal(body.data.attributes.secret, "new-secret");
    assert.equal(body.data.attributes.url, undefined);
  });

  it("ls_delete_webhook sends DELETE", async () => {
    mockFetch(204);
    const tool = findTool(webhookTools, "ls_delete_webhook");
    await tool.handler({ webhookId: "1200" });
    assert.equal(lastRequest!.method, "DELETE");
    assert.equal(lastRequest!.url, `${BASE}/webhooks/1200`);
  });

  it("ls_update_webhook rejects an update with no fields to change", async () => {
    const tool = findTool(webhookTools, "ls_update_webhook");
    await assert.rejects(() => tool.handler({ webhookId: "1200" }), /at least one of: url, events, secret/);
  });
});

// ─── Licenses (License API — uses licenseRequest, not apiGet/apiPost) ───

describe("License API handlers", () => {
  it("ls_activate_license sends form-encoded POST", async () => {
    const tool = findTool(licenseTools, "ls_activate_license");
    await tool.handler({ licenseKey: "ABC-123", instanceName: "my-machine" });
    assert.equal(lastRequest!.method, "POST");
    assert.equal(lastRequest!.url, `${BASE}/licenses/activate`);
    assert.equal(lastRequest!.headers["Content-Type"], "application/x-www-form-urlencoded");
    // Body is URLSearchParams encoded
    const bodyStr = lastRequest!.body as string;
    assert.ok(bodyStr.includes("license_key=ABC-123"));
    assert.ok(bodyStr.includes("instance_name=my-machine"));
  });

  it("ls_validate_license sends form-encoded POST", async () => {
    const tool = findTool(licenseTools, "ls_validate_license");
    await tool.handler({ licenseKey: "ABC-123" });
    assert.equal(lastRequest!.method, "POST");
    assert.equal(lastRequest!.url, `${BASE}/licenses/validate`);
    const bodyStr = lastRequest!.body as string;
    assert.ok(bodyStr.includes("license_key=ABC-123"));
  });

  it("ls_validate_license includes optional instance_id", async () => {
    const tool = findTool(licenseTools, "ls_validate_license");
    await tool.handler({ licenseKey: "ABC-123", instanceId: "inst-456" });
    const bodyStr = lastRequest!.body as string;
    assert.ok(bodyStr.includes("instance_id=inst-456"));
  });

  it("ls_deactivate_license sends form-encoded POST", async () => {
    const tool = findTool(licenseTools, "ls_deactivate_license");
    await tool.handler({ licenseKey: "ABC-123", instanceId: "inst-456" });
    assert.equal(lastRequest!.method, "POST");
    assert.equal(lastRequest!.url, `${BASE}/licenses/deactivate`);
    const bodyStr = lastRequest!.body as string;
    assert.ok(bodyStr.includes("license_key=ABC-123"));
    assert.ok(bodyStr.includes("instance_id=inst-456"));
  });
});

// ─── Error handling ───

describe("Error handling", () => {
  it("returns error response on non-2xx status", async () => {
    mockFetch(422, null);
    // Override to return error text
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      lastRequest = {
        url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        method: init?.method ?? "GET",
        headers: {},
        body: undefined,
      };
      return new Response('{"errors":[{"detail":"Not found"}]}', {
        status: 422,
        statusText: "Unprocessable Entity",
      });
    }) as typeof fetch;

    const tool = findTool(customerTools, "ls_get_customer");
    const result = (await tool.handler({ customerId: "999" })) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 422);
    assert.ok(result.error);
  });

  it("throws when API key is missing", async () => {
    const saved = process.env.LEMONSQUEEZY_API_KEY;
    delete process.env.LEMONSQUEEZY_API_KEY;
    _resetApiKeyCacheForTest();
    const tool = findTool(customerTools, "ls_get_customer");
    await assert.rejects(() => tool.handler({ customerId: "1" }), /LEMONSQUEEZY_API_KEY/);
    process.env.LEMONSQUEEZY_API_KEY = saved;
    _resetApiKeyCacheForTest();
  });

  it("throws when API key is empty", async () => {
    const saved = process.env.LEMONSQUEEZY_API_KEY;
    process.env.LEMONSQUEEZY_API_KEY = "   ";
    _resetApiKeyCacheForTest();
    const tool = findTool(customerTools, "ls_get_customer");
    await assert.rejects(() => tool.handler({ customerId: "1" }), /empty/);
    process.env.LEMONSQUEEZY_API_KEY = saved;
    _resetApiKeyCacheForTest();
  });

  it("parses JSON:API error detail from 4xx response", async () => {
    globalThis.fetch = (async () => {
      return new Response('{"errors":[{"detail":"Variant not found","status":"404"}]}', {
        status: 404,
      });
    }) as typeof fetch;

    const tool = findTool(productTools, "ls_get_product");
    const result = (await tool.handler({ productId: "999" })) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.error, "Variant not found");
  });

  it("falls back to raw text when error response is not JSON", async () => {
    globalThis.fetch = (async () => {
      return new Response("Service Unavailable", { status: 503 });
    }) as typeof fetch;

    const tool = findTool(storeTools, "ls_get_store");
    const result = (await tool.handler({ storeId: "1" })) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.error, "Service Unavailable");
  });

  it("returns timeout error when request exceeds timeout", async () => {
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      // Simulate AbortSignal.timeout by throwing TimeoutError
      const err = new DOMException("Signal timed out", "TimeoutError");
      throw err;
    }) as typeof fetch;

    const tool = findTool(storeTools, "ls_get_store");
    const result = (await tool.handler({ storeId: "1" })) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.ok(result.error.includes("timed out"));
  });

  it("rethrows non-timeout fetch errors", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const tool = findTool(storeTools, "ls_get_store");
    await assert.rejects(() => tool.handler({ storeId: "1" }), /fetch failed/);
  });

  it("handles 500 server error with JSON body", async () => {
    globalThis.fetch = (async () => {
      return new Response('{"errors":[{"detail":"Internal server error"}]}', { status: 500 });
    }) as typeof fetch;

    const tool = findTool(orderTools, "ls_list_orders");
    const result = (await tool.handler({})) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
    assert.equal(result.error, "Internal server error");
  });

  it("handles 204 No Content response", async () => {
    mockFetch(204);
    const tool = findTool(discountTools, "ls_delete_discount");
    const result = (await tool.handler({ discountId: "1" })) as AnyBody;
    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
    assert.equal(result.data, undefined);
  });

  it("handles 429 rate limit response", async () => {
    globalThis.fetch = (async () => {
      return new Response('{"errors":[{"detail":"Too many requests"}]}', { status: 429 });
    }) as typeof fetch;

    const tool = findTool(storeTools, "ls_list_stores");
    const result = (await tool.handler({})) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 429);
    assert.equal(result.error, "Too many requests");
  });
});

// ─── License API error handling ───

describe("License API error handling", () => {
  it("parses license API error field", async () => {
    globalThis.fetch = (async () => {
      return new Response('{"error":"Invalid license key"}', { status: 400 });
    }) as typeof fetch;

    const tool = findTool(licenseTools, "ls_validate_license");
    const result = (await tool.handler({ licenseKey: "BAD-KEY" })) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid license key");
  });

  it("parses license API errors array (normalized)", async () => {
    globalThis.fetch = (async () => {
      return new Response('{"errors":[{"detail":"License expired"}]}', { status: 422 });
    }) as typeof fetch;

    const tool = findTool(licenseTools, "ls_activate_license");
    const result = (await tool.handler({ licenseKey: "EXP", instanceName: "m1" })) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.error, "License expired");
  });

  it("handles license API timeout", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("Signal timed out", "TimeoutError");
    }) as typeof fetch;

    const tool = findTool(licenseTools, "ls_activate_license");
    const result = (await tool.handler({ licenseKey: "K", instanceName: "m" })) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.ok(result.error.includes("timed out"));
  });

  it("falls back to raw text for non-JSON license error", async () => {
    globalThis.fetch = (async () => {
      return new Response("Bad Gateway", { status: 502 });
    }) as typeof fetch;

    const tool = findTool(licenseTools, "ls_deactivate_license");
    const result = (await tool.handler({ licenseKey: "K", instanceId: "i" })) as AnyBody;
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.equal(result.error, "Bad Gateway");
  });
});

// ─── API client: buildQuery ───

const { buildQuery } = await import("../api.js");

describe("buildQuery", () => {
  it("returns empty string for no params", () => {
    assert.equal(buildQuery(), "");
    assert.equal(buildQuery({}), "");
  });

  it("builds include param", () => {
    assert.equal(buildQuery({ include: ["store", "orders"] }), "?include=store%2Corders");
  });

  it("builds filter params", () => {
    const q = buildQuery({ filter: { store_id: "1", email: "a@b.com" } });
    assert.ok(q.includes("filter[store_id]=1"));
    assert.ok(q.includes("filter[email]=a%40b.com"));
  });

  it("builds page params", () => {
    const q = buildQuery({ page: { number: 2, size: 25 } });
    assert.ok(q.includes("page[number]=2"));
    assert.ok(q.includes("page[size]=25"));
  });

  it("combines all params", () => {
    const q = buildQuery({
      include: ["store"],
      filter: { status: "active" },
      page: { number: 1, size: 10 },
    });
    assert.ok(q.startsWith("?"));
    assert.ok(q.includes("include=store"));
    assert.ok(q.includes("filter[status]=active"));
    assert.ok(q.includes("page[number]=1"));
    assert.ok(q.includes("page[size]=10"));
  });

  it("returns empty string for empty arrays and objects", () => {
    assert.equal(buildQuery({ include: [] }), "");
    assert.equal(buildQuery({ filter: {} }), "");
    assert.equal(buildQuery({ include: [], filter: {}, page: {} }), "");
  });

  it("skips undefined page fields", () => {
    const q = buildQuery({ page: { number: 3 } });
    assert.ok(q.includes("page[number]=3"));
    assert.ok(!q.includes("page[size]"));
  });

  it("trims whitespace from include values", () => {
    const q = buildQuery({ include: [" store ", " orders "] });
    assert.equal(q, "?include=store%2Corders");
  });

  it("encodes special characters in filter keys and values", () => {
    const q = buildQuery({ filter: { "field name": "value&more=yes" } });
    assert.ok(q.includes("filter[field%20name]=value%26more%3Dyes"));
  });

  it("handles single include value", () => {
    assert.equal(buildQuery({ include: ["store"] }), "?include=store");
  });
});

// ─── Affiliates ───

describe("Affiliate handlers", () => {
  it("ls_get_affiliate calls GET /affiliates/:id", async () => {
    const tool = findTool(affiliateTools, "ls_get_affiliate");
    await tool.handler({ affiliateId: "7" });
    assert.equal(lastRequest!.method, "GET");
    assert.ok(lastRequest!.url.startsWith(`${BASE}/affiliates/7`));
  });

  it("ls_get_affiliate passes include", async () => {
    const tool = findTool(affiliateTools, "ls_get_affiliate");
    await tool.handler({ affiliateId: "7", include: "store,user" });
    assert.ok(lastRequest!.url.includes("include=store%2Cuser"));
  });

  it("ls_list_affiliates calls GET /affiliates", async () => {
    const tool = findTool(affiliateTools, "ls_list_affiliates");
    await tool.handler({});
    assert.equal(lastRequest!.method, "GET");
    assert.ok(lastRequest!.url.startsWith(`${BASE}/affiliates`));
  });

  it("ls_list_affiliates maps userEmail to filter[user_email]", async () => {
    const tool = findTool(affiliateTools, "ls_list_affiliates");
    await tool.handler({ userEmail: "aff@example.com" });
    assert.ok(lastRequest!.url.includes("filter[user_email]=aff%40example.com"));
  });

  it("ls_list_affiliates passes pagination", async () => {
    const tool = findTool(affiliateTools, "ls_list_affiliates");
    await tool.handler({ pageNumber: 2, pageSize: 25 });
    assert.ok(lastRequest!.url.includes("page[number]=2"));
    assert.ok(lastRequest!.url.includes("page[size]=25"));
  });
});

// ─── Path encoding (no segment escapes) ───

describe("Path segment encoding", () => {
  it("getHandler URL-encodes the ID parameter", async () => {
    const tool = findTool(discountTools, "ls_get_discount");
    await tool.handler({ discountId: "1/refund" });
    assert.equal(lastRequest!.method, "GET");
    assert.ok(
      lastRequest!.url.startsWith(`${BASE}/discounts/1%2Frefund`),
      `expected encoded id, got ${lastRequest!.url}`,
    );
  });

  it("ls_update_customer URL-encodes the customer ID in the path", async () => {
    const tool = findTool(customerTools, "ls_update_customer");
    await tool.handler({ customerId: "99/extra", name: "X" });
    assert.equal(lastRequest!.method, "PATCH");
    assert.equal(lastRequest!.url, `${BASE}/customers/99%2Fextra`);
  });

  it("ls_refund_order URL-encodes the order ID in the path", async () => {
    const tool = findTool(orderTools, "ls_refund_order");
    await tool.handler({ orderId: "100/bad", amount: 100 });
    assert.equal(lastRequest!.url, `${BASE}/orders/100%2Fbad/refund`);
  });

  it("ls_cancel_subscription URL-encodes the subscription ID", async () => {
    mockFetch(204);
    const tool = findTool(subscriptionTools, "ls_cancel_subscription");
    await tool.handler({ subscriptionId: "300/oops" });
    assert.equal(lastRequest!.method, "DELETE");
    assert.equal(lastRequest!.url, `${BASE}/subscriptions/300%2Foops`);
  });

  it("ls_get_subscription_item_usage URL-encodes the subscription item ID", async () => {
    const tool = findTool(subscriptionItemTools, "ls_get_subscription_item_usage");
    await tool.handler({ subscriptionItemId: "500/leak" });
    assert.equal(lastRequest!.url, `${BASE}/subscription-items/500%2Fleak/current-usage`);
  });

  it("ls_delete_webhook URL-encodes the webhook ID", async () => {
    mockFetch(204);
    const tool = findTool(webhookTools, "ls_delete_webhook");
    await tool.handler({ webhookId: "12/00" });
    assert.equal(lastRequest!.method, "DELETE");
    assert.equal(lastRequest!.url, `${BASE}/webhooks/12%2F00`);
  });

  it("ls_update_webhook URL-encodes the webhook ID in the path", async () => {
    const tool = findTool(webhookTools, "ls_update_webhook");
    await tool.handler({ webhookId: "12/00", url: "https://example.com/hook" });
    assert.equal(lastRequest!.method, "PATCH");
    assert.equal(lastRequest!.url, `${BASE}/webhooks/12%2F00`);
  });
});

// ─── Schema validation ───

describe("Schema validation", () => {
  it("ls_update_subscription rejects non-numeric variantId at the schema level", () => {
    const tool = findTool(subscriptionTools, "ls_update_subscription");
    const result = inputSchema(tool).safeParse({ subscriptionId: "300", variantId: "not-a-number" });
    assert.equal(result.success, false);
  });

  it("ls_update_subscription accepts a numeric-string variantId", () => {
    const tool = findTool(subscriptionTools, "ls_update_subscription");
    const result = inputSchema(tool).safeParse({ subscriptionId: "300", variantId: "12345" });
    assert.equal(result.success, true);
  });

  it("ls_update_subscription rejects '0' as variantId", () => {
    const tool = findTool(subscriptionTools, "ls_update_subscription");
    const result = inputSchema(tool).safeParse({ subscriptionId: "300", variantId: "0" });
    assert.equal(result.success, false);
  });

  // The shared lsIdSchema rejects anything that isn't a positive-integer
  // string. Spot-check across a representative cross-section of tools so a
  // future regression on one of them (an isolated z.string() slipped past
  // review) is caught without a per-tool test for every ID field.
  it("ls_get_customer rejects a non-numeric customerId", () => {
    const tool = findTool(customerTools, "ls_get_customer");
    const result = inputSchema(tool).safeParse({ customerId: "abc" });
    assert.equal(result.success, false);
  });

  it("ls_get_customer rejects '0' as customerId", () => {
    const tool = findTool(customerTools, "ls_get_customer");
    const result = inputSchema(tool).safeParse({ customerId: "0" });
    assert.equal(result.success, false);
  });

  it("ls_get_customer accepts a numeric-string customerId", () => {
    const tool = findTool(customerTools, "ls_get_customer");
    const result = inputSchema(tool).safeParse({ customerId: "12345" });
    assert.equal(result.success, true);
  });

  it("ls_create_checkout rejects a non-numeric variantId in body", () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    const result = inputSchema(tool).safeParse({ storeId: "1", variantId: "not-a-number" });
    assert.equal(result.success, false);
  });

  it("ls_create_discount rejects non-numeric entries inside variantIds[]", () => {
    const tool = findTool(discountTools, "ls_create_discount");
    const result = inputSchema(tool).safeParse({
      storeId: "1",
      name: "X",
      code: "X",
      amount: 10,
      amountType: "percent",
      variantIds: ["1", "abc", "2"],
    });
    assert.equal(result.success, false);
  });

  it("ls_list_orders rejects a non-numeric storeId filter", () => {
    const tool = findTool(orderTools, "ls_list_orders");
    const result = inputSchema(tool).safeParse({ storeId: "abc" });
    assert.equal(result.success, false);
  });

  it("ls_update_customer rejects 'archive' (typo) at the schema level", () => {
    const tool = findTool(customerTools, "ls_update_customer");
    const result = inputSchema(tool).safeParse({ customerId: "99", status: "archive" });
    assert.equal(result.success, false);
  });

  it("ls_update_customer rejects 'Archived' (case mismatch) at the schema level", () => {
    const tool = findTool(customerTools, "ls_update_customer");
    const result = inputSchema(tool).safeParse({ customerId: "99", status: "Archived" });
    assert.equal(result.success, false);
  });

  it("ls_update_customer rejects an unrelated status value", () => {
    const tool = findTool(customerTools, "ls_update_customer");
    const result = inputSchema(tool).safeParse({ customerId: "99", status: "deleted" });
    assert.equal(result.success, false);
  });

  it("ls_update_customer accepts the literal 'archived' status", () => {
    const tool = findTool(customerTools, "ls_update_customer");
    const result = inputSchema(tool).safeParse({ customerId: "99", status: "archived" });
    assert.equal(result.success, true);
  });

  it("ls_update_customer accepts an update with status omitted", () => {
    const tool = findTool(customerTools, "ls_update_customer");
    const result = inputSchema(tool).safeParse({ customerId: "99", name: "New Name" });
    assert.equal(result.success, true);
  });

  // Locks in the fix from f7374bd: an empty events array used to pass local
  // validation and only got rejected upstream as a 422. The schema-level
  // .min(1) turns it into a clearer local validation error.
  it("ls_create_webhook rejects an empty events array", () => {
    const tool = findTool(webhookTools, "ls_create_webhook");
    const result = inputSchema(tool).safeParse({
      storeId: "1",
      url: "https://example.com/hook",
      events: [],
      secret: "abcdef",
    });
    assert.equal(result.success, false);
  });

  it("ls_update_webhook rejects an empty events array", () => {
    const tool = findTool(webhookTools, "ls_update_webhook");
    const result = inputSchema(tool).safeParse({ webhookId: "1200", events: [] });
    assert.equal(result.success, false);
  });

  it("ls_create_webhook rejects a non-URL string in url", () => {
    const tool = findTool(webhookTools, "ls_create_webhook");
    const result = inputSchema(tool).safeParse({
      storeId: "1",
      url: "not-a-url",
      events: ["order_created"],
      secret: "abcdef",
    });
    assert.equal(result.success, false);
  });

  it("ls_update_webhook rejects a non-URL string in url", () => {
    const tool = findTool(webhookTools, "ls_update_webhook");
    const result = inputSchema(tool).safeParse({ webhookId: "1200", url: "not-a-url" });
    assert.equal(result.success, false);
  });

  // z.string().url() accepts every URL-parseable scheme. LemonSqueezy
  // only delivers webhooks over http/https; reject the rest at the
  // schema level so they don't land as silently-dead webhooks.
  for (const badScheme of ["mailto:foo@bar.com", "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/x"]) {
    it(`ls_create_webhook rejects ${badScheme.split(":")[0]}: URL scheme`, () => {
      const tool = findTool(webhookTools, "ls_create_webhook");
      const result = inputSchema(tool).safeParse({
        storeId: "1",
        url: badScheme,
        events: ["order_created"],
        secret: "abcdef",
      });
      assert.equal(result.success, false);
    });

    it(`ls_update_webhook rejects ${badScheme.split(":")[0]}: URL scheme`, () => {
      const tool = findTool(webhookTools, "ls_update_webhook");
      const result = inputSchema(tool).safeParse({ webhookId: "1200", url: badScheme });
      assert.equal(result.success, false);
    });
  }

  it("ls_create_webhook accepts an http URL", () => {
    const tool = findTool(webhookTools, "ls_create_webhook");
    const result = inputSchema(tool).safeParse({
      storeId: "1",
      url: "http://example.com/hook",
      events: ["order_created"],
      secret: "abcdef",
    });
    assert.equal(result.success, true);
  });

  it("ls_create_webhook accepts an https URL", () => {
    const tool = findTool(webhookTools, "ls_create_webhook");
    const result = inputSchema(tool).safeParse({
      storeId: "1",
      url: "https://example.com/hook",
      events: ["order_created"],
      secret: "abcdef",
    });
    assert.equal(result.success, true);
  });
});

// ─── Auth-failure cache invalidation ───

// A real key rotation upstream surfaces as a 401 (or 403) on the first
// request after rotation. The api client busts the in-process secret cache
// so the *next* request re-fetches a fresh key from env or the configured
// command, instead of waiting on the 1h TTL. The failing call itself is
// not retried -- a misconfigured key still surfaces loudly to the caller.
describe("Auth-failure secret cache invalidation", () => {
  const SAVED_KEY = process.env.LEMONSQUEEZY_API_KEY;
  const SAVED_CMD = process.env.LEMONSQUEEZY_API_KEY_COMMAND;

  function setupCounterCommand(): { counterFile: string } {
    const counterDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-mcp-secret-"));
    const counterFile = path.join(counterDir, "count");
    fs.writeFileSync(counterFile, "0");
    const escapedCounter = counterFile.replace(/\\/g, "\\\\");
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-mcp-secret-"));
    const scriptPath = path.join(scriptDir, "key.js");
    fs.writeFileSync(
      scriptPath,
      `const fs=require('fs');const p='${escapedCounter}';const n=parseInt(fs.readFileSync(p,'utf8'))+1;fs.writeFileSync(p,String(n));console.log('key_'+n);`,
    );
    delete process.env.LEMONSQUEEZY_API_KEY;
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    _resetApiKeyCacheForTest();
    return { counterFile };
  }

  function teardown() {
    if (SAVED_KEY === undefined) delete process.env.LEMONSQUEEZY_API_KEY;
    else process.env.LEMONSQUEEZY_API_KEY = SAVED_KEY;
    if (SAVED_CMD === undefined) delete process.env.LEMONSQUEEZY_API_KEY_COMMAND;
    else process.env.LEMONSQUEEZY_API_KEY_COMMAND = SAVED_CMD;
    _resetApiKeyCacheForTest();
  }

  it("a 401 from the API invalidates the cached API key", async () => {
    const { counterFile } = setupCounterCommand();
    try {
      const tool = findTool(storeTools, "ls_get_store");

      // Call 1: succeeds, command runs once, value cached.
      mockFetch(200, { data: { id: "1" } });
      await tool.handler({ storeId: "1" });
      assert.equal(fs.readFileSync(counterFile, "utf8"), "1");

      // Call 2: cache hit on key load, then 401 from API -> cache busted.
      // Counter is still 1 because loadApiKey came from the cache.
      globalThis.fetch = (async () =>
        new Response('{"errors":[{"detail":"Unauthorized"}]}', { status: 401 })) as typeof fetch;
      const r2 = (await tool.handler({ storeId: "1" })) as { ok: boolean; status: number };
      assert.equal(r2.ok, false);
      assert.equal(r2.status, 401);
      assert.equal(fs.readFileSync(counterFile, "utf8"), "1");

      // Call 3: cache was cleared by call 2, so the command runs again.
      mockFetch(200, { data: { id: "1" } });
      await tool.handler({ storeId: "1" });
      assert.equal(fs.readFileSync(counterFile, "utf8"), "2");
    } finally {
      teardown();
    }
  });

  it("a 403 from the API invalidates the cached API key", async () => {
    const { counterFile } = setupCounterCommand();
    try {
      const tool = findTool(storeTools, "ls_get_store");

      mockFetch(200, { data: { id: "1" } });
      await tool.handler({ storeId: "1" });
      assert.equal(fs.readFileSync(counterFile, "utf8"), "1");

      globalThis.fetch = (async () =>
        new Response('{"errors":[{"detail":"Forbidden"}]}', { status: 403 })) as typeof fetch;
      const r2 = (await tool.handler({ storeId: "1" })) as { ok: boolean; status: number };
      assert.equal(r2.ok, false);
      assert.equal(r2.status, 403);

      mockFetch(200, { data: { id: "1" } });
      await tool.handler({ storeId: "1" });
      assert.equal(fs.readFileSync(counterFile, "utf8"), "2");
    } finally {
      teardown();
    }
  });

  it("a 404 does NOT invalidate the cache (not an auth failure)", async () => {
    const { counterFile } = setupCounterCommand();
    try {
      const tool = findTool(storeTools, "ls_get_store");

      mockFetch(200, { data: { id: "1" } });
      await tool.handler({ storeId: "1" });
      assert.equal(fs.readFileSync(counterFile, "utf8"), "1");

      globalThis.fetch = (async () =>
        new Response('{"errors":[{"detail":"Not Found"}]}', { status: 404 })) as typeof fetch;
      const r2 = (await tool.handler({ storeId: "999" })) as { ok: boolean; status: number };
      assert.equal(r2.ok, false);
      assert.equal(r2.status, 404);

      // Cache survives a 404 -- the next call still reuses the cached key.
      mockFetch(200, { data: { id: "1" } });
      await tool.handler({ storeId: "1" });
      assert.equal(fs.readFileSync(counterFile, "utf8"), "1");
    } finally {
      teardown();
    }
  });
});

// ─── Checkout billing-address shape ───

describe("Checkout billing address composition", () => {
  it("includes only country when only billingAddressCountry is set", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({ storeId: "1", variantId: "7", billingAddressCountry: "US" });
    const body = lastRequest!.body as AnyBody;
    assert.deepEqual(body.data.attributes.checkout_data.billing_address, { country: "US" });
  });

  it("includes only zip when only billingAddressZip is set", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({ storeId: "1", variantId: "7", billingAddressZip: "10001" });
    const body = lastRequest!.body as AnyBody;
    assert.deepEqual(body.data.attributes.checkout_data.billing_address, { zip: "10001" });
  });

  it("includes both fields when both are set, regardless of declaration order", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({
      storeId: "1",
      variantId: "7",
      billingAddressZip: "10001",
      billingAddressCountry: "US",
    });
    const body = lastRequest!.body as AnyBody;
    assert.deepEqual(body.data.attributes.checkout_data.billing_address, {
      country: "US",
      zip: "10001",
    });
  });

  it("omits billing_address entirely when neither field is set", async () => {
    const tool = findTool(checkoutTools, "ls_create_checkout");
    await tool.handler({ storeId: "1", variantId: "7" });
    const body = lastRequest!.body as AnyBody;
    assert.equal(body.data.attributes.checkout_data, undefined);
  });
});

// ─── 429 retry behavior ───

interface QueuedResponse {
  status: number;
  retryAfter?: string;
  body?: unknown;
}

function mockFetchQueue(responses: QueuedResponse[]) {
  let callCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    lastRequest = { url, method, headers, body: undefined };
    const idx = Math.min(callCount, responses.length - 1);
    callCount++;
    const r = responses[idx];
    const responseHeaders: Record<string, string> = { "Content-Type": "application/vnd.api+json" };
    if (r.retryAfter !== undefined) responseHeaders["retry-after"] = r.retryAfter;
    return new Response(JSON.stringify(r.body ?? { data: { id: "1" } }), {
      status: r.status,
      headers: responseHeaders,
    });
  }) as typeof fetch;
  return () => callCount;
}

describe("429 retry behavior", () => {
  it("retries once on 429 with Retry-After: 0 and returns success", async () => {
    const getCalls = mockFetchQueue([
      { status: 429, retryAfter: "0", body: { errors: [{ detail: "Too Many Requests" }] } },
      { status: 200, body: { data: { id: "42" } } },
    ]);
    const tool = findTool(storeTools, "ls_get_store");
    await tool.handler({ storeId: "42" });
    assert.equal(getCalls(), 2);
  });

  it("does not retry if Retry-After exceeds 30s cap", async () => {
    const getCalls = mockFetchQueue([
      { status: 429, retryAfter: "31", body: { errors: [{ detail: "rate limited" }] } },
    ]);
    const tool = findTool(storeTools, "ls_get_store");
    await tool.handler({ storeId: "42" });
    assert.equal(getCalls(), 1);
  });

  it("surfaces 429 when all retry attempts also hit 429", async () => {
    const getCalls = mockFetchQueue([
      { status: 429, retryAfter: "0", body: { errors: [{ detail: "first" }] } },
      { status: 429, retryAfter: "0", body: { errors: [{ detail: "second" }] } },
      { status: 429, retryAfter: "0", body: { errors: [{ detail: "third" }] } },
      { status: 429, retryAfter: "0", body: { errors: [{ detail: "fourth" }] } },
    ]);
    const tool = findTool(storeTools, "ls_get_store");
    const result = await tool.handler({ storeId: "42" });
    assert.equal(getCalls(), 4);
    assert.equal((result as { status: number }).status, 429);
  });

  it("retries 5xx on idempotent GET up to max attempts", async () => {
    const getCalls = mockFetchQueue([{ status: 500, body: { errors: [{ detail: "server error" }] } }]);
    const tool = findTool(storeTools, "ls_get_store");
    const result = await tool.handler({ storeId: "42" });
    assert.equal(getCalls(), 4);
    assert.equal((result as { status: number }).status, 500);
  });

  it("returns 2xx immediately on 5xx recovery", async () => {
    const getCalls = mockFetchQueue([
      { status: 500, body: { errors: [{ detail: "server error" }] } },
      { status: 200, body: { data: { id: "42" } } },
    ]);
    const tool = findTool(storeTools, "ls_get_store");
    const result = await tool.handler({ storeId: "42" });
    assert.equal(getCalls(), 2);
    assert.equal((result as { status: number }).status, 200);
  });

  it("does not retry 5xx on non-idempotent POST", async () => {
    const getCalls = mockFetchQueue([{ status: 500, body: { errors: [{ detail: "server error" }] } }]);
    const tool = findTool(customerTools, "ls_create_customer");
    const result = await tool.handler({ storeId: "1", name: "A", email: "a@b.c" });
    assert.equal(getCalls(), 1);
    assert.equal((result as { status: number }).status, 500);
  });
});

// ─── Refund-cap guardrail enforcement (handler boundary) ───
//
// The isolated unit in guardrails.test.ts proves checkRefundAmount() throws
// past the cap. These tests prove the wiring: the refund tool HANDLERS call
// checkRefundAmount BEFORE the refund POST (orders.ts:119,
// subscription-invoices.ts:125), so an over-cap refund is blocked end-to-end
// and never reaches LemonSqueezy. A counting fetch mock makes "the POST never
// went out" an explicit assertion rather than an inference from lastRequest.
describe("Refund-cap guardrail enforcement at the handler", () => {
  const SAVED_CAP = process.env.LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS;

  function setCap(value: string | undefined) {
    if (value === undefined) delete process.env.LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS;
    else process.env.LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS = value;
    // The guardrail options object is cached on first read; force a re-read so
    // the new cap takes effect (mirrors how the server picks up config once).
    _resetGuardrailsForTest();
  }

  // Wrap globalThis.fetch with a call counter so we can assert the refund POST
  // was (or was not) actually dispatched. Returns a getter for the count.
  function countingFetch(status = 200, responseData: unknown = { data: { id: "1" } }) {
    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      let body: unknown;
      if (init?.body) {
        const raw = init.body.toString();
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      lastRequest = { url, method, headers: {}, body };
      return new Response(JSON.stringify(responseData), {
        status,
        headers: { "Content-Type": "application/vnd.api+json" },
      });
    }) as typeof fetch;
    return () => calls;
  }

  afterEach(() => {
    setCap(SAVED_CAP);
  });

  describe("ls_refund_order", () => {
    it("refuses an over-cap refund and never sends the POST", async () => {
      setCap("10000");
      const getCalls = countingFetch();
      const tool = findTool(orderTools, "ls_refund_order");
      await assert.rejects(
        () => tool.handler({ orderId: "100", amount: 10001 }),
        (err: unknown) => {
          assert.ok(err instanceof GuardrailError, "expected a GuardrailError");
          assert.match((err as Error).message, /exceeds LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS/);
          return true;
        },
      );
      // Guard fires before apiPost -> no HTTP call left the process.
      assert.equal(getCalls(), 0, "over-cap refund must not reach the refund endpoint");
      assert.equal(lastRequest, undefined);
    });

    it("allows a refund at exactly the cap (POST goes through)", async () => {
      setCap("10000");
      const getCalls = countingFetch();
      const tool = findTool(orderTools, "ls_refund_order");
      const result = (await tool.handler({ orderId: "100", amount: 10000 })) as AnyBody;
      assert.equal(getCalls(), 1);
      assert.equal(lastRequest!.method, "POST");
      assert.ok(lastRequest!.url.includes("/orders/100/refund"));
      assert.equal((lastRequest!.body as AnyBody).data.attributes.amount, 10000);
      assert.equal(result.ok, true);
    });

    it("allows a refund under the cap (POST goes through)", async () => {
      setCap("10000");
      const getCalls = countingFetch();
      const tool = findTool(orderTools, "ls_refund_order");
      await tool.handler({ orderId: "100", amount: 500 });
      assert.equal(getCalls(), 1);
      assert.equal((lastRequest!.body as AnyBody).data.attributes.amount, 500);
    });

    it("imposes no limit when the cap env var is unset", async () => {
      setCap(undefined);
      const getCalls = countingFetch();
      const tool = findTool(orderTools, "ls_refund_order");
      await tool.handler({ orderId: "100", amount: 999_999_999 });
      assert.equal(getCalls(), 1);
      assert.equal((lastRequest!.body as AnyBody).data.attributes.amount, 999_999_999);
    });
  });

  describe("ls_refund_subscription_invoice", () => {
    it("refuses an over-cap refund and never sends the POST", async () => {
      setCap("10000");
      const getCalls = countingFetch();
      const tool = findTool(subscriptionInvoiceTools, "ls_refund_subscription_invoice");
      await assert.rejects(
        () => tool.handler({ subscriptionInvoiceId: "400", amount: 10001 }),
        (err: unknown) => {
          assert.ok(err instanceof GuardrailError, "expected a GuardrailError");
          assert.match((err as Error).message, /exceeds LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS/);
          return true;
        },
      );
      assert.equal(getCalls(), 0, "over-cap refund must not reach the refund endpoint");
      assert.equal(lastRequest, undefined);
    });

    it("allows a refund at exactly the cap (POST goes through)", async () => {
      setCap("10000");
      const getCalls = countingFetch();
      const tool = findTool(subscriptionInvoiceTools, "ls_refund_subscription_invoice");
      const result = (await tool.handler({ subscriptionInvoiceId: "400", amount: 10000 })) as AnyBody;
      assert.equal(getCalls(), 1);
      assert.equal(lastRequest!.method, "POST");
      assert.ok(lastRequest!.url.includes("/subscription-invoices/400/refund"));
      assert.equal((lastRequest!.body as AnyBody).data.type, "subscription-invoices");
      assert.equal((lastRequest!.body as AnyBody).data.attributes.amount, 10000);
      assert.equal(result.ok, true);
    });

    it("allows a refund under the cap (POST goes through)", async () => {
      setCap("10000");
      const getCalls = countingFetch();
      const tool = findTool(subscriptionInvoiceTools, "ls_refund_subscription_invoice");
      await tool.handler({ subscriptionInvoiceId: "400", amount: 1000 });
      assert.equal(getCalls(), 1);
      assert.equal((lastRequest!.body as AnyBody).data.attributes.amount, 1000);
    });

    it("imposes no limit when the cap env var is unset", async () => {
      setCap(undefined);
      const getCalls = countingFetch();
      const tool = findTool(subscriptionInvoiceTools, "ls_refund_subscription_invoice");
      await tool.handler({ subscriptionInvoiceId: "400", amount: 999_999_999 });
      assert.equal(getCalls(), 1);
      assert.equal((lastRequest!.body as AnyBody).data.attributes.amount, 999_999_999);
    });
  });
});

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
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
    let body: unknown = undefined;
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

const BASE = "https://api.lemonsqueezy.com/v1";

// ─── Setup / teardown ───

before(() => {
  process.env.LEMONSQUEEZY_API_KEY = "test-key-123";
});

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.LEMONSQUEEZY_API_KEY;
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
    const tool = findTool(customerTools, "ls_get_customer");
    await assert.rejects(() => tool.handler({ customerId: "1" }), /LEMONSQUEEZY_API_KEY/);
    process.env.LEMONSQUEEZY_API_KEY = saved;
  });

  it("throws when API key is empty", async () => {
    const saved = process.env.LEMONSQUEEZY_API_KEY;
    process.env.LEMONSQUEEZY_API_KEY = "   ";
    const tool = findTool(customerTools, "ls_get_customer");
    await assert.rejects(() => tool.handler({ customerId: "1" }), /empty/);
    process.env.LEMONSQUEEZY_API_KEY = saved;
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
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
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

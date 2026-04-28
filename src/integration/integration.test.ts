/**
 * Integration tests against a real LemonSqueezy store.
 *
 * Runs only when LEMONSQUEEZY_TEST_API_KEY and LEMONSQUEEZY_TEST_STORE_ID are set
 * (typically in the nightly CI workflow). Skipped silently otherwise so local
 * `npm test` doesn't require credentials.
 *
 * Read paths are pure GET/list and touch nothing. The write-path round-trip
 * creates a throwaway discount, reads it back, and deletes it. Every resource
 * it creates is prefixed "ci-test-" so a failed run's leaked artifact is
 * obvious and the sweep step at the start of the next run can reap it.
 *
 * Goal: catch upstream schema drift on both read and write paths before users do.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { customerTools } from "../tools/customers.js";
import { discountTools } from "../tools/discounts.js";
import { orderTools } from "../tools/orders.js";
import { productTools } from "../tools/products.js";
import { storeTools } from "../tools/stores.js";
import { subscriptionTools } from "../tools/subscriptions.js";
import { userTools } from "../tools/users.js";
import { variantTools } from "../tools/variants.js";
import { webhookTools } from "../tools/webhooks.js";

type HandlerResult = { ok: boolean; data?: unknown; error?: string; status: number };

const testApiKey = process.env.LEMONSQUEEZY_TEST_API_KEY;
const testStoreId = process.env.LEMONSQUEEZY_TEST_STORE_ID;
const enabled = Boolean(testApiKey && testStoreId);

const CI_PREFIX = "ci-test-";
const SWEEP_STALE_AFTER_MS = 60 * 60 * 1000; // 1h

const prevApiKey = process.env.LEMONSQUEEZY_API_KEY;

before(() => {
  if (enabled) process.env.LEMONSQUEEZY_API_KEY = testApiKey;
});

after(() => {
  if (!enabled) return;
  if (prevApiKey === undefined) delete process.env.LEMONSQUEEZY_API_KEY;
  else process.env.LEMONSQUEEZY_API_KEY = prevApiKey;
});

function findTool<T extends readonly { name: string }[]>(tools: T, name: string): T[number] {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

async function run(tool: { handler: unknown }, input: Record<string, unknown>): Promise<HandlerResult> {
  const handler = tool.handler as (input: Record<string, unknown>) => Promise<HandlerResult>;
  return handler(input);
}

interface DiscountRow {
  id: string;
  attributes?: { name?: string; created_at?: string };
}

async function listStaleCiDiscounts(storeId: string): Promise<DiscountRow[]> {
  const result = await run(findTool(discountTools, "ls_list_discounts"), { storeId, pageSize: 100 });
  if (!result.ok) return [];
  const rows = ((result.data as { data?: DiscountRow[] }).data ?? []) as DiscountRow[];
  const cutoff = Date.now() - SWEEP_STALE_AFTER_MS;
  return rows.filter((r) => {
    const name = r.attributes?.name ?? "";
    if (!name.startsWith(CI_PREFIX)) return false;
    const createdAt = r.attributes?.created_at;
    if (!createdAt) return true;
    return Date.parse(createdAt) < cutoff;
  });
}

async function deleteDiscount(id: string): Promise<void> {
  await run(findTool(discountTools, "ls_delete_discount"), { discountId: id });
}

interface WebhookRow {
  id: string;
  attributes?: { url?: string; created_at?: string };
}

async function listStaleCiWebhooks(storeId: string): Promise<WebhookRow[]> {
  const result = await run(findTool(webhookTools, "ls_list_webhooks"), { storeId, pageSize: 100 });
  if (!result.ok) return [];
  const rows = ((result.data as { data?: WebhookRow[] }).data ?? []) as WebhookRow[];
  const cutoff = Date.now() - SWEEP_STALE_AFTER_MS;
  return rows.filter((r) => {
    const url = r.attributes?.url ?? "";
    if (!url.includes(CI_PREFIX)) return false;
    const createdAt = r.attributes?.created_at;
    if (!createdAt) return true;
    return Date.parse(createdAt) < cutoff;
  });
}

async function deleteWebhook(id: string): Promise<void> {
  await run(findTool(webhookTools, "ls_delete_webhook"), { webhookId: id });
}

interface CustomerRow {
  id: string;
  attributes?: { email?: string; status?: string; created_at?: string };
}

/**
 * LemonSqueezy customers cannot be deleted — only archived. So the sweep
 * archives stale ci-test customers that are still active, rather than
 * deleting them. Already-archived stale customers accumulate in the store
 * but are harmless (not in active lists, no billing, no quota).
 */
async function listStaleCiActiveCustomers(storeId: string): Promise<CustomerRow[]> {
  const result = await run(findTool(customerTools, "ls_list_customers"), { storeId, pageSize: 100 });
  if (!result.ok) return [];
  const rows = ((result.data as { data?: CustomerRow[] }).data ?? []) as CustomerRow[];
  const cutoff = Date.now() - SWEEP_STALE_AFTER_MS;
  return rows.filter((r) => {
    const email = r.attributes?.email ?? "";
    if (!email.startsWith(CI_PREFIX)) return false;
    if (r.attributes?.status === "archived") return false;
    const createdAt = r.attributes?.created_at;
    if (!createdAt) return true;
    return Date.parse(createdAt) < cutoff;
  });
}

async function archiveCustomer(id: string): Promise<void> {
  await run(findTool(customerTools, "ls_archive_customer"), { customerId: id });
}

describe("integration (real LemonSqueezy API)", { skip: !enabled }, () => {
  it("gets the authenticated user", async () => {
    const result = await run(findTool(userTools, "ls_get_user"), {});
    assert.equal(result.ok, true, `expected ok, got: ${result.error}`);
    const data = (result.data as { data?: { type?: string } }).data;
    assert.equal(data?.type, "users");
  });

  it("gets the test store", async () => {
    const result = await run(findTool(storeTools, "ls_get_store"), { storeId: testStoreId });
    assert.equal(result.ok, true, `expected ok, got: ${result.error}`);
    const data = (result.data as { data?: { type?: string } }).data;
    assert.equal(data?.type, "stores");
  });

  it("lists products scoped to the test store", async () => {
    const result = await run(findTool(productTools, "ls_list_products"), { storeId: testStoreId, pageSize: 5 });
    assert.equal(result.ok, true, `expected ok, got: ${result.error}`);
    assert.ok(Array.isArray((result.data as { data?: unknown[] }).data));
  });

  it("lists variants the test API key can read", async () => {
    const result = await run(findTool(variantTools, "ls_list_variants"), { pageSize: 5 });
    assert.equal(result.ok, true, `expected ok, got: ${result.error}`);
  });

  it("lists orders scoped to the test store", async () => {
    const result = await run(findTool(orderTools, "ls_list_orders"), { storeId: testStoreId, pageSize: 5 });
    assert.equal(result.ok, true, `expected ok, got: ${result.error}`);
  });

  it("lists subscriptions scoped to the test store", async () => {
    const result = await run(findTool(subscriptionTools, "ls_list_subscriptions"), {
      storeId: testStoreId,
      pageSize: 5,
    });
    assert.equal(result.ok, true, `expected ok, got: ${result.error}`);
  });

  it("surfaces a clean error on 404", async () => {
    const result = await run(findTool(storeTools, "ls_get_store"), { storeId: "999999999" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.ok(result.error && result.error.length > 0);
  });
});

describe("integration write path (real LemonSqueezy API)", { skip: !enabled }, () => {
  let createdId: string | null = null;

  before(async () => {
    const stale = await listStaleCiDiscounts(testStoreId ?? "");
    for (const row of stale) {
      await deleteDiscount(row.id).catch(() => {});
    }
  });

  after(async () => {
    if (createdId) {
      await deleteDiscount(createdId).catch(() => {});
    }
  });

  it("creates, reads, and deletes a discount round-trip", async () => {
    const suffix = Date.now().toString(36);
    const name = `${CI_PREFIX}${suffix}`;
    const code = `CITEST${suffix.toUpperCase()}`;

    const created = await run(findTool(discountTools, "ls_create_discount"), {
      storeId: testStoreId,
      name,
      code,
      amount: 10,
      amountType: "percent",
      duration: "once",
    });
    assert.equal(created.ok, true, `create failed: ${created.error}`);
    const createdData = (created.data as { data?: { id?: string; attributes?: { name?: string } } }).data;
    assert.equal(createdData?.attributes?.name, name);
    assert.ok(createdData?.id, "create response missing id");
    createdId = createdData.id ?? null;

    const got = await run(findTool(discountTools, "ls_get_discount"), { discountId: createdId });
    assert.equal(got.ok, true, `get failed: ${got.error}`);
    const gotData = (got.data as { data?: { id?: string; attributes?: { name?: string; code?: string } } }).data;
    assert.equal(gotData?.id, createdId);
    assert.equal(gotData?.attributes?.name, name);
    assert.equal(gotData?.attributes?.code, code);

    const deleted = await run(findTool(discountTools, "ls_delete_discount"), { discountId: createdId });
    assert.equal(deleted.ok, true, `delete failed: ${deleted.error}`);
    createdId = null;

    const afterDelete = await run(findTool(discountTools, "ls_get_discount"), { discountId: gotData?.id ?? "" });
    assert.equal(afterDelete.ok, false, "discount still readable after delete");
    assert.equal(afterDelete.status, 404);
  });
});

describe("integration webhook write path (real LemonSqueezy API)", { skip: !enabled }, () => {
  let createdId: string | null = null;

  before(async () => {
    const stale = await listStaleCiWebhooks(testStoreId ?? "");
    for (const row of stale) {
      await deleteWebhook(row.id).catch(() => {});
    }
  });

  after(async () => {
    if (createdId) {
      await deleteWebhook(createdId).catch(() => {});
    }
  });

  it("creates, reads, and deletes a webhook round-trip", async () => {
    const suffix = Date.now().toString(36);
    const url = `https://example.com/${CI_PREFIX}${suffix}`;
    const secret = `ci-test-secret-${suffix}`;

    const created = await run(findTool(webhookTools, "ls_create_webhook"), {
      storeId: testStoreId,
      url,
      events: ["order_created"],
      secret,
    });
    assert.equal(created.ok, true, `create failed: ${created.error}`);
    const createdData = (created.data as { data?: { id?: string; attributes?: { url?: string } } }).data;
    assert.equal(createdData?.attributes?.url, url);
    assert.ok(createdData?.id, "create response missing id");
    createdId = createdData.id ?? null;

    const got = await run(findTool(webhookTools, "ls_get_webhook"), { webhookId: createdId });
    assert.equal(got.ok, true, `get failed: ${got.error}`);
    const gotData = (got.data as { data?: { id?: string; attributes?: { url?: string; events?: string[] } } }).data;
    assert.equal(gotData?.id, createdId);
    assert.equal(gotData?.attributes?.url, url);
    assert.ok(gotData?.attributes?.events?.includes("order_created"));

    const deleted = await run(findTool(webhookTools, "ls_delete_webhook"), { webhookId: createdId });
    assert.equal(deleted.ok, true, `delete failed: ${deleted.error}`);
    createdId = null;

    const afterDelete = await run(findTool(webhookTools, "ls_get_webhook"), { webhookId: gotData?.id ?? "" });
    assert.equal(afterDelete.ok, false, "webhook still readable after delete");
    assert.equal(afterDelete.status, 404);
  });
});

describe("integration customer write path (real LemonSqueezy API)", { skip: !enabled }, () => {
  let createdId: string | null = null;

  before(async () => {
    const stale = await listStaleCiActiveCustomers(testStoreId ?? "");
    for (const row of stale) {
      await archiveCustomer(row.id).catch(() => {});
    }
  });

  after(async () => {
    if (createdId) {
      await archiveCustomer(createdId).catch(() => {});
    }
  });

  it("creates, updates, and archives a customer round-trip", async () => {
    const suffix = Date.now().toString(36);
    const email = `${CI_PREFIX}${suffix}@example.com`;
    const name = `${CI_PREFIX}${suffix}`;

    const created = await run(findTool(customerTools, "ls_create_customer"), {
      storeId: testStoreId,
      name,
      email,
    });
    assert.equal(created.ok, true, `create failed: ${created.error}`);
    const createdData = (created.data as { data?: { id?: string; attributes?: { email?: string } } }).data;
    assert.equal(createdData?.attributes?.email, email);
    assert.ok(createdData?.id, "create response missing id");
    createdId = createdData.id ?? null;

    const updatedName = `${name}-updated`;
    const updated = await run(findTool(customerTools, "ls_update_customer"), {
      customerId: createdId,
      name: updatedName,
    });
    assert.equal(updated.ok, true, `update failed: ${updated.error}`);
    const updatedData = (updated.data as { data?: { attributes?: { name?: string } } }).data;
    assert.equal(updatedData?.attributes?.name, updatedName);

    const archived = await run(findTool(customerTools, "ls_archive_customer"), { customerId: createdId });
    assert.equal(archived.ok, true, `archive failed: ${archived.error}`);

    const got = await run(findTool(customerTools, "ls_get_customer"), { customerId: createdId });
    assert.equal(got.ok, true, `get failed: ${got.error}`);
    const gotData = (got.data as { data?: { attributes?: { status?: string } } }).data;
    assert.equal(gotData?.attributes?.status, "archived");

    createdId = null;
  });
});

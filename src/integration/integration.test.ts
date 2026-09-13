/**
 * Integration tests against a real LemonSqueezy store.
 *
 * Runs only when LEMONSQUEEZY_TEST_API_KEY and LEMONSQUEEZY_TEST_STORE_ID are
 * set. Skipped silently otherwise so local `npm test` doesn't require
 * credentials. There is no CI for this repo today -- `.github/` holds only
 * CODEOWNERS -- so this suite runs on demand via `npm run test:integration`
 * against a throwaway store, typically before cutting a release.
 *
 * Read paths are pure GET/list and touch nothing. The write-path round-trip
 * creates a throwaway discount, reads it back, and deletes it. Every resource
 * it creates is prefixed "ci-test-" so a failed run's leaked artifact is
 * obvious and the sweep step at the start of the next run can reap it.
 *
 * Goal: catch upstream schema drift on both read and write paths before users do.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { _resetApiKeyCacheForTest } from "../secret.js";
import { customerTools } from "../tools/customers.js";
import { discountTools } from "../tools/discounts.js";
import { orderTools } from "../tools/orders.js";
import { priceTools } from "../tools/prices.js";
import { productTools } from "../tools/products.js";
import { storeTools } from "../tools/stores.js";
import { subscriptionItemTools } from "../tools/subscription-items.js";
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

// Per-resource unique suffix. Nothing serializes runs of this suite -- two
// operators (or a re-run started before the previous one finished) can be
// live against the same test store at once, and a timestamp suffix would
// collide for anything started in the same millisecond. UUID v4 has enough
// entropy that the first 8 hex chars (32 bits) are collision-safe across any
// realistic concurrent-run window.
function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

// Snapshot every source the secret loader consults. A developer running the
// integration suite locally with a vault-backed LEMONSQUEEZY_API_KEY_COMMAND
// would otherwise hit their dev key -- the command source takes precedence
// over the bare env var in secret.ts, so just setting LEMONSQUEEZY_API_KEY
// here would be silently ignored. Clear all three, point the loader at the
// test key explicitly, and restore on teardown.
const prevApiKey = process.env.LEMONSQUEEZY_API_KEY;
const prevKeyCommand = process.env.LEMONSQUEEZY_API_KEY_COMMAND;
const prevTestApiKey = process.env.LEMONSQUEEZY_TEST_API_KEY;

function restoreEnvVar(name: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
}

before(() => {
  if (!enabled) return;
  delete process.env.LEMONSQUEEZY_API_KEY_COMMAND;
  delete process.env.LEMONSQUEEZY_TEST_API_KEY;
  process.env.LEMONSQUEEZY_API_KEY = testApiKey;
  // Reset the in-process secret cache so the first loadApiKey() call
  // reads from the freshly-set env var instead of returning whatever a
  // prior test (handlers.test.ts) left cached. Mirrors the pattern in
  // handlers.test.ts so the two suites compose cleanly when run together.
  _resetApiKeyCacheForTest();
});

after(() => {
  if (!enabled) return;
  restoreEnvVar("LEMONSQUEEZY_API_KEY", prevApiKey);
  restoreEnvVar("LEMONSQUEEZY_API_KEY_COMMAND", prevKeyCommand);
  restoreEnvVar("LEMONSQUEEZY_TEST_API_KEY", prevTestApiKey);
  // Drop the cached test key so anything that runs after this suite in
  // the same process picks up the restored env vars on its next call.
  _resetApiKeyCacheForTest();
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

/**
 * Price reads. Pure GETs -- creates nothing.
 *
 * The unit suite mocks `globalThis.fetch`, so it cannot see upstream schema
 * drift, and `api.ts` sits under every tool call. The specific drift that
 * would hurt most here is silent: `numericPrice()` reads `unit_price_decimal`
 * only when it is a STRING, and the integer it falls back to is null on
 * exactly the metered records that populate the decimal -- so the day LS
 * sends that field as a JSON number, every metered price reports
 * `effective_unit_price: null` with no error anywhere. Only a real payload
 * catches it.
 */
describe("integration price reads (real LemonSqueezy API)", { skip: !enabled }, () => {
  type PriceRecord = { id?: string; attributes?: Record<string, unknown> };

  it("annotates real price records, and the payload matches what the tool descriptions claim", async () => {
    // Discover a variant rather than hardcoding one -- the throwaway store's
    // ids differ per operator.
    const variants = await run(findTool(variantTools, "ls_list_variants"), { pageSize: 10 });
    assert.equal(variants.ok, true, `list variants failed: ${variants.error}`);
    const variantId = (variants.data as { data?: Array<{ id?: string }> }).data?.[0]?.id;
    if (!variantId) return; // a store with no variants has no prices to check

    const prices = await run(findTool(priceTools, "ls_list_prices"), { variantId, pageSize: 25 });
    assert.equal(prices.ok, true, `list prices failed: ${prices.error}`);
    const records = (prices.data as { data?: PriceRecord[] }).data ?? [];
    if (records.length === 0) return; // variant with no price records

    for (const record of records) {
      const attrs = record.attributes ?? {};
      const where = `price ${record.id}`;

      // The annotation must reach REAL payloads, not just fixtures -- this is
      // the only test that proves the wiring against the live API.
      assert.ok("effective_unit_price" in attrs, `${where} came back unannotated`);
      assert.ok("effective_unit_price_note" in attrs, `${where} has no provenance note`);

      // Drift canary, per the block comment above.
      const decimal = attrs.unit_price_decimal;
      if (decimal !== null && decimal !== undefined) {
        assert.equal(
          typeof decimal,
          "string",
          `${where}: unit_price_decimal arrived as ${typeof decimal}, not a string. numericPrice() ignores a ` +
            "non-string decimal and falls back to unit_price, which is null on exactly the metered records " +
            "that populate the decimal -- so every one of them would silently report a null charged price.",
        );
      }

      // `scheme` is what routes the whole derivation; a new or renamed value
      // upstream would fall through to the flat branch unnoticed.
      assert.equal(typeof attrs.scheme, "string", `${where}: scheme is not a string`);
      assert.ok(
        ["standard", "package", "graduated", "volume"].includes(attrs.scheme as string),
        `${where}: unknown scheme ${JSON.stringify(attrs.scheme)} -- LS has added a pricing model and ` +
          "computeEffectivePrice() is treating it as a flat price. Decide which branch it belongs in.",
      );

      // The per-scheme contract the tool descriptions promise.
      if (attrs.scheme === "volume" || attrs.scheme === "graduated") {
        assert.ok(Array.isArray(attrs.tiers), `${where}: a tiered scheme arrived without a tiers[] array`);
        assert.equal(attrs.unit_price_is_not_charged, true, `${where}: tiered record is missing the warning flag`);
        const firstTier = (attrs.tiers as Array<Record<string, unknown>>)[0];
        if (firstTier && typeof firstTier.unit_price === "number") {
          assert.equal(
            attrs.effective_unit_price,
            firstTier.unit_price,
            `${where}: effective_unit_price must be the first tier's rate, not the vestigial unit_price`,
          );
        }
      } else if (attrs.scheme === "package") {
        // Documented to be 1 for every non-package scheme, so it is always a
        // number -- and it is the divisor for the per-unit figure.
        assert.equal(typeof attrs.package_size, "number", `${where}: package scheme without a numeric package_size`);
        assert.equal(
          attrs.unit_price_is_not_charged,
          undefined,
          `${where}: package pricing DOES charge unit_price -- the not-charged flag would be a lie`,
        );
      }
    }

    // `ls_list_prices` tells the agent, in its own description, that the
    // current price is the newest by created_at because results are sorted
    // newest-first. That is a claim about LS's default sort baked into
    // user-facing guidance: if it is wrong, agents quote superseded prices.
    const createdAt = records.map((r) => r.attributes?.created_at).filter((v): v is string => typeof v === "string");
    for (let i = 1; i < createdAt.length; i++) {
      assert.ok(
        Date.parse(createdAt[i - 1] as string) >= Date.parse(createdAt[i] as string),
        "prices did not come back newest-first, so the ls_list_prices DESCRIPTION is wrong (not this test): " +
          "it tells agents the current price is the newest by created_at because results are sorted " +
          `newest-first. Got ${createdAt[i - 1]} before ${createdAt[i]}.`,
      );
    }
  });

  it("annotates a price embedded via ?include=price on a subscription item", async () => {
    // The seat-based-billing path. Skips cleanly on a store with no
    // subscriptions, which is the normal state of a fresh throwaway store.
    const items = await run(findTool(subscriptionItemTools, "ls_list_subscription_items"), { pageSize: 5 });
    if (!items.ok) return; // no subscriptions in this store, nothing to assert
    const first = (items.data as { data?: Array<{ id?: string }> }).data?.[0]?.id;
    if (!first) return;

    const got = await run(findTool(subscriptionItemTools, "ls_get_subscription_item"), {
      subscriptionItemId: first,
      include: "price",
    });
    assert.equal(got.ok, true, `get subscription item failed: ${got.error}`);
    const included = (got.data as { included?: PriceRecord[] }).included ?? [];
    const price = included.find((r) => (r as { type?: string }).type === "prices");
    if (!price) return; // the include is advisory; LS omitted it
    assert.ok(
      "effective_unit_price" in (price.attributes ?? {}),
      "an embedded price record reached the caller unannotated -- the seat-based-billing path is the one " +
        "most likely to be read as a per-seat rate",
    );
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
    const suffix = uniqueSuffix();
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
    const suffix = uniqueSuffix();
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
    const suffix = uniqueSuffix();
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

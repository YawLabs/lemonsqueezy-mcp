/**
 * Read-only integration tests against a real LemonSqueezy store.
 *
 * Runs only when LEMONSQUEEZY_TEST_API_KEY and LEMONSQUEEZY_TEST_STORE_ID are set
 * (typically in the nightly CI workflow). Skipped silently otherwise so local
 * `npm test` doesn't require credentials.
 *
 * Safe against a live production store: exercises only GET/list tools, never
 * creates, updates, refunds, or deletes anything.
 *
 * Goal: catch upstream schema drift on read paths before users do.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderTools } from "../tools/orders.js";
import { productTools } from "../tools/products.js";
import { storeTools } from "../tools/stores.js";
import { subscriptionTools } from "../tools/subscriptions.js";
import { userTools } from "../tools/users.js";
import { variantTools } from "../tools/variants.js";

type HandlerResult = { ok: boolean; data?: unknown; error?: string; status: number };

const testApiKey = process.env.LEMONSQUEEZY_TEST_API_KEY;
const testStoreId = process.env.LEMONSQUEEZY_TEST_STORE_ID;
const enabled = Boolean(testApiKey && testStoreId);

// Swap the runtime key to the test key for this suite only.
const prevApiKey = process.env.LEMONSQUEEZY_API_KEY;
if (enabled) process.env.LEMONSQUEEZY_API_KEY = testApiKey;

function findTool<T extends readonly { name: string }[]>(tools: T, name: string): T[number] {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

async function run(tool: { handler: unknown }, input: Record<string, unknown>): Promise<HandlerResult> {
  const handler = tool.handler as (input: Record<string, unknown>) => Promise<HandlerResult>;
  return handler(input);
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

  it("lists variants scoped to the test store", async () => {
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

// Restore env after the suite queues (node:test runs suites synchronously at module load;
// handlers run async later — restoring here is only for cleanliness in watch mode).
if (enabled && prevApiKey !== undefined) {
  process.env.LEMONSQUEEZY_API_KEY = prevApiKey;
}

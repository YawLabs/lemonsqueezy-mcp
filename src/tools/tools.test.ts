import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeEffectivePrice } from "../effective-price.js";
import { AUTHORITY_CLASSES, isDestructiveCall } from "../guardrails.js";
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
import { sinkTools } from "./sink.js";
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
  ...sinkTools,
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
    assert.equal(allTools.length, 64);
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

      it("should declare a valid authorityClass", () => {
        const cls = (tool as { authorityClass?: string }).authorityClass;
        assert.ok(cls, `Tool ${tool.name} is missing authorityClass`);
        assert.ok(
          (AUTHORITY_CLASSES as readonly string[]).includes(cls as string),
          `Tool ${tool.name} has invalid authorityClass ${JSON.stringify(cls)} (expected one of: ${AUTHORITY_CLASSES.join(", ")})`,
        );
      });
    });
  }
});

// The public surface SEMVER.md promises is pinned here, list by list, so a
// change to any of it fails the build instead of shipping unnoticed. Every
// list below is part of the 1.0 contract: an MCP client reads the annotations
// verbatim (index.ts passes them straight to server.tool), and an operator's
// LEMONSQUEEZY_DISABLE_CLASSES / RATE_LIMIT_PER_CLASS / DESTRUCTIVE_RATE_LIMIT
// settings mean whatever these lists say they mean.
describe("Surface lock (1.0 -- SEMVER.md)", () => {
  const SURFACE_MSG =
    "This list is part of the 1.0 public surface. Changing it is a SEMVER decision, not a test fixup: " +
    "classify the change per SEMVER.md, call it out in CHANGELOG.md, and update README.md in the same change " +
    "(the LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT row, the authority-class table, and the tool catalogue).";

  const names = (pred: (t: (typeof allTools)[number]) => boolean) =>
    allTools
      .filter(pred)
      .map((t) => t.name)
      .sort();
  const hasPredicate = (t: (typeof allTools)[number]) =>
    typeof (t as { isDestructive?: unknown }).isDestructive === "function";

  // Static destructiveHint:true -- what MCP clients see. The 9 tools without
  // a predicate (ALWAYS_DESTRUCTIVE) are destructive on every call; the 4 with
  // one (PREDICATE_DESTRUCTIVE) only for some inputs.
  const DESTRUCTIVE_HINT_TRUE = [
    "ls_archive_customer",
    "ls_cancel_subscription",
    "ls_create_usage_record",
    "ls_deactivate_license",
    "ls_delete_discount",
    "ls_delete_webhook",
    "ls_refund_order",
    "ls_refund_subscription_invoice",
    "ls_update_customer",
    "ls_update_license_key",
    "ls_update_subscription",
    "ls_update_subscription_item",
    "ls_update_webhook",
  ];

  // Static destructiveHint:true and no predicate: isDestructiveCall is true
  // for every input, so every call counts against
  // LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT and lands in the audit log.
  const ALWAYS_DESTRUCTIVE = [
    "ls_archive_customer",
    "ls_cancel_subscription",
    "ls_create_usage_record",
    "ls_deactivate_license",
    "ls_delete_discount",
    "ls_delete_webhook",
    "ls_refund_order",
    "ls_refund_subscription_invoice",
    "ls_update_subscription_item",
  ];

  // Tools whose server-side verdict (isDestructiveCall) depends on the input.
  // Which inputs count is pinned by the per-tool predicate blocks in this file.
  const PREDICATE_DESTRUCTIVE = [
    "ls_update_customer",
    "ls_update_license_key",
    "ls_update_subscription",
    "ls_update_webhook",
  ];

  const NOT_READ_ONLY = [
    "ls_activate_license",
    "ls_archive_customer",
    "ls_cancel_subscription",
    "ls_create_checkout",
    "ls_create_customer",
    "ls_create_discount",
    "ls_create_usage_record",
    "ls_create_webhook",
    "ls_deactivate_license",
    "ls_delete_discount",
    "ls_delete_webhook",
    "ls_generate_order_invoice",
    "ls_generate_subscription_invoice",
    "ls_refund_order",
    "ls_refund_subscription_invoice",
    "ls_sink_event_mark_processed",
    "ls_update_customer",
    "ls_update_license_key",
    "ls_update_subscription",
    "ls_update_subscription_item",
    "ls_update_webhook",
  ];

  // Every tool's authority class. Moving a tool between classes changes what
  // an operator's class gates and per-class budgets cover, so it is pinned in
  // full rather than spot-checked.
  const AUTHORITY_CLASS_BY_TOOL: Record<string, string> = {
    ls_activate_license: "key",
    ls_archive_customer: "pii",
    ls_cancel_subscription: "recurring",
    ls_create_checkout: "mutate",
    ls_create_customer: "pii",
    ls_create_discount: "mutate",
    ls_create_usage_record: "recurring",
    ls_create_webhook: "webhook",
    ls_deactivate_license: "key",
    ls_delete_discount: "mutate",
    ls_delete_webhook: "webhook",
    ls_generate_order_invoice: "mutate",
    ls_generate_subscription_invoice: "mutate",
    ls_get_affiliate: "read",
    ls_get_checkout: "read",
    ls_get_customer: "pii",
    ls_get_discount: "read",
    ls_get_discount_redemption: "read",
    ls_get_file: "read",
    ls_get_license_key: "read",
    ls_get_license_key_instance: "read",
    ls_get_order: "read",
    ls_get_order_item: "read",
    ls_get_price: "read",
    ls_get_product: "read",
    ls_get_store: "read",
    ls_get_subscription: "read",
    ls_get_subscription_invoice: "read",
    ls_get_subscription_item: "read",
    ls_get_subscription_item_usage: "read",
    ls_get_usage_record: "read",
    ls_get_user: "read",
    ls_get_variant: "read",
    ls_get_webhook: "read",
    ls_list_affiliates: "read",
    ls_list_checkouts: "read",
    ls_list_customers: "pii",
    ls_list_discount_redemptions: "read",
    ls_list_discounts: "read",
    ls_list_files: "read",
    ls_list_license_key_instances: "read",
    ls_list_license_keys: "read",
    ls_list_order_items: "read",
    ls_list_orders: "read",
    ls_list_prices: "read",
    ls_list_products: "read",
    ls_list_stores: "read",
    ls_list_subscription_invoices: "read",
    ls_list_subscription_items: "read",
    ls_list_subscriptions: "read",
    ls_list_usage_records: "read",
    ls_list_variants: "read",
    ls_list_webhooks: "read",
    ls_refund_order: "money",
    ls_refund_subscription_invoice: "money",
    ls_sink_event_mark_processed: "mutate",
    ls_sink_events_list: "read",
    ls_sink_stats: "read",
    ls_update_customer: "pii",
    ls_update_license_key: "key",
    ls_update_subscription: "recurring",
    ls_update_subscription_item: "recurring",
    ls_update_webhook: "webhook",
    ls_validate_license: "read",
  };

  it("the destructiveHint:true set is exactly the locked list", () => {
    assert.deepEqual(
      names((t) => t.annotations.destructiveHint === true),
      DESTRUCTIVE_HINT_TRUE,
      SURFACE_MSG,
    );
  });

  it("the isDestructive-predicate set is exactly the locked list", () => {
    assert.deepEqual(names(hasPredicate), PREDICATE_DESTRUCTIVE, SURFACE_MSG);
  });

  it("the readOnlyHint:false set is exactly the locked list", () => {
    assert.deepEqual(
      names((t) => t.annotations.readOnlyHint === false),
      NOT_READ_ONLY,
      SURFACE_MSG,
    );
  });

  it("the always-destructive set (static true, no predicate) is exactly the locked list", () => {
    assert.deepEqual(
      names((t) => t.annotations.destructiveHint === true && !hasPredicate(t)),
      ALWAYS_DESTRUCTIVE,
      SURFACE_MSG,
    );
    // The three lists must agree with each other: the 13 static-true tools are
    // exactly the 9 always-destructive ones plus the 4 predicate ones.
    assert.deepEqual([...ALWAYS_DESTRUCTIVE, ...PREDICATE_DESTRUCTIVE].sort(), DESTRUCTIVE_HINT_TRUE);
  });

  it("every static-destructive tool without a predicate is destructive on every call", () => {
    // Destructive coverage is defined by isDestructiveCall(tool, input), not
    // by the annotation alone. For the 9 predicate-less tools the verdict
    // must not depend on input -- an empty input is enough to show it.
    const unconditional = allTools.filter((t) => ALWAYS_DESTRUCTIVE.includes(t.name));
    assert.equal(unconditional.length, ALWAYS_DESTRUCTIVE.length, SURFACE_MSG);
    for (const tool of unconditional) {
      const asCheckable = tool as unknown as Parameters<typeof isDestructiveCall>[0];
      assert.equal(isDestructiveCall(asCheckable, {}), true, `${tool.name}: ${SURFACE_MSG}`);
    }
  });

  it("every tool's authority class matches the locked map", () => {
    assert.equal(Object.keys(AUTHORITY_CLASS_BY_TOOL).length, 64, `the map must cover all 64 tools. ${SURFACE_MSG}`);
    const actual = Object.fromEntries(allTools.map((t) => [t.name, (t as { authorityClass: string }).authorityClass]));
    assert.deepEqual(actual, AUTHORITY_CLASS_BY_TOOL, SURFACE_MSG);
  });
});

describe("ls_update_license_key predicate", () => {
  const tool = licenseKeyTools.find((t) => t.name === "ls_update_license_key") as
    | { isDestructive?: (input: Record<string, unknown>) => boolean }
    | undefined;

  it("should expose an isDestructive predicate", () => {
    assert.ok(tool, "ls_update_license_key tool not found");
    assert.equal(typeof tool?.isDestructive, "function");
  });

  it("treats disabled: true as destructive", () => {
    assert.equal(tool?.isDestructive?.({ disabled: true }), true);
  });

  it("treats activationLimit: 0 as destructive", () => {
    assert.equal(tool?.isDestructive?.({ activationLimit: 0 }), true);
  });

  it("treats activationLimit: 100 as destructive", () => {
    assert.equal(tool?.isDestructive?.({ activationLimit: 100 }), true);
  });

  it("treats activationLimit: null (unlimited) as destructive", () => {
    // Any limit change counts: the predicate cannot tell a raise from a cut
    // without the current value, and null is a change like any other.
    assert.equal(tool?.isDestructive?.({ activationLimit: null }), true);
  });

  it("treats an expiresAt change as destructive, date or null", () => {
    // An earlier expiry narrows access; the predicate cannot tell earlier
    // from later without fetching the key, so every expiry change counts.
    assert.equal(tool?.isDestructive?.({ expiresAt: "2026-01-01" }), true);
    assert.equal(tool?.isDestructive?.({ expiresAt: null }), true);
  });

  it("treats disabled: false (re-enabling) as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({ disabled: false }), false);
  });

  it("treats an empty input as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({}), false);
  });
});

describe("ls_update_webhook predicate", () => {
  const tool = webhookTools.find((t) => t.name === "ls_update_webhook") as
    | { isDestructive?: (input: Record<string, unknown>) => boolean }
    | undefined;

  it("should expose an isDestructive predicate", () => {
    assert.ok(tool, "ls_update_webhook tool not found");
    assert.equal(typeof tool?.isDestructive, "function");
  });

  it("treats a secret change as destructive", () => {
    assert.equal(tool?.isDestructive?.({ secret: "new-secret" }), true);
  });

  it("treats a url-only change as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({ url: "https://new.example.com/hook" }), false);
  });

  it("treats an events-only change as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({ events: ["order_created"] }), false);
  });

  it("treats an empty input as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({}), false);
  });
});

describe("Conditional-destructive disclosure", () => {
  // A tool with an isDestructive predicate decides per call whether the
  // server rate-limits and audits it, but an MCP annotation is static, so a
  // client sees destructiveHint:true on every call to it, benign or not. The
  // description is the only channel that tells the caller WHICH inputs the
  // server treats as destructive, so it is load-bearing rather than
  // decorative. ls_update_subscription shipped without it while its three
  // siblings had it.
  it("every tool with an isDestructive predicate says so in its description", () => {
    const predicateTools = allTools.filter(
      (t) => typeof (t as { isDestructive?: unknown }).isDestructive === "function",
    );
    assert.ok(predicateTools.length >= 4, "expected the known predicate tools to be discoverable");

    for (const tool of predicateTools) {
      assert.match(
        tool.description,
        /destructive|audited|rate-limited/i,
        `Tool ${tool.name} decides destructiveness per call but its description never warns the caller. ` +
          "Its static destructiveHint is the same on every call, so the description is the only per-input signal.",
      );
    }
  });

  it("a predicate tool also declares static destructiveHint:true", () => {
    // Inverted for 1.0 -- this used to forbid true. MCP defines
    // destructiveHint:false as "performs only additive updates", and every
    // predicate tool is a PATCH that can overwrite, revoke or re-bill, so
    // false misstates it to the client. True costs nothing server-side:
    // isDestructiveCall never reads the static hint when a predicate exists
    // (asserted in the next test), so benign calls still skip the destructive
    // limiter and the audit log.
    for (const tool of allTools) {
      if (typeof (tool as { isDestructive?: unknown }).isDestructive !== "function") continue;
      assert.equal(
        tool.annotations.destructiveHint,
        true,
        `Tool ${tool.name} has an isDestructive predicate but destructiveHint:${String(tool.annotations.destructiveHint)}. ` +
          "Predicate tools must declare true; changing that is a SEMVER decision (see SEMVER.md), not a test fixup.",
      );
    }
  });

  it("the predicate, not the static true, decides the server-side verdict", () => {
    // One benign and one destructive input per predicate tool, run through
    // the same isDestructiveCall the wrapper uses. If the static hint ever
    // leaked into the verdict, every benign call below would come back true
    // and land in the destructive limiter and the audit log.
    const cases: { name: string; benign: Record<string, unknown>; destructive: Record<string, unknown> }[] = [
      { name: "ls_update_customer", benign: { name: "New Name" }, destructive: { status: "archived" } },
      { name: "ls_update_license_key", benign: { disabled: false }, destructive: { disabled: true } },
      { name: "ls_update_subscription", benign: { pause: "resume" }, destructive: { pause: "void" } },
      { name: "ls_update_webhook", benign: { url: "https://example.com/hook" }, destructive: { secret: "rotated" } },
    ];
    for (const { name, benign, destructive } of cases) {
      const tool = allTools.find((t) => t.name === name) as unknown as Parameters<typeof isDestructiveCall>[0];
      assert.ok(tool, `${name} not found`);
      assert.equal(isDestructiveCall(tool, benign), false, `${name}: benign input must stay non-destructive`);
      assert.equal(isDestructiveCall(tool, destructive), true, `${name}: destructive input must count`);
    }
  });
});

describe("ls_update_customer predicate", () => {
  // customers.ts:118 -- setting status to "archived" through the general
  // update tool is the same operation as ls_archive_customer, so it must
  // engage the same rate limiter and audit log. If this predicate stops
  // firing, the dedicated archive tool's destructiveHint becomes a side
  // channel: archive via ls_update_customer and nothing is recorded.
  const tool = customerTools.find((t) => t.name === "ls_update_customer") as
    | { isDestructive?: (input: Record<string, unknown>) => boolean }
    | undefined;

  it("should expose an isDestructive predicate", () => {
    assert.ok(tool, "ls_update_customer tool not found");
    assert.equal(typeof tool?.isDestructive, "function");
  });

  it("treats status: 'archived' as destructive", () => {
    assert.equal(tool?.isDestructive?.({ customerId: "1", status: "archived" }), true);
  });

  it("treats a name/email edit as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({ customerId: "1", name: "New Name" }), false);
    assert.equal(tool?.isDestructive?.({ customerId: "1", email: "a@b.com" }), false);
  });

  it("treats an empty input as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({}), false);
  });

  it("does not fire on a near-miss status value", () => {
    // The schema constrains status to the literal "archived", so these never
    // reach the predicate in production -- but the predicate must not widen
    // to a substring/truthiness check if the schema is ever relaxed.
    assert.equal(tool?.isDestructive?.({ status: "archive" }), false);
    assert.equal(tool?.isDestructive?.({ status: "Archived" }), false);
  });
});

describe("ls_update_subscription predicate", () => {
  // subscriptions.ts isDestructive -- every input that changes what the
  // customer pays or when (pause, plan switch, billing anchor, immediate
  // invoice, trial end) must be audited/rate-limited; resuming, un-cancelling
  // and the proration toggles must not be. Getting this backwards either
  // hides recurring-revenue changes from the audit log or floods it with
  // un-pauses.
  const tool = subscriptionTools.find((t) => t.name === "ls_update_subscription") as
    | { isDestructive?: (input: Record<string, unknown>) => boolean }
    | undefined;

  it("should expose an isDestructive predicate", () => {
    assert.ok(tool, "ls_update_subscription tool not found");
    assert.equal(typeof tool?.isDestructive, "function");
  });

  it("treats a pause (void or free) as destructive", () => {
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", pause: "void" }), true);
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", pause: "free" }), true);
  });

  it("treats pause: 'resume' as NON-destructive", () => {
    // Resuming restores access -- it reverses a destructive action rather
    // than being one.
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", pause: "resume" }), false);
  });

  it("treats a plan switch (variantId) as destructive", () => {
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", variantId: "42" }), true);
  });

  it("treats a billing-anchor change as destructive", () => {
    // Upstream issues a paid, prorated trial up to the new anchor date.
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", billingAnchor: 15 }), true);
  });

  it("treats invoiceImmediately: true as destructive, and false as not", () => {
    // true charges the update now (prorated invoice, payment attempted);
    // false is the default deferred proration.
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", invoiceImmediately: true }), true);
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", invoiceImmediately: false }), false);
  });

  it("treats a trialEndsAt change as destructive, date or null", () => {
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", trialEndsAt: "2026-12-01T00:00:00Z" }), true);
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", trialEndsAt: null }), true);
  });

  it("treats cancelled: false and disableProrations as non-destructive", () => {
    // cancelled:false is the pair of pause:"resume" -- both reverse a
    // destructive action -- so the two must stay on the same side of the
    // predicate.
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", cancelled: false }), false);
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", pause: "resume" }), false);
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", disableProrations: true }), false);
  });

  it("treats an empty input as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({}), false);
  });
});

describe("Allowlist gate alignment", () => {
  // The wrapper's storeId allowlist gate (`checkStoreScopedToolInput` in
  // `guardrails.ts`) keys off the literal input field name "storeId". A
  // list tool whose filterMap maps a different input field (e.g. "store",
  // "store_id") to filter[store_id] would silently bypass
  // LEMONSQUEEZY_ALLOWED_STORE_IDS. This invariant locks the convention
  // so a future tool addition can't open that gap.
  it("every list tool that produces filter[store_id]= uses 'storeId' as the input field name", () => {
    for (const tool of allTools) {
      const handler = tool.handler as unknown as { filterMap?: Record<string, string> };
      const filterMap = handler.filterMap;
      if (!filterMap) continue;
      const storeIdInputKey = Object.entries(filterMap).find(([, apiKey]) => apiKey === "store_id")?.[0];
      if (!storeIdInputKey) continue;
      assert.equal(
        storeIdInputKey,
        "storeId",
        `Tool ${tool.name} maps input "${storeIdInputKey}" -> filter[store_id]. ` +
          `The allowlist gate keys off the literal "storeId" input field; renaming silently bypasses LEMONSQUEEZY_ALLOWED_STORE_IDS.`,
      );
      const shape = (tool.inputSchema as { shape: Record<string, unknown> }).shape;
      assert.ok(
        "storeId" in shape,
        `Tool ${tool.name} produces filter[store_id]= but has no "storeId" input field; allowlist gate would silently skip.`,
      );
    }
  });

  // The assertion above catches a list tool that RENAMES its storeId input.
  // It does not catch a list tool that has NEITHER a storeId field NOR
  // requiredFilters -- such a tool is completely ungated by
  // LEMONSQUEEZY_ALLOWED_STORE_IDS (checkStoreScopedToolInput takes both
  // branches as no-ops) and returns rows from every store the API key can
  // see. That is a deliberate, documented state for exactly two endpoints
  // that have no parent ID to scope by. Any THIRD one is a new cross-store
  // hole and must be an explicit decision, not an oversight.
  const KNOWN_UNGATED_LIST_TOOLS = new Set(["ls_list_stores", "ls_list_affiliates"]);

  it("no NEW list tool is ungated by the store allowlist", () => {
    const ungated: string[] = [];
    for (const tool of allTools) {
      const handler = tool.handler as unknown as { filterMap?: Record<string, string> };
      if (!handler.filterMap) continue;
      const shape = (tool.inputSchema as { shape: Record<string, unknown> }).shape;
      const requiredFilters = (tool as { requiredFilters?: readonly string[] }).requiredFilters;
      if ("storeId" in shape) continue;
      if (requiredFilters && requiredFilters.length > 0) continue;
      ungated.push(tool.name);
    }
    const unexpected = ungated.filter((n) => !KNOWN_UNGATED_LIST_TOOLS.has(n));
    assert.deepEqual(
      unexpected,
      [],
      `List tool(s) ${unexpected.join(", ")} have neither a "storeId" input field nor requiredFilters, ` +
        "so LEMONSQUEEZY_ALLOWED_STORE_IDS does not gate them at all. Add a storeId field or requiredFilters, " +
        "or -- if the endpoint genuinely has no parent ID to scope by -- add the name to KNOWN_UNGATED_LIST_TOOLS " +
        "AND disclose it in the tool description via crossStoreUngatedNote().",
    );
  });

  // Both invariants above SKIP a tool whose handler has no filterMap
  // (`if (!filterMap) continue`), so a handler wrapper that drops the
  // property does not fail them -- it silently removes that tool from the
  // gate. Lock the property itself: every ls_list_* tool is built by
  // `listHandler`, which attaches filterMap (`{}` where the endpoint takes no
  // filters), and the price / subscription-item list tools re-wrap that
  // handler to annotate effective prices.
  it("every ls_list_* tool's handler still exposes filterMap after any wrapping", () => {
    const listTools = allTools.filter((t) => t.name.startsWith("ls_list_"));
    assert.ok(
      listTools.length > 0,
      "found no ls_list_* tools -- the naming convention this invariant keys off has changed, so it is now a no-op",
    );
    for (const tool of listTools) {
      const handler = tool.handler as unknown as { filterMap?: Record<string, string> };
      assert.ok(
        handler.filterMap !== null && typeof handler.filterMap === "object",
        `Tool ${tool.name} has no handler.filterMap, so the allowlist-alignment invariants above skip it ` +
          "entirely rather than fail. A handler wrapper must carry listHandler's metadata through " +
          "(Object.assign(wrapped, handler)).",
      );
    }
  });

  it("every known-ungated list tool discloses the gap in its own description", () => {
    // README documents this, but an agent picking tools only ever reads the
    // description in tools/list. ls_list_stores shipped without the note.
    for (const name of KNOWN_UNGATED_LIST_TOOLS) {
      const tool = allTools.find((t) => t.name === name);
      assert.ok(tool, `${name} listed in KNOWN_UNGATED_LIST_TOOLS but not found in allTools`);
      assert.match(
        tool.description,
        /LEMONSQUEEZY_ALLOWED_STORE_IDS does NOT gate this tool/,
        `${name} is ungated by the store allowlist but its description does not say so.`,
      );
    }
  });

  // Every tool that declares requiredFilters must also name those filters in
  // its description -- the two are generated from one array per module
  // (crossStoreFilterNote(FILTERS)), and this pins that they stay coupled.
  it("every requiredFilters tool names its filters in the description", () => {
    for (const tool of allTools) {
      const requiredFilters = (tool as { requiredFilters?: readonly string[] }).requiredFilters;
      if (!requiredFilters || requiredFilters.length === 0) continue;
      assert.match(
        tool.description,
        /when LEMONSQUEEZY_ALLOWED_STORE_IDS is set, this tool requires at least one of:/,
        `Tool ${tool.name} declares requiredFilters but its description omits the cross-store note.`,
      );
      for (const filter of requiredFilters) {
        assert.ok(
          tool.description.includes(filter),
          `Tool ${tool.name} requires filter "${filter}" but does not name it in the description.`,
        );
      }
    }
  });
});

describe("Price-contract disclosure", () => {
  // ls_get_price / ls_list_prices annotate the price records they return, and
  // ls_get_subscription_item / ls_list_subscription_items annotate the ones
  // embedded by `include=price` -- all four wrap their handler in
  // withEffectivePrice / withEmbeddedEffectivePrice. The description is where
  // that annotation is PROMISED, and the promise and the wrapper can come
  // apart in either direction: unwrapping the four handlers leaves four
  // descriptions advertising a field that no longer appears in the payload.
  // This holds the half a description test can hold -- green here means the
  // promise is still made, not that it is still kept.
  const EFFECTIVE_PRICE_FIELD = "effective_unit_price";
  const ANNOTATED_PRICE_TOOLS = [
    "ls_get_price",
    "ls_list_prices",
    "ls_get_subscription_item",
    "ls_list_subscription_items",
  ];

  it("every tool that annotates price records promises effective_unit_price in its description", () => {
    for (const name of ANNOTATED_PRICE_TOOLS) {
      const tool = allTools.find((t) => t.name === name);
      assert.ok(tool, `${name} listed in ANNOTATED_PRICE_TOOLS but not found in allTools`);
      assert.ok(
        tool.description.includes(`\`${EFFECTIVE_PRICE_FIELD}\``),
        `Tool ${name} annotates its price records but never names ${EFFECTIVE_PRICE_FIELD} in its description. ` +
          "An agent choosing a tool reads only what tools/list shows it, so an unannounced annotation is one nobody " +
          "looks for -- it goes on quoting the vestigial unit_price instead.",
      );
    }
  });

  it("every tool that annotates price records still warns off unit_price", () => {
    // Naming the good field is only half the message. The incident was an
    // agent confidently reading the field that IS there, not one failing to
    // find a field that was missing, so the warning has to survive too.
    for (const name of ANNOTATED_PRICE_TOOLS) {
      const tool = allTools.find((t) => t.name === name);
      assert.ok(tool, `${name} listed in ANNOTATED_PRICE_TOOLS but not found in allTools`);
      assert.ok(
        tool.description.includes("`unit_price`") && tool.description.includes("vestigial"),
        `Tool ${name} promises ${EFFECTIVE_PRICE_FIELD} but no longer calls unit_price vestigial. The raw field is ` +
          "still in the payload next to the annotation, identical across products that bill very differently, and " +
          "nothing but this sentence tells the caller which of the two to trust.",
      );
    }
  });

  // The rename half of the same coupling, and the reason these key names are
  // not spelled out here: renaming a flag in effective-price.ts while the
  // description kept advertising the old spelling would leave a hardcoded
  // assertion in this file green. So the names come from the annotator itself
  // -- one fixture per branch of computeEffectivePrice -- and the description
  // has to name whatever the code actually emits today.
  it("both price tools name every annotation key computeEffectivePrice can emit", () => {
    const standard = computeEffectivePrice({ scheme: "standard", unit_price: 1000 });
    const tiered = computeEffectivePrice({ scheme: "volume", unit_price: 2000, tiers: [{ unit_price: 10000 }] });
    const packaged = computeEffectivePrice({ scheme: "package", unit_price: 5000, package_size: 5 });
    const emitted = new Set([...Object.keys(standard), ...Object.keys(tiered), ...Object.keys(packaged)]);
    assert.ok(
      emitted.size >= 4,
      `Expected both always-present keys and both conditional flags; got: ${[...emitted].join(", ")}. ` +
        "A branch these fixtures no longer reach is a flag this invariant silently stops checking.",
    );

    for (const name of ["ls_get_price", "ls_list_prices"]) {
      const tool = allTools.find((t) => t.name === name);
      assert.ok(tool, `${name} not found in allTools`);
      for (const key of emitted) {
        assert.ok(
          tool.description.includes(key),
          `Tool ${name} never names "${key}", which computeEffectivePrice puts on the records it returns. Either the ` +
            "key was renamed in effective-price.ts and the description still advertises the old spelling, or a new " +
            "flag ships undocumented -- either way the payload carries a field the description cannot explain.",
        );
      }
    }
  });

  // The variant tools are the other side of the same incident, and unlike the
  // four above they have no payload mitigation at all: a variant record is
  // never annotated, so its `price` reaches the caller exactly as the API
  // returned it -- the field that read the same value for three products
  // billing $25, $100 and $200 per seat. Here the description IS the whole
  // mitigation, and deleting it from both tools is a fully green run today.
  it("both variant tools keep the price warning and the redirect to ls_list_prices", () => {
    for (const name of ["ls_get_variant", "ls_list_variants"]) {
      const tool = allTools.find((t) => t.name === name);
      assert.ok(tool, `${name} not found in allTools`);
      assert.match(
        tool.description,
        /WARNING: do NOT read `price` as the amount charged/,
        `Tool ${name} no longer warns that a variant's price is not the amount charged. Variant payloads are never ` +
          "annotated, so nothing else in this tool's response contradicts a caller who reads that field.",
      );
      assert.ok(
        tool.description.includes("ls_list_prices"),
        `Tool ${name} warns off the variant price but no longer says where the real one lives. ls_list_prices with ` +
          "this variantId is the redirect; a warning with nowhere to go leaves the caller on the wrong field anyway.",
      );
      assert.ok(
        tool.description.includes(EFFECTIVE_PRICE_FIELD),
        `Tool ${name} redirects to the price resource but never names ${EFFECTIVE_PRICE_FIELD}, the field to read ` +
          "once there. Price records carry a unit_price too, so an unqualified redirect lands on the same misread.",
      );
    }
  });
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
  it("sinkTools has 3 tools", () => assert.equal(sinkTools.length, 3));
});

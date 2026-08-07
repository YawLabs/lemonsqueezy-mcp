import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTHORITY_CLASSES } from "../guardrails.js";
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

  it("treats expiresAt-only changes as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({ expiresAt: "2026-01-01" }), false);
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
  // A tool with an isDestructive predicate carries destructiveHint:false,
  // because the verdict is per-call and the MCP annotation is static. That is
  // correct, but it means a client deciding whether to prompt sees "not
  // destructive" for a call that the server will rate-limit and audit. The
  // description is the only channel left to warn the caller, so it is
  // load-bearing rather than decorative. ls_update_subscription shipped
  // without it while its three siblings had it.
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
          "Its static destructiveHint is false, so an MCP client will not prompt -- the description is the only signal left.",
      );
    }
  });

  it("a predicate tool does not also claim destructiveHint:true", () => {
    // Both together would be contradictory: the static hint would force a
    // prompt on every call including the benign ones, making the predicate
    // pointless and training users to click through.
    for (const tool of allTools) {
      if (typeof (tool as { isDestructive?: unknown }).isDestructive !== "function") continue;
      assert.notEqual(
        tool.annotations.destructiveHint,
        true,
        `Tool ${tool.name} has both an isDestructive predicate and destructiveHint:true.`,
      );
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
  // subscriptions.ts:94 -- pausing or switching plan is customer-impacting
  // and must be audited/rate-limited; resuming and the billing-neutral edits
  // must not be. Getting this backwards either hides recurring-revenue
  // changes from the audit log or floods it with un-pauses.
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

  it("treats the billing-neutral edits as non-destructive", () => {
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", cancelled: false }), false);
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", billingAnchor: 15 }), false);
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", trialEndsAt: null }), false);
    assert.equal(tool?.isDestructive?.({ subscriptionId: "1", invoiceImmediately: true }), false);
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

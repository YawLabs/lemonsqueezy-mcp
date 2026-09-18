/**
 * End-to-end tests for the registered MCP tool wrapper and the audit-log
 * Resource. Every handler test in `tools/handlers.test.ts` calls
 * `tool.handler(input)` directly, bypassing the wrapper. The guardrail
 * gates and the audit pipeline live in the wrapper, so without these tests
 * a regression that reordered or removed a check would pass CI silently.
 *
 * What this file covers:
 *
 *   - checkClassAllowed fires (LEMONSQUEEZY_DISABLE_CLASSES) and is reported
 *     as a guardrail_block in the audit entry
 *   - checkClassRateLimit fires (LEMONSQUEEZY_RATE_LIMIT_PER_CLASS) and the
 *     N+1 call is rejected with a class rate-limit message
 *   - checkDestructiveRateLimit fires only when the call is destructive,
 *     and class-disabled calls do NOT contribute to the destructive count
 *   - checkStoreScopedToolInput fires when the allowlist is set and the
 *     input is missing storeId
 *   - On success of a destructive call, the audit ring receives a
 *     redacted entry (status: ok, audit: true, inputs masked at secret keys)
 *   - On a guardrail block, the audit ring receives a guardrail_block entry
 *   - The audit-log Resource returns application/x-ndjson with the
 *     most-recent entry first, one JSON object per line; an empty buffer
 *     yields an empty text body
 *   - isDestructive predicates (e.g. ls_update_license_key with
 *     activationLimit) flow through the wrapper, not just the static
 *     destructiveHint annotation
 *   - The REAL price tools, driven through createToolHandler with a mocked
 *     fetch, so a response-side annotation the handler DERIVED is asserted on
 *     the serialized text the client actually receives -- every other test
 *     here uses a synthetic handler that echoes a literal back
 *   - The REAL ls_deactivate_license (issue #40): destructive on every call,
 *     blocked by LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT=0 before any HTTP call,
 *     and its raw license key never reaches stderr, the audit ring, or the
 *     audit-log resource on any outcome
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { z } from "zod";
import { _resetAuditBufferForTest, readAuditEntries } from "./audit-buffer.js";
import { _resetGuardrailsForTest, GuardrailError, ToolInputError } from "./guardrails.js";
import { maskLicenseKey } from "./redact.js";
import { _resetApiKeyCacheForTest } from "./secret.js";
import { licenseTools } from "./tools/licenses.js";
import { priceTools } from "./tools/prices.js";
import { createToolHandler, type McpToolResult, type RegisterableTool, readAuditLogResource } from "./wrapper.js";

const ENV_KEYS = [
  "LEMONSQUEEZY_ALLOWED_STORE_IDS",
  "LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS",
  "LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT",
  "LEMONSQUEEZY_DISABLE_CLASSES",
  "LEMONSQUEEZY_RATE_LIMIT_PER_CLASS",
  "LEMONSQUEEZY_LOG",
] as const;

function saveEnv() {
  const snapshot: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snapshot[k] = process.env[k];
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

// Minimal in-memory tool stand-ins. Real tools live in src/tools/*.ts and
// hit the LemonSqueezy API; we don't need that here -- only that the
// wrapper threads input -> guardrails -> handler -> audit/log -> result
// correctly. The handler is a stub that records its calls.
//
// Typed at `RegisterableTool<Record<string, unknown>>` rather than the
// default `RegisterableTool<unknown>` so the stub handlers and predicates
// can read input.someField without a per-call cast. The wrapper itself
// remains generic over TInput; this test fixture just picks a concrete
// shape.
type TestTool = RegisterableTool<Record<string, unknown>> & { calls: unknown[] };

function makeTool(overrides: Partial<TestTool> = {}): TestTool {
  const calls: unknown[] = [];
  const tool: TestTool = {
    name: "ls_test_read",
    description: "test read tool",
    authorityClass: "read",
    annotations: { destructiveHint: false },
    inputSchema: { shape: {} },
    calls,
    handler: async (input) => {
      calls.push(input);
      return { ok: true, data: { ok: true, echoed: input } };
    },
    ...overrides,
  };
  return tool;
}

describe("createToolHandler -- registration wrapper", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    _resetGuardrailsForTest();
    _resetAuditBufferForTest();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    _resetGuardrailsForTest();
    _resetAuditBufferForTest();
  });

  describe("happy path", () => {
    it("invokes the handler and returns its JSON payload as text content", async () => {
      const tool = makeTool();
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ name: "Pro Plan" });
      assert.equal(result.isError, undefined);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0]?.type, "text");
      const parsed = JSON.parse(result.content[0]?.text ?? "");
      assert.deepEqual(parsed, { ok: true, echoed: { name: "Pro Plan" } });
      assert.equal(tool.calls.length, 1);
    });

    it("preserves the strict input type through createToolHandler<TInput>", async () => {
      // Compile-time check on the input contract. The thing that breaks
      // this test is REMOVAL of the generic parameter from
      // `RegisterableTool` (the `<CheckoutInput>` application would then
      // be a TS error: "Type RegisterableTool is not generic"). Widening
      // the internal input slot to `any` does NOT break this test --
      // `RegisterableTool<CheckoutInput>` would still type-check.
      // Return-shape strictness is covered by the @ts-expect-error
      // canaries in the "return-shape strictness" describe block below.
      type CheckoutInput = { storeId: string; variantId: string };
      const tool: RegisterableTool<CheckoutInput> = {
        name: "ls_create_checkout",
        description: "test",
        authorityClass: "mutate",
        annotations: { destructiveHint: false },
        inputSchema: { shape: {} },
        handler: async (input) => {
          // The handler sees the strict shape -- no cast needed.
          return { ok: true, data: { storeId: input.storeId, variantId: input.variantId } };
        },
      };
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ storeId: "1", variantId: "2" });
      assert.equal(result.isError, undefined);
    });

    it("returns isError:true when the handler returns ok:false", async () => {
      const tool = makeTool({
        handler: async () => ({ ok: false, error: "boom" }),
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({});
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /Error: boom/);
    });

    it("surfaces unexpected handler exceptions as isError:true", async () => {
      const tool = makeTool({
        handler: async () => {
          throw new Error("unexpected");
        },
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({});
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /Error: unexpected/);
    });

    it("returns isError when input is not an object (defensive contract check)", async () => {
      // The MCP SDK normally pre-validates against the Zod schema, so a
      // non-object input never reaches the wrapper in production. If
      // that contract ever changes, the casts inside createToolHandler
      // would silently misbehave -- so the wrapper has a fast-fail
      // defensive check. Cast through `unknown` to bypass the compile-
      // time `TInput = unknown` constraint and simulate the contract
      // violation.
      const tool = makeTool();
      const wrapped = createToolHandler(tool);

      for (const bad of [null, "not-an-object", 42, true, undefined]) {
        const result = await (wrapped as (input: unknown) => Promise<McpToolResult>)(bad);
        assert.equal(result.isError, true, `expected isError for ${JSON.stringify(bad)}`);
        assert.match(
          result.content[0]?.text ?? "",
          /expected an object input/,
          `expected contract-error message for ${JSON.stringify(bad)}`,
        );
        // Handler must not run for a malformed contract violation.
        assert.equal(tool.calls.length, 0);
      }
    });

    it("emits a stderr log line for the contract violation at LEMONSQUEEZY_LOG=error", async () => {
      // The defensive-check path calls logEvent({status: "exception", ...}).
      // Operators running with LEMONSQUEEZY_LOG=error rely on stderr to
      // notice the violation -- without this assertion, a refactor that
      // dropped the logEvent call would silently swallow the signal.
      process.env.LEMONSQUEEZY_LOG = "error";
      const lines: string[] = [];
      // biome-ignore lint/suspicious/noExplicitAny: minimal stderr stub
      const originalWrite = process.stderr.write.bind(process.stderr) as any;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
        // biome-ignore lint/suspicious/noExplicitAny: matches the stubbed type
      }) as any;
      try {
        const tool = makeTool({ name: "ls_test_contract" });
        const wrapped = createToolHandler(tool);
        await (wrapped as (input: unknown) => Promise<McpToolResult>)("not-an-object");
      } finally {
        process.stderr.write = originalWrite;
      }
      const matching = lines.filter((l) => l.includes("ls_test_contract"));
      assert.equal(matching.length, 1, "exactly one log line should be emitted for the contract violation");
      const parsed = JSON.parse(matching[0]?.trim() ?? "");
      assert.equal(parsed.event, "tool_call");
      assert.equal(parsed.tool, "ls_test_contract");
      assert.equal(parsed.status, "exception");
      assert.match(parsed.error, /expected an object input/);
    });
  });

  describe("return-shape strictness (compile-time canaries)", () => {
    // The `@ts-expect-error` directives below assert that the listed
    // handler signatures do NOT type-check. If a future refactor
    // widens the return slot to `Promise<unknown>` or `Promise<any>`,
    // these would start type-checking, the directives would become
    // unused, and TS would report "Unused @ts-expect-error directive"
    // as an error -- so the canary fires in either direction.
    //
    // These tests have no runtime assertions; they exist for the
    // compile-time check on the `RegisterableTool` declaration. The
    // `assert.ok(_bad)` lines just keep the runtime path well-formed.

    it("rejects a handler that omits the required `ok` field", () => {
      const _bad: RegisterableTool = {
        name: "ls_bad",
        description: "x",
        authorityClass: "read",
        annotations: { destructiveHint: false },
        inputSchema: { shape: {} },
        // @ts-expect-error -- return is missing required `ok` field
        handler: async () => ({ data: 1 }),
      };
      assert.ok(_bad);
    });

    it("rejects a handler whose `ok` is the wrong type", () => {
      const _bad: RegisterableTool = {
        name: "ls_bad",
        description: "x",
        authorityClass: "read",
        annotations: { destructiveHint: false },
        inputSchema: { shape: {} },
        // @ts-expect-error -- `ok` typed as number instead of boolean
        handler: async () => ({ ok: 1, data: null }),
      };
      assert.ok(_bad);
    });

    it("rejects a handler that returns void (accidental missing return)", () => {
      const _bad: RegisterableTool = {
        name: "ls_bad",
        description: "x",
        authorityClass: "read",
        annotations: { destructiveHint: false },
        inputSchema: { shape: {} },
        // @ts-expect-error -- async function returning void is Promise<void>, not Promise<ToolHandlerResponse>
        handler: async () => {
          /* no return */
        },
      };
      assert.ok(_bad);
    });
  });

  describe("authority-class disable", () => {
    it("rejects a tool whose class is in LEMONSQUEEZY_DISABLE_CLASSES", async () => {
      process.env.LEMONSQUEEZY_DISABLE_CLASSES = "money,recurring";
      const tool = makeTool({
        name: "ls_refund_order",
        authorityClass: "money",
        annotations: { destructiveHint: true },
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ orderId: "1", amount: 100 });
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /authority class.*disabled/i);
      assert.equal(tool.calls.length, 0, "handler must not run when the class is disabled");
    });

    it("permits a tool whose class is NOT in LEMONSQUEEZY_DISABLE_CLASSES", async () => {
      process.env.LEMONSQUEEZY_DISABLE_CLASSES = "money";
      const tool = makeTool({ authorityClass: "read" });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({});
      assert.equal(result.isError, undefined);
      assert.equal(tool.calls.length, 1);
    });
  });

  describe("authority-class rate limit", () => {
    it("rejects the N+1th call within the window", async () => {
      process.env.LEMONSQUEEZY_RATE_LIMIT_PER_CLASS = "money:2/h";
      const tool = makeTool({
        authorityClass: "money",
        annotations: { destructiveHint: true },
      });
      const wrapped = createToolHandler(tool);

      const r1 = await wrapped({});
      const r2 = await wrapped({});
      const r3 = await wrapped({});
      assert.equal(r1.isError, undefined);
      assert.equal(r2.isError, undefined);
      assert.equal(r3.isError, true);
      assert.match(r3.content[0]?.text ?? "", /Class.*rate limit exceeded/i);
      assert.equal(tool.calls.length, 2, "third call should not reach the handler");
    });

    it("isolates per-class buckets -- exhausting `money` does not block `recurring`", async () => {
      // The classTimestamps state is a Map keyed by class. A regression
      // that collapsed it to a single shared array (or a buggy
      // .set(cls, list) write) would let one class consume another's
      // budget. Real-world risk: a refund storm should never starve a
      // legitimate subscription update.
      process.env.LEMONSQUEEZY_RATE_LIMIT_PER_CLASS = "money:2/h,recurring:5/h";
      const refund = makeTool({
        name: "ls_refund_order",
        authorityClass: "money",
        annotations: { destructiveHint: true },
      });
      const updateSub = makeTool({
        name: "ls_update_subscription",
        authorityClass: "recurring",
        annotations: { destructiveHint: true },
      });
      const wrapRefund = createToolHandler(refund);
      const wrapUpdate = createToolHandler(updateSub);

      // Exhaust the money bucket.
      assert.equal((await wrapRefund({})).isError, undefined);
      assert.equal((await wrapRefund({})).isError, undefined);
      const blockedRefund = await wrapRefund({});
      assert.equal(blockedRefund.isError, true);
      assert.match(blockedRefund.content[0]?.text ?? "", /Class.*rate limit exceeded/i);

      // `recurring` is unaffected -- five calls should all succeed.
      for (let i = 0; i < 5; i++) {
        const r = await wrapUpdate({});
        assert.equal(r.isError, undefined, `recurring call ${i + 1} should not be blocked by money's exhaustion`);
      }
      // The 6th `recurring` call hits its own limit.
      const blockedUpdate = await wrapUpdate({});
      assert.equal(blockedUpdate.isError, true);
      assert.match(blockedUpdate.content[0]?.text ?? "", /Class.*rate limit exceeded/i);

      assert.equal(refund.calls.length, 2);
      assert.equal(updateSub.calls.length, 5);
    });
  });

  describe("destructive rate limit", () => {
    it("fires for destructive tools and ignores non-destructive ones", async () => {
      process.env.LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT = "2";
      const destructive = makeTool({
        name: "ls_refund_order",
        authorityClass: "money",
        annotations: { destructiveHint: true },
      });
      const readTool = makeTool();
      const wrapDestructive = createToolHandler(destructive);
      const wrapRead = createToolHandler(readTool);

      // Reads do not consume the destructive bucket.
      for (let i = 0; i < 5; i++) {
        const r = await wrapRead({});
        assert.equal(r.isError, undefined);
      }

      assert.equal((await wrapDestructive({})).isError, undefined);
      assert.equal((await wrapDestructive({})).isError, undefined);
      const blocked = await wrapDestructive({});
      assert.equal(blocked.isError, true);
      assert.match(blocked.content[0]?.text ?? "", /Destructive call rate limit/);
    });

    it("does not consume the destructive bucket when a class-disable rejects first", async () => {
      process.env.LEMONSQUEEZY_DISABLE_CLASSES = "money";
      process.env.LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT = "1";
      const destructive = makeTool({
        authorityClass: "money",
        annotations: { destructiveHint: true },
      });
      const wrapped = createToolHandler(destructive);

      // Two attempts that hit the class-disable gate must NOT exhaust the
      // 1-call destructive bucket; a later non-disabled destructive call
      // should still go through.
      const r1 = await wrapped({});
      const r2 = await wrapped({});
      assert.equal(r1.isError, true);
      assert.equal(r2.isError, true);

      // Now drop the disable and confirm the destructive bucket is intact.
      delete process.env.LEMONSQUEEZY_DISABLE_CLASSES;
      _resetGuardrailsForTest();
      const r3 = await wrapped({});
      assert.equal(r3.isError, undefined);
    });
  });

  describe("preflight guardrail (refund-cap shape)", () => {
    // Mirrors ls_refund_order: a per-tool, input-dependent guardrail that must
    // reject BEFORE the rate limiters record a timestamp. When the cap check
    // lived only inside the handler it ran after both limiters, so a client
    // looping on an over-cap amount burned its whole money:N/h allowance on
    // calls that never left the process.
    function makeRefundTool(capCents: number) {
      return makeTool({
        name: "ls_refund_order",
        authorityClass: "money",
        annotations: { destructiveHint: true },
        preflight: (input) => {
          const amount = input.amount as number;
          if (amount > capCents) {
            throw new GuardrailError(`Refund amount ${amount} cents exceeds LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS`);
          }
        },
      });
    }

    it("rejects before the handler runs", async () => {
      const tool = makeRefundTool(10_000);
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ orderId: "1", amount: 10_001 });
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /exceeds LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS/);
      assert.equal(tool.calls.length, 0);
    });

    it("does NOT consume the destructive rate-limit bucket when it rejects", async () => {
      process.env.LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT = "1";
      const tool = makeRefundTool(10_000);
      const wrapped = createToolHandler(tool);

      // Three rejected over-cap attempts must cost nothing.
      for (let i = 0; i < 3; i++) {
        const blocked = await wrapped({ orderId: "1", amount: 10_001 });
        assert.equal(blocked.isError, true);
      }

      // The single-call destructive budget is still intact.
      const allowed = await wrapped({ orderId: "1", amount: 500 });
      assert.equal(allowed.isError, undefined, "an in-cap refund must still be allowed after rejected attempts");
      assert.equal(tool.calls.length, 1);
    });

    it("does NOT consume the per-class rate-limit bucket when it rejects", async () => {
      process.env.LEMONSQUEEZY_RATE_LIMIT_PER_CLASS = "money:2/h";
      const tool = makeRefundTool(10_000);
      const wrapped = createToolHandler(tool);

      for (let i = 0; i < 5; i++) {
        assert.equal((await wrapped({ orderId: "1", amount: 99_999 })).isError, true);
      }

      // money:2/h is untouched -- two real refunds still go through.
      assert.equal((await wrapped({ orderId: "1", amount: 100 })).isError, undefined);
      assert.equal((await wrapped({ orderId: "2", amount: 100 })).isError, undefined);
      const third = await wrapped({ orderId: "3", amount: 100 });
      assert.equal(third.isError, true);
      assert.match(third.content[0]?.text ?? "", /Class.*rate limit exceeded/i);
    });

    it("still runs AFTER the class-disable gate", async () => {
      // A disabled class must not leak a cap-specific error message; the
      // class rejection is the more general one and comes first.
      process.env.LEMONSQUEEZY_DISABLE_CLASSES = "money";
      const tool = makeRefundTool(10_000);
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ orderId: "1", amount: 10_001 });
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /authority class.*disabled/i);
    });

    it("records the rejection in the audit ring as a guardrail_block", async () => {
      const tool = makeRefundTool(10_000);
      const wrapped = createToolHandler(tool);
      await wrapped({ orderId: "1", amount: 10_001 });
      const entries = readAuditEntries();
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.status, "guardrail_block");
      assert.equal(entries[0]?.audit, true);
    });
  });

  describe("error classification", () => {
    // Three failure causes must be distinguishable in the log/audit stream:
    // operator policy refused it, the client sent a bad request, or something
    // faulted. Collapsing the middle one into `exception` (the old behaviour
    // for every empty-PATCH guard) buries client mistakes in the same bucket
    // an operator scans for real faults.
    const cases = [
      { label: "GuardrailError", err: () => new GuardrailError("policy says no"), status: "guardrail_block" },
      { label: "ToolInputError", err: () => new ToolInputError("nothing to change"), status: "validation_error" },
      { label: "plain Error", err: () => new Error("upstream 502"), status: "exception" },
    ] as const;

    for (const { label, err, status } of cases) {
      it(`a handler throwing ${label} is audited as ${status}`, async () => {
        const tool = makeTool({
          name: "ls_update_license_key",
          authorityClass: "key",
          annotations: { destructiveHint: true },
          handler: async () => {
            throw err();
          },
        });
        const wrapped = createToolHandler(tool);
        const result = await wrapped({ licenseKeyId: "1" });
        assert.equal(result.isError, true);
        const entries = readAuditEntries();
        assert.equal(entries.length, 1);
        assert.equal(entries[0]?.status, status);
      });
    }

    it("a validation_error still counts as an error entry at LEMONSQUEEZY_LOG=error", async () => {
      // The new status tag must be in logger's ERROR_STATUS_TAGS, otherwise
      // adding the classification would silently DROP these lines for anyone
      // running at the error level -- strictly worse than the old behaviour.
      process.env.LEMONSQUEEZY_LOG = "error";
      const lines: string[] = [];
      // biome-ignore lint/suspicious/noExplicitAny: minimal stderr stub
      const originalWrite = process.stderr.write.bind(process.stderr) as any;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
        // biome-ignore lint/suspicious/noExplicitAny: matches the stubbed type
      }) as any;
      try {
        const tool = makeTool({
          name: "ls_update_customer",
          authorityClass: "pii",
          annotations: { destructiveHint: false },
          handler: async () => {
            throw new ToolInputError("nothing to change");
          },
        });
        await createToolHandler(tool)({ customerId: "1" });
      } finally {
        process.stderr.write = originalWrite;
      }
      const matching = lines.filter((l) => l.includes("ls_update_customer"));
      assert.equal(matching.length, 1, "validation_error must still be emitted at LOG=error");
      assert.equal(JSON.parse(matching[0]?.trim() ?? "").status, "validation_error");
    });
  });

  describe("isDestructive predicate faults", () => {
    it("a throwing predicate does not escape, and the call is treated as destructive", async () => {
      // The predicate is evaluated outside the main try (it must stay in
      // scope for the catch branch), so a throw there would surface as an
      // unhandled rejection and destabilize the stdio server. It gets its own
      // guard that fails CLOSED -- the call engages the destructive limiter
      // and the audit ring rather than slipping past both.
      process.env.LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT = "1";
      const tool = makeTool({
        name: "ls_update_license_key",
        authorityClass: "key",
        annotations: { destructiveHint: false },
        isDestructive: () => {
          throw new Error("predicate blew up");
        },
      });
      const wrapped = createToolHandler(tool);

      const first = await wrapped({ licenseKeyId: "1" });
      assert.equal(first.isError, undefined, "the call itself must still complete");
      assert.equal(tool.calls.length, 1);

      // Fail-closed: it was counted as destructive, so the 1-call budget is spent.
      const second = await wrapped({ licenseKeyId: "2" });
      assert.equal(second.isError, true);
      assert.match(second.content[0]?.text ?? "", /Destructive call rate limit/);

      // ...and it was audited.
      const entries = readAuditEntries();
      assert.equal(entries.length, 2);
      assert.equal(entries[1]?.tool, "ls_update_license_key");
      assert.equal(entries[1]?.audit, true);
    });
  });

  describe("store allowlist", () => {
    it("rejects a call that omits storeId when the allowlist is set", async () => {
      process.env.LEMONSQUEEZY_ALLOWED_STORE_IDS = "111";
      const tool = makeTool({
        name: "ls_list_subscriptions",
        authorityClass: "read",
        inputSchema: { shape: { storeId: z.string().optional() } },
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({});
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /storeId is required/);
      assert.equal(tool.calls.length, 0);
    });

    it("rejects a non-allowed storeId", async () => {
      process.env.LEMONSQUEEZY_ALLOWED_STORE_IDS = "111";
      const tool = makeTool({
        inputSchema: { shape: { storeId: z.string() } },
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ storeId: "999" });
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /not in LEMONSQUEEZY_ALLOWED_STORE_IDS/);
    });

    it("rejects a list-by-parent tool with no parent filter present", async () => {
      process.env.LEMONSQUEEZY_ALLOWED_STORE_IDS = "111";
      const tool = makeTool({
        name: "ls_list_prices",
        authorityClass: "read",
        inputSchema: { shape: { variantId: z.string().optional() } },
        requiredFilters: ["variantId"],
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({});
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /At least one of \[variantId\]/);
    });
  });

  describe("audit pipeline -- destructive calls", () => {
    it("writes a success entry with redacted inputs to the audit ring", async () => {
      const tool = makeTool({
        name: "ls_create_webhook",
        authorityClass: "webhook",
        annotations: { destructiveHint: true },
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ url: "https://example.com/hook", secret: "shhhh-do-not-log" });
      assert.equal(result.isError, undefined);

      const entries = readAuditEntries();
      assert.equal(entries.length, 1);
      const audit = entries[0];
      assert.ok(audit);
      assert.equal(audit.tool, "ls_create_webhook");
      assert.equal(audit.status, "ok");
      assert.equal(audit.audit, true);
      assert.ok(audit.ts, "audit entry must carry a timestamp");
      const inputs = audit.inputs as { url: string; secret: string };
      assert.equal(inputs.url, "https://example.com/hook");
      assert.equal(inputs.secret, "[REDACTED]", "secret-shaped keys must be masked before reaching the buffer");
    });

    it("writes a guardrail_block entry when the guardrail rejects", async () => {
      process.env.LEMONSQUEEZY_DISABLE_CLASSES = "money";
      const tool = makeTool({
        name: "ls_refund_order",
        authorityClass: "money",
        annotations: { destructiveHint: true },
      });
      const wrapped = createToolHandler(tool);
      await wrapped({ orderId: "1", amount: 5_000 });

      const entries = readAuditEntries();
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.status, "guardrail_block");
      assert.equal(entries[0]?.audit, true);
      assert.match(entries[0]?.error ?? "", /authority class.*disabled/i);
    });

    it("does NOT write an audit entry for a non-destructive call", async () => {
      const tool = makeTool({ authorityClass: "read", annotations: { destructiveHint: false } });
      const wrapped = createToolHandler(tool);
      await wrapped({});
      assert.equal(readAuditEntries().length, 0);
    });

    it("predicate-destructive call (ls_update_license_key shape) lands in the audit ring", async () => {
      // Mirrors ls_update_license_key as shipped: static destructiveHint:true
      // (what MCP clients see) plus a predicate that decides per call. The
      // wrapper must consult the predicate, not the static annotation: the
      // benign call stays out of the audit ring even though the hint is true.
      const tool = makeTool({
        name: "ls_update_license_key",
        authorityClass: "key",
        annotations: { destructiveHint: true },
        isDestructive: (input) =>
          input.disabled === true || input.activationLimit !== undefined || input.expiresAt !== undefined,
      });
      const wrapped = createToolHandler(tool);

      const benign = await wrapped({ licenseKeyId: "1", disabled: false });
      assert.equal(benign.isError, undefined);
      assert.equal(readAuditEntries().length, 0, "benign edit does not produce an audit entry");

      const destructive = await wrapped({ licenseKeyId: "1", activationLimit: 3 });
      assert.equal(destructive.isError, undefined);
      assert.equal(readAuditEntries().length, 1, "activationLimit change must produce an audit entry");
      assert.equal(readAuditEntries()[0]?.tool, "ls_update_license_key");
    });

    it("a benign call to a static-true predicate tool is not stopped by DESTRUCTIVE_RATE_LIMIT=0", async () => {
      // The 1.0 flip of the four predicate tools to destructiveHint:true is
      // for MCP clients only. If the static hint leaked into the wrapper's
      // verdict, the kill switch would also block every benign edit (a
      // re-enable, a rename, a URL change) on those tools.
      process.env.LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT = "0";
      const tool = makeTool({
        name: "ls_update_license_key",
        authorityClass: "key",
        annotations: { destructiveHint: true },
        isDestructive: (input) =>
          input.disabled === true || input.activationLimit !== undefined || input.expiresAt !== undefined,
      });
      const wrapped = createToolHandler(tool);

      const benign = await wrapped({ licenseKeyId: "1", disabled: false });
      assert.equal(benign.isError, undefined, "benign call must pass the destructive limiter");
      assert.equal(tool.calls.length, 1);

      const destructive = await wrapped({ licenseKeyId: "1", disabled: true });
      assert.equal(destructive.isError, true, "destructive call must hit the limiter");
      assert.match(destructive.content[0]?.text ?? "", /Destructive call rate limit exceeded/);
      assert.equal(tool.calls.length, 1, "the blocked call never reached the handler");
    });

    it("predicate-destructive call that throws still produces an audit entry tagged audit:true", async () => {
      // The audit invariant: a destructive call whose handler throws
      // must land in the ring AS an exception entry. Real-world risk:
      // a refund or license-key revoke that errors out partway must
      // still be visible to an operator scanning the audit log. The
      // `isDestructive` flag is computed BEFORE the try block, so it
      // is in scope inside the catch -- this test guards against a
      // refactor that moves the predicate inside try/catch and loses
      // the destructive routing on the error path.
      const tool = makeTool({
        name: "ls_update_license_key",
        authorityClass: "key",
        annotations: { destructiveHint: true },
        isDestructive: (input) =>
          input.disabled === true || input.activationLimit !== undefined || input.expiresAt !== undefined,
        handler: async () => {
          throw new Error("upstream 502");
        },
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ licenseKeyId: "1", activationLimit: 3 });
      assert.equal(result.isError, true);

      const entries = readAuditEntries();
      assert.equal(entries.length, 1, "exception on destructive call must be audited");
      assert.equal(entries[0]?.status, "exception");
      assert.equal(entries[0]?.audit, true);
      assert.match(entries[0]?.error ?? "", /upstream 502/);
      // Inputs are redacted; the destructive routing preserved them in the entry.
      const inputs = entries[0]?.inputs as { licenseKeyId: string; activationLimit: number };
      assert.equal(inputs.licenseKeyId, "1");
      assert.equal(inputs.activationLimit, 3);
    });

    it("destructive handler returning ok:false produces an audit entry with status 'error'", async () => {
      // Distinct from `exception` (handler threw) and `ok` (handler
      // returned ok:true). The audit-log scanner needs to tell these
      // three states apart: a refund that the API rejected (ok:false)
      // is operationally different from one that crashed mid-flight
      // (exception) or one that succeeded (ok).
      const tool = makeTool({
        name: "ls_refund_order",
        authorityClass: "money",
        annotations: { destructiveHint: true },
        handler: async () => ({ ok: false, error: "Refund window closed", requestId: "req_abc" }),
      });
      const wrapped = createToolHandler(tool);
      const result = await wrapped({ orderId: "42", amount: 100 });
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /Refund window closed/);

      const entries = readAuditEntries();
      assert.equal(entries.length, 1);
      assert.equal(
        entries[0]?.status,
        "error",
        "ok:false from destructive handler must surface as audit status='error'",
      );
      assert.equal(entries[0]?.audit, true);
      assert.equal(entries[0]?.error, "Refund window closed");
      assert.equal(entries[0]?.request_id, "req_abc");
    });
  });

  // Issue #40. ls_deactivate_license is destructive on every call, so its
  // input -- which carries the raw license key, a bearer credential for the
  // License API -- flows into all three audit sinks: the stderr tool_call
  // line, the audit ring, and the lemonsqueezy://audit-log resource that
  // serializes the ring. Flipping it to destructiveHint:true is only safe
  // because redactSecrets masks `licenseKey` by name. These cases drive the
  // REAL tool object through the wrapper on every outcome the wrapper
  // distinguishes and check each sink for the raw key. Every case also
  // asserts the MASKED value is present, so none can pass by dropping
  // `inputs` altogether. licenseRequest never loads the API key, so no key
  // env is needed.
  describe("ls_deactivate_license end to end -- license key never reaches an audit sink", () => {
    const KEY = "38b1460a-5104-4067-a91d-77b872934d51";
    const INPUT = { licenseKey: KEY, instanceId: "inst-1" };
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    let stderrLines: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: minimal stderr stub
    let originalWrite: any;

    // Same cast as priceTool() above: licenseTools is `as const`.
    function deactivateTool(): RegisterableTool<Record<string, unknown>> {
      const tool = licenseTools.find((t) => t.name === "ls_deactivate_license");
      if (!tool) throw new Error("ls_deactivate_license not found");
      return tool as unknown as RegisterableTool<Record<string, unknown>>;
    }

    function mockFetch(respond: () => Response) {
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return respond();
      }) as typeof fetch;
    }

    function stderrToolCalls(): Record<string, unknown>[] {
      return stderrLines
        .flatMap((chunk) => chunk.split("\n"))
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => entry.event === "tool_call");
    }

    // One audited call, with the key masked (not dropped) and instanceId
    // intact in every sink, and the raw key in none of them.
    function assertMaskedInEverySink(status: string) {
      const expectedInputs = { licenseKey: maskLicenseKey(KEY), instanceId: "inst-1" };
      assert.notEqual(
        expectedInputs.licenseKey,
        "[REDACTED]",
        "precondition: a UUID key is long enough to fingerprint",
      );

      const entries = readAuditEntries();
      assert.equal(entries.length, 1, "exactly one audit entry per call");
      assert.equal(entries[0]?.tool, "ls_deactivate_license");
      assert.equal(entries[0]?.status, status);
      assert.equal(entries[0]?.audit, true);
      assert.deepEqual(entries[0]?.inputs, expectedInputs);

      const resourceText = readAuditLogResource(new URL("lemonsqueezy://audit-log")).contents[0]?.text ?? "";
      assert.deepEqual(JSON.parse(resourceText).inputs, expectedInputs);

      const toolCalls = stderrToolCalls();
      assert.equal(toolCalls.length, 1, "exactly one tool_call line on stderr");
      assert.equal(toolCalls[0]?.status, status);
      assert.equal(toolCalls[0]?.audit, true);
      assert.deepEqual(toolCalls[0]?.inputs, expectedInputs);

      assert.ok(!JSON.stringify(readAuditEntries()).includes(KEY), "raw key in the audit ring");
      assert.ok(!resourceText.includes(KEY), "raw key in the audit-log resource");
      assert.ok(!stderrLines.join("").includes(KEY), "raw key on stderr");
    }

    beforeEach(() => {
      // Runs after the outer beforeEach, which cleared every ENV_KEYS entry.
      fetchCalls = 0;
      stderrLines = [];
      process.env.LEMONSQUEEZY_LOG = "all";
      originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
        // biome-ignore lint/suspicious/noExplicitAny: matches the stubbed type
      }) as any;
    });

    afterEach(() => {
      process.stderr.write = originalWrite;
      globalThis.fetch = originalFetch;
    });

    it("the shipped tool is destructive on every call, with no predicate", () => {
      const tool = deactivateTool();
      assert.equal(tool.annotations.destructiveHint, true);
      assert.equal(tool.isDestructive, undefined);
    });

    it("200: audited as ok", async () => {
      mockFetch(
        () =>
          new Response(JSON.stringify({ deactivated: true, license_key: { key: KEY } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
      const result = await createToolHandler(deactivateTool())(INPUT);
      assert.equal(result.isError, undefined);
      assert.equal(fetchCalls, 1);
      // The upstream response echoes the key back, so it IS in the client's
      // result text -- to the client that just sent it. Only the audit sinks
      // are required to be clean.
      assertMaskedInEverySink("ok");
    });

    it("404: audited as error", async () => {
      mockFetch(
        () =>
          new Response(JSON.stringify({ deactivated: false, error: "license_key not found." }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
      );
      const result = await createToolHandler(deactivateTool())(INPUT);
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /license_key not found/);
      assertMaskedInEverySink("error");
    });

    it("fetch throws: audited as exception", async () => {
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new TypeError("fetch failed");
      }) as typeof fetch;
      const result = await createToolHandler(deactivateTool())(INPUT);
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /fetch failed/);
      assert.equal(fetchCalls, 1, "a License API POST is not retried on a network error");
      assertMaskedInEverySink("exception");
    });

    it("LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT=0 blocks it before any HTTP call (the #40 repro)", async () => {
      process.env.LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT = "0";
      mockFetch(() => new Response(JSON.stringify({ deactivated: true }), { status: 200 }));
      const result = await createToolHandler(deactivateTool())(INPUT);
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /Destructive call rate limit exceeded \(0\/min\)/);
      assert.equal(fetchCalls, 0, "the kill switch must stop the call before it reaches the License API");
      assertMaskedInEverySink("guardrail_block");
    });

    it("LEMONSQUEEZY_LOG=audit: a successful call emits exactly one line, the audited tool_call", async () => {
      // The half of #40 its reporter could not verify. At `audit` the
      // successful http_call line is filtered out, so the audited tool_call
      // line is the only thing on stderr.
      process.env.LEMONSQUEEZY_LOG = "audit";
      mockFetch(() => new Response(JSON.stringify({ deactivated: true }), { status: 200 }));
      const result = await createToolHandler(deactivateTool())(INPUT);
      assert.equal(result.isError, undefined);
      assert.equal(stderrLines.length, 1, `expected exactly one stderr line, got: ${stderrLines.join("")}`);
      assertMaskedInEverySink("ok");
    });
  });

  // Everything above drives a synthetic tool whose handler returns a literal,
  // so the only thing the assertions can see is a value the test itself put
  // there. Production never does that: `index.ts` registers the REAL tool
  // objects, and what the agent receives is the success branch's
  // `JSON.stringify(response.data ?? { success: true }, null, 2)`.
  //
  // That leaves a field the handler DERIVES -- `effective_unit_price`, added
  // response-side by `withEffectivePrice` -- with no test on the production
  // path. `tools/handlers.test.ts` asserts it on the raw handler return, this
  // file never mentions it, and tsc cannot see it either (the annotation
  // wrapper is deliberately type-transparent). So dropping it between the
  // handler and the client -- unwrapping the tool, or a stringify replacer
  // that skipped the added keys -- would leave every gate green while the
  // agent got back a `unit_price` that is confidently wrong.
  //
  // These tests close that path: real tool -> guardrails -> handler ->
  // audit -> serialize -> JSON.parse of the text the client receives.
  describe("real price tools end to end -- serialized MCP payload", () => {
    // secret.ts prefers LEMONSQUEEZY_API_KEY_COMMAND, then
    // LEMONSQUEEZY_TEST_API_KEY, then LEMONSQUEEZY_API_KEY. Clearing all three
    // is what keeps a developer's (or CI's) real key out of the run; restoring
    // them is what keeps this block from leaking into the sibling tests.
    const KEY_ENV = ["LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_TEST_API_KEY", "LEMONSQUEEZY_API_KEY_COMMAND"] as const;
    const originalFetch = globalThis.fetch;
    let keyEnvSnapshot: Record<string, string | undefined>;
    let fetchCalls = 0;

    function mockFetch(body: unknown) {
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/vnd.api+json" },
        });
      }) as typeof fetch;
    }

    // `priceTools` is `as const`, so `.find()` hands back a union of the two
    // literal tool types. `index.ts` absorbs the same union by declaring its
    // registration array as `RegisterableTool<any>[]`; this is the test-local
    // equivalent, and it keeps createToolHandler's inference off a union.
    function priceTool(name: string): RegisterableTool<Record<string, unknown>> {
      const tool = priceTools.find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} not found`);
      return tool as unknown as RegisterableTool<Record<string, unknown>>;
    }

    // A per-seat "volume" price: `unit_price` reads 2000 and is charged to
    // nobody, while tiers[0] holds the 10000 cents actually billed. Same
    // record as the one in tools/handlers.test.ts, so both files pin the
    // same payload from opposite ends of the wrapper.
    function tieredPriceResource() {
      return {
        type: "prices",
        id: "3",
        attributes: {
          scheme: "volume",
          unit_price: 2000,
          unit_price_decimal: null,
          tiers: [{ last_unit: "inf", unit_price: 10000, unit_price_decimal: null, fixed_fee: 0 }],
          package_size: 1,
        },
      };
    }

    function packagePriceResource() {
      return {
        type: "prices",
        id: "9",
        attributes: {
          scheme: "package",
          unit_price: 5000,
          unit_price_decimal: null,
          tiers: null,
          package_size: 5,
        },
      };
    }

    beforeEach(() => {
      keyEnvSnapshot = {};
      for (const k of KEY_ENV) {
        keyEnvSnapshot[k] = process.env[k];
        delete process.env[k];
      }
      process.env.LEMONSQUEEZY_API_KEY = "test-key-123";
      _resetApiKeyCacheForTest();
      fetchCalls = 0;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      for (const k of KEY_ENV) {
        const saved = keyEnvSnapshot[k];
        if (saved === undefined) delete process.env[k];
        else process.env[k] = saved;
      }
      _resetApiKeyCacheForTest();
    });

    it("ls_list_prices: effective_unit_price survives into the serialized MCP text", async () => {
      mockFetch({ data: [tieredPriceResource()], meta: { page: { currentPage: 1, lastPage: 1, total: 1 } } });
      const result = await createToolHandler(priceTool("ls_list_prices"))({ variantId: "7" });
      assert.equal(result.isError, undefined);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0]?.type, "text");

      // Assert on the TEXT, not only on the parse: the serialized string is
      // the whole of what crosses the wire, and it is what a replacer added
      // to the stringify call at wrapper.ts:235 would have to leave intact.
      // The `": 10000"` suffix keeps this off the `_note` key, which spells
      // the same prefix.
      const text = result.content[0]?.text ?? "";
      assert.ok(
        text.includes('"effective_unit_price": 10000'),
        `serialized payload must carry the charged price, got ${text}`,
      );

      const parsed = JSON.parse(text);
      const attrs = parsed.data[0].attributes;
      assert.equal(attrs.effective_unit_price, 10000);
      assert.equal(attrs.unit_price_is_not_charged, true);
      assert.ok(
        String(attrs.effective_unit_price_note).includes("tiers[0].unit_price (10000 cents)"),
        `note must name the source field, got ${String(attrs.effective_unit_price_note)}`,
      );
      // The annotation only ever ADDS keys, and the wrapper reshapes nothing:
      // the raw upstream fields and the pagination sibling arrive untouched.
      assert.equal(attrs.unit_price, 2000);
      assert.equal(attrs.scheme, "volume");
      assert.deepEqual(parsed.meta, { page: { currentPage: 1, lastPage: 1, total: 1 } });
      // A price read is non-destructive, so nothing reaches the audit ring.
      assert.equal(readAuditEntries().length, 0);
    });

    it("ls_get_price: the single-record get shape is annotated through the same path", async () => {
      // `{ data: {...} }` is a separate branch of annotatePricePayload from
      // the list's `{ data: [...] }`, and ls_get_price is wrapped separately
      // from ls_list_prices -- one test cannot cover both.
      mockFetch({ data: tieredPriceResource() });
      const result = await createToolHandler(priceTool("ls_get_price"))({ priceId: "3" });
      assert.equal(result.isError, undefined);

      const parsed = JSON.parse(result.content[0]?.text ?? "");
      assert.equal(parsed.data.type, "prices");
      assert.equal(parsed.data.id, "3");
      assert.equal(parsed.data.attributes.effective_unit_price, 10000);
      assert.equal(parsed.data.attributes.unit_price_is_not_charged, true);
      assert.equal(parsed.data.attributes.unit_price, 2000);
    });

    it("package pricing: the per-unit figure and unit_price_is_per_package survive too", async () => {
      // A different key family from the tiered branch. A regression that
      // dropped only `unit_price_is_per_package` would leave the two tests
      // above green while a $50-per-5-seats price still read as $50 a seat.
      mockFetch({ data: [packagePriceResource()] });
      const result = await createToolHandler(priceTool("ls_list_prices"))({ variantId: "7" });
      assert.equal(result.isError, undefined);

      const attrs = JSON.parse(result.content[0]?.text ?? "").data[0].attributes;
      assert.equal(attrs.effective_unit_price, 1000);
      assert.equal(attrs.unit_price_is_per_package, true);
      assert.ok(
        !("unit_price_is_not_charged" in attrs),
        "package unit_price IS charged -- flagging it as not charged would be the expensive lie",
      );
      assert.ok(String(attrs.effective_unit_price_note).includes("per package of 5 unit(s)"));
      assert.equal(attrs.unit_price, 5000);
    });

    it("the store-allowlist gate fires on the REAL tool, before any HTTP call", async () => {
      // `requiredFilters` lives on the shipped tool object, so this is the
      // assertion a synthetic stand-in cannot make: that ls_list_prices still
      // declares `variantId`, and that the wrapper rejects ahead of the
      // handler rather than after a round trip to the API.
      process.env.LEMONSQUEEZY_ALLOWED_STORE_IDS = "111";
      mockFetch({ data: [] });
      const result = await createToolHandler(priceTool("ls_list_prices"))({});
      assert.equal(result.isError, true);
      assert.match(result.content[0]?.text ?? "", /At least one of \[variantId\]/);
      assert.equal(fetchCalls, 0, "a guardrail-blocked call must never reach the API");
    });
  });
});

describe("readAuditLogResource -- audit-log MCP Resource", () => {
  beforeEach(() => {
    _resetAuditBufferForTest();
  });
  afterEach(() => {
    _resetAuditBufferForTest();
  });

  it("returns application/x-ndjson with most-recent-first ordering", async () => {
    const tool = makeTool({
      name: "ls_refund_order",
      authorityClass: "money",
      annotations: { destructiveHint: true },
    });
    const wrapped = createToolHandler(tool);
    await wrapped({ orderId: "1", amount: 100 });
    await wrapped({ orderId: "2", amount: 200 });
    await wrapped({ orderId: "3", amount: 300 });

    const out = readAuditLogResource(new URL("lemonsqueezy://audit-log"));
    assert.equal(out.contents.length, 1);
    const content = out.contents[0];
    assert.ok(content);
    assert.equal(content.uri, "lemonsqueezy://audit-log");
    assert.equal(content.mimeType, "application/x-ndjson");

    const lines = content.text.split("\n");
    assert.equal(lines.length, 3);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed[0].inputs.orderId, "3", "most-recent first");
    assert.equal(parsed[1].inputs.orderId, "2");
    assert.equal(parsed[2].inputs.orderId, "1");
    // Each line is a self-contained JSON object (ndjson invariant).
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });

  it("returns an empty text body when the buffer is empty", () => {
    const out = readAuditLogResource(new URL("lemonsqueezy://audit-log"));
    assert.equal(out.contents.length, 1);
    assert.equal(out.contents[0]?.text, "");
    assert.equal(out.contents[0]?.mimeType, "application/x-ndjson");
  });

  it("preserves the requested URI verbatim", () => {
    const out = readAuditLogResource(new URL("lemonsqueezy://audit-log?since=5"));
    assert.equal(out.contents[0]?.uri, "lemonsqueezy://audit-log?since=5");
  });
});

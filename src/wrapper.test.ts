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
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { z } from "zod";
import { _resetAuditBufferForTest, readAuditEntries } from "./audit-buffer.js";
import { _resetGuardrailsForTest } from "./guardrails.js";
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
      // Mirrors ls_update_license_key: destructiveHint:false on the
      // annotation, predicate flips destructive when activationLimit
      // changes. The wrapper must consult the predicate, not the static
      // annotation, and route the call to the audit ring.
      const tool = makeTool({
        name: "ls_update_license_key",
        authorityClass: "key",
        annotations: { destructiveHint: false },
        isDestructive: (input) => input.activationLimit !== undefined || input.disabled === true,
      });
      const wrapped = createToolHandler(tool);

      const benign = await wrapped({ licenseKeyId: "1", expiresAt: "2027-01-01" });
      assert.equal(benign.isError, undefined);
      assert.equal(readAuditEntries().length, 0, "benign edit does not produce an audit entry");

      const destructive = await wrapped({ licenseKeyId: "1", activationLimit: 3 });
      assert.equal(destructive.isError, undefined);
      assert.equal(readAuditEntries().length, 1, "activationLimit change must produce an audit entry");
      assert.equal(readAuditEntries()[0]?.tool, "ls_update_license_key");
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
        annotations: { destructiveHint: false },
        isDestructive: (input) => input.activationLimit !== undefined,
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  describe("primitives pass through unchanged", () => {
    it("strings", () => {
      assert.equal(redactSecrets("hello"), "hello");
    });
    it("numbers", () => {
      assert.equal(redactSecrets(42), 42);
    });
    it("booleans", () => {
      assert.equal(redactSecrets(true), true);
      assert.equal(redactSecrets(false), false);
    });
    it("null", () => {
      assert.equal(redactSecrets(null), null);
    });
    it("undefined", () => {
      assert.equal(redactSecrets(undefined), undefined);
    });
  });

  describe("secret-named keys are redacted", () => {
    it("redacts lowercase `secret`", () => {
      assert.deepEqual(redactSecrets({ secret: "shhh" }), { secret: "[REDACTED]" });
    });
    it("redacts capital `Secret`", () => {
      assert.deepEqual(redactSecrets({ Secret: "shhh" }), { Secret: "[REDACTED]" });
    });
    it("redacts all api_key spellings", () => {
      assert.deepEqual(redactSecrets({ apiKey: "x" }), { apiKey: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ api_key: "x" }), { api_key: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ "api-key": "x" }), { "api-key": "[REDACTED]" });
      assert.deepEqual(redactSecrets({ APIKey: "x" }), { APIKey: "[REDACTED]" });
    });
    it("redacts password, token, bearer, authorization", () => {
      assert.deepEqual(redactSecrets({ password: "p" }), { password: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ token: "t" }), { token: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ bearer: "b" }), { bearer: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ Authorization: "a" }), { Authorization: "[REDACTED]" });
    });
    it("redacts signing_secret spellings", () => {
      assert.deepEqual(redactSecrets({ signingSecret: "x" }), { signingSecret: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ signing_secret: "x" }), { signing_secret: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ "signing-secret": "x" }), { "signing-secret": "[REDACTED]" });
    });
    it("redacts private_key spellings", () => {
      assert.deepEqual(redactSecrets({ privateKey: "x" }), { privateKey: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ private_key: "x" }), { private_key: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ "private-key": "x" }), { "private-key": "[REDACTED]" });
    });
    it("redacts PII-shaped key names (pin, ssn, credit_card, card_number, cvv, cvc)", () => {
      assert.deepEqual(redactSecrets({ pin: "1234" }), { pin: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ ssn: "111-22-3333" }), { ssn: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ socialSecurityNumber: "x" }), { socialSecurityNumber: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ social_security_number: "x" }), { social_security_number: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ creditCard: "x" }), { creditCard: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ credit_card: "x" }), { credit_card: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ cardNumber: "x" }), { cardNumber: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ card_number: "x" }), { card_number: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ cvv: "123" }), { cvv: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ cvc: "456" }), { cvc: "[REDACTED]" });
    });
  });

  describe("value-shape redaction (JWT-like strings)", () => {
    // A real-looking JWT: base64url(header).base64url(payload).base64url(signature)
    const sampleJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJpYXQiOjE2MDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    it("redacts a JWT-shaped value even under an innocuous key", () => {
      assert.deepEqual(redactSecrets({ customData: sampleJwt }), { customData: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ metadata: sampleJwt }), { metadata: "[REDACTED]" });
    });

    it("redacts JWT-shaped values nested in arrays and objects", () => {
      const input = {
        items: [{ value: sampleJwt }, { value: "not-a-token" }],
        nested: { credential: sampleJwt },
      };
      assert.deepEqual(redactSecrets(input), {
        items: [{ value: "[REDACTED]" }, { value: "not-a-token" }],
        nested: { credential: "[REDACTED]" },
      });
    });

    it("does NOT redact UUID-shaped license keys, hyphenated codes, or short opaque IDs", () => {
      const input = {
        licenseKey: "ABCD-EFGH-1234-5678",
        instanceId: "8e3a4f9d-1234-5678-9abc-def012345678",
        storeId: "12345",
        sku: "PRO-MONTHLY",
        couponCode: "SUMMER20",
      };
      assert.deepEqual(redactSecrets(input), input);
    });

    it("does NOT redact short eyJ-prefixed strings that aren't full JWTs", () => {
      // The JWT regex requires three base64url segments each at least 4 chars,
      // so a bare prefix or a two-segment value passes through unredacted.
      assert.deepEqual(redactSecrets({ note: "eyJ" }), { note: "eyJ" });
      assert.deepEqual(redactSecrets({ note: "eyJsomething" }), { note: "eyJsomething" });
      assert.deepEqual(redactSecrets({ note: "eyJfoo.bar" }), { note: "eyJfoo.bar" });
    });

    it("redacts a JWT-shaped string at the root (no wrapping object)", () => {
      // Production always wraps tool inputs in an object, but the value-
      // shape branch runs before the object/array branches in redactInner,
      // and the top-level case exercises depth=0 directly. Catches a
      // refactor that moved the string check below the object check.
      const sampleJwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJpYXQiOjE2MDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      assert.equal(redactSecrets(sampleJwt), "[REDACTED]");
    });
  });

  describe("ordinary identifiers are NOT redacted", () => {
    it("preserves licenseKey, instanceId, storeId, orderId, webhookId", () => {
      const input = {
        licenseKey: "lk_abc",
        instanceId: "inst_1",
        storeId: "store_1",
        orderId: "ord_1",
        webhookId: "wh_1",
      };
      assert.deepEqual(redactSecrets(input), input);
    });
    it("preserves keys that merely contain a secret substring", () => {
      // The regex is anchored, so `secretQuestion` (not exactly "secret")
      // is not matched. This is intentional: matching substrings would
      // accidentally redact business fields like `licenseKey`.
      assert.deepEqual(redactSecrets({ secretQuestion: "what?" }), { secretQuestion: "what?" });
      assert.deepEqual(redactSecrets({ tokenizer: "v1" }), { tokenizer: "v1" });
    });
  });

  describe("nested structures", () => {
    it("redacts a secret inside a nested object", () => {
      const input = { config: { password: "x", host: "y" } };
      assert.deepEqual(redactSecrets(input), {
        config: { password: "[REDACTED]", host: "y" },
      });
    });
    it("redacts secrets inside each object of an array", () => {
      const input = [
        { token: "t1", id: "a" },
        { token: "t2", id: "b" },
      ];
      assert.deepEqual(redactSecrets(input), [
        { token: "[REDACTED]", id: "a" },
        { token: "[REDACTED]", id: "b" },
      ]);
    });
    it("preserves array of primitives", () => {
      assert.deepEqual(redactSecrets([1, "two", null, true]), [1, "two", null, true]);
    });
  });

  describe("non-plain-object instances pass through unchanged", () => {
    it("passes a Date through unchanged", () => {
      const d = new Date("2026-05-13T00:00:00Z");
      const out = redactSecrets({ when: d });
      assert.equal((out as { when: Date }).when, d);
    });
    it("passes a Buffer through unchanged", () => {
      const b = Buffer.from("hi");
      const out = redactSecrets({ payload: b });
      assert.equal((out as { payload: Buffer }).payload, b);
    });
  });

  describe("input is not mutated", () => {
    it("leaves the original object deep-equal to a snapshot", () => {
      const input = {
        secret: "shhh",
        nested: { token: "t", id: "x" },
        list: [{ password: "p" }],
      };
      const snapshot = JSON.parse(JSON.stringify(input));
      redactSecrets(input);
      assert.deepEqual(input, snapshot);
    });
  });

  describe("circular references", () => {
    it("terminates and emits [CIRCULAR] at the back-edge for objects", () => {
      type Cyc = { id: string; self?: Cyc };
      const cycle: Cyc = { id: "a" };
      cycle.self = cycle;

      let out: unknown;
      assert.doesNotThrow(() => {
        out = redactSecrets(cycle);
      });
      const result = out as { id: string; self: unknown };
      assert.equal(result.id, "a");
      assert.equal(result.self, "[CIRCULAR]");
      // Original is untouched.
      assert.equal(cycle.self, cycle);
    });

    it("does NOT report a merely SHARED (non-circular) reference as circular", () => {
      // The cycle guard tracks the ancestor path, not every node ever seen.
      // With a permanent visited set, `b` below would come back as
      // "[CIRCULAR]" even though the graph is a DAG with no back-edge --
      // silently corrupting the audit trail for any destructive tool whose
      // input reuses one object in two places.
      const shared = { token: "t", id: "x" };
      const input = { a: shared, b: shared };
      assert.deepEqual(redactSecrets(input), {
        a: { token: "[REDACTED]", id: "x" },
        b: { token: "[REDACTED]", id: "x" },
      });
    });

    it("does NOT report a shared reference as circular when it repeats in an array", () => {
      const shared = { password: "p" };
      assert.deepEqual(redactSecrets([shared, shared, shared]), [
        { password: "[REDACTED]" },
        { password: "[REDACTED]" },
        { password: "[REDACTED]" },
      ]);
    });

    it("still flags a cycle that sits below a shared reference", () => {
      // Sibling-shared subtree AND a real back-edge in the same payload:
      // the shared node must redact twice, the self-reference must not
      // recurse forever.
      type Node = { id: string; self?: Node };
      const cycle: Node = { id: "c" };
      cycle.self = cycle;
      const shared = { id: "s" };
      const out = redactSecrets({ a: shared, b: shared, c: cycle }) as {
        a: { id: string };
        b: { id: string };
        c: { id: string; self: unknown };
      };
      assert.deepEqual(out.a, { id: "s" });
      assert.deepEqual(out.b, { id: "s" });
      assert.equal(out.c.self, "[CIRCULAR]");
    });

    it("reuses the completed subtree for a shared reference instead of re-walking it", () => {
      // Structural proof that memoization is active: a node reached twice
      // yields the SAME output object both times. Without the memo the two
      // positions are independent walks, which is what makes a diamond DAG
      // exponential (see the next test).
      const shared = { nested: { id: "x" } };
      const out = redactSecrets({ a: shared, b: shared }) as { a: unknown; b: unknown };
      assert.equal(out.a, out.b, "a shared input node must map to one shared output node");
    });

    it("stays linear on a diamond DAG (2^depth paths over depth+1 objects)", { timeout: 5000 }, () => {
      // Each level holds two references to the SAME child, so there are no
      // cycles and only 25 distinct objects -- but 2^24 distinct root-to-leaf
      // paths. An ancestor-set-only walk is O(paths): this took ~13s at depth
      // 24 (measured: 3.2s at depth 22, doubling per level) and would block
      // for the better part of an hour at MAX_DEPTH. The memo makes it O(n).
      let node: Record<string, unknown> = { token: "leaf-secret" };
      for (let i = 0; i < 24; i++) node = { a: node, b: node };

      const out = redactSecrets(node) as Record<string, unknown>;
      // Walk down one arbitrary spine and confirm the leaf still redacted.
      let cursor: Record<string, unknown> = out;
      for (let i = 0; i < 24; i++) {
        cursor = (i % 2 === 0 ? cursor.a : cursor.b) as Record<string, unknown>;
      }
      assert.equal(cursor.token, "[REDACTED]");
    });

    it("truncates input nested past MAX_DEPTH", () => {
      // The depth cap is the recursion guard for a long chain (no cycle, no
      // sharing -- just deep). Nothing else stops it.
      let node: Record<string, unknown> = { secret: "deep-value" };
      for (let i = 0; i < 40; i++) node = { next: node };

      const out = redactSecrets(node) as Record<string, unknown>;
      let cursor: unknown = out;
      let depth = 0;
      while (cursor && typeof cursor === "object" && "next" in (cursor as Record<string, unknown>)) {
        cursor = (cursor as Record<string, unknown>).next;
        depth++;
        if (depth > 45) break;
      }
      assert.equal(cursor, "[CIRCULAR]", "descent past MAX_DEPTH must stop and mark the boundary");
      assert.ok(depth <= 33, `expected truncation at the cap, walked ${depth} levels`);
    });

    it("does NOT reuse a memoized subtree that was truncated at a deeper position", () => {
      // The memo entry records the depth it was computed at. The same node
      // appears twice here: once at depth 31 (where its own children run past
      // MAX_DEPTH and get cut off) and once at depth 1 (where there is budget
      // to expand fully). Reusing the first, truncated result for the second
      // position would write "[CIRCULAR]" into the audit log in place of real
      // -- here, secret-bearing -- input.
      const shared = { a: { b: { c: { secret: "top-secret" } } } };
      let chain: Record<string, unknown> = shared;
      for (let i = 0; i < 30; i++) chain = { next: chain };

      // Key order matters: the deep branch is walked first, seeding the memo
      // with the truncated result.
      const out = redactSecrets({ deepBranch: chain, shallowBranch: shared }) as {
        deepBranch: Record<string, unknown>;
        shallowBranch: { a: { b: { c: { secret: string } } } };
      };

      // Precondition: the deep placement really did truncate.
      let cursor: Record<string, unknown> = out.deepBranch;
      for (let i = 0; i < 30; i++) cursor = cursor.next as Record<string, unknown>;
      assert.equal(
        (cursor.a as Record<string, unknown>).b,
        "[CIRCULAR]",
        "precondition: the deep placement should have been truncated",
      );

      // The shallow placement must be fully expanded and redacted.
      assert.equal(out.shallowBranch.a.b.c.secret, "[REDACTED]");
    });

    it("terminates on arrays that reference themselves", () => {
      const arr: unknown[] = [1];
      arr.push(arr);
      let out: unknown;
      assert.doesNotThrow(() => {
        out = redactSecrets(arr);
      });
      const result = out as unknown[];
      assert.equal(result[0], 1);
      assert.equal(result[1], "[CIRCULAR]");
    });
  });
});

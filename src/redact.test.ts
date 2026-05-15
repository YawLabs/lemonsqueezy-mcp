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

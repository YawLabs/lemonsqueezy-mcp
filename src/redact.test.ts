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

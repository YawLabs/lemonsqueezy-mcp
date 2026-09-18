import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { maskLicenseKey, redactSecrets } from "./redact.js";

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

    it("does NOT redact UUID-shaped values, hyphenated codes, or short opaque IDs", () => {
      // Value-shape only: none of these is JWT-shaped, so none is redacted
      // under a neutral key. A license-key VALUE under a free-form key like
      // `activationCode` is deliberately left alone too -- license-key masking
      // goes by key name only (see "license keys are masked, not preserved").
      const input = {
        activationCode: "ABCD-EFGH-1234-5678",
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
    it("preserves licenseKeyId, instanceId, storeId, orderId, webhookId", () => {
      const input = {
        licenseKeyId: "900",
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
      // accidentally redact business fields -- `shippingAddress` contains
      // `pin`. LICENSE_KEY_RE is anchored for the same reason, which is what
      // keeps `licenseKeyId` (above) readable.
      assert.deepEqual(redactSecrets({ secretQuestion: "what?" }), { secretQuestion: "what?" });
      assert.deepEqual(redactSecrets({ tokenizer: "v1" }), { tokenizer: "v1" });
      assert.deepEqual(redactSecrets({ shippingAddress: "1 Main St" }), { shippingAddress: "1 Main St" });
    });
  });

  describe("license keys are masked, not preserved", () => {
    // A license key authenticates the License API by itself, so it is a
    // bearer credential. Masked by key name to "[REDACTED:last4=XXXX]" so an
    // auditor can still tell which key an entry refers to.
    const KEY = "38b1460a-5104-4067-a91d-77b872934d51";

    it("masks to the documented [REDACTED:last4=XXXX] format", () => {
      // The one place the format is spelled out literally: README documents
      // it, so a change here is a docs change too. Every other assertion
      // derives the expected value from maskLicenseKey().
      assert.equal(maskLicenseKey(KEY), "[REDACTED:last4=4d51]");
      assert.deepEqual(redactSecrets({ licenseKey: KEY }), { licenseKey: "[REDACTED:last4=4d51]" });
    });

    it("masks every spelling LICENSE_KEY_RE covers", () => {
      const masked = maskLicenseKey(KEY);
      for (const key of ["licenseKey", "license_key", "license-key", "LicenseKey", "LICENSE_KEY"]) {
        assert.deepEqual(redactSecrets({ [key]: KEY }), { [key]: masked }, `${key} must be masked`);
      }
    });

    it("passes the opaque management-API IDs through unchanged", () => {
      // Anchoring is what keeps these out: each merely STARTS with licenseKey.
      const input = { licenseKeyId: "900", license_key_id: "901", licenseKeyInstanceId: "902" };
      assert.deepEqual(redactSecrets(input), input);
    });

    it("fully redacts a key shorter than 16 characters", () => {
      // Four characters of a short value is too large a share to print.
      const fifteen = "ABCD-EFGH-12345";
      const sixteen = "ABCD-EFGH-123456";
      assert.equal(fifteen.length, 15);
      assert.equal(sixteen.length, 16);
      assert.deepEqual(redactSecrets({ licenseKey: "ABC-123" }), { licenseKey: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ licenseKey: fifteen }), { licenseKey: "[REDACTED]" });
      // 16 characters is the floor: that value keeps its last four.
      assert.notEqual(maskLicenseKey(sixteen), "[REDACTED]", "16 characters is the floor");
      assert.deepEqual(redactSecrets({ licenseKey: sixteen }), { licenseKey: maskLicenseKey(sixteen) });
      assert.ok(maskLicenseKey(sixteen).includes("3456"), "the last four characters are kept");
      assert.ok(!maskLicenseKey(sixteen).includes("ABCD"), "nothing before the last four is kept");
    });

    it("fully redacts a non-string value (fails closed)", () => {
      // The License API's own response nests the key as license_key: { key },
      // which is exactly what an unrecognized error body would carry.
      assert.deepEqual(redactSecrets({ license_key: { key: KEY } }), { license_key: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ licenseKey: 1234567890123456 }), { licenseKey: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ licenseKey: null }), { licenseKey: "[REDACTED]" });
      assert.deepEqual(redactSecrets({ licenseKey: [KEY] }), { licenseKey: "[REDACTED]" });
      const out = JSON.stringify(redactSecrets({ license_key: { key: KEY } }));
      assert.ok(!out.includes(KEY), "the nested key must not survive");
    });

    it("masks a license key nested inside objects and arrays", () => {
      const masked = maskLicenseKey(KEY);
      assert.deepEqual(redactSecrets({ meta: { licenseKey: KEY }, list: [{ license_key: KEY }] }), {
        meta: { licenseKey: masked },
        list: [{ license_key: masked }],
      });
    });

    it("masks a shared-reference object in every position (memo path)", () => {
      // The memo hands back one output node for a shared input node, so the
      // second position is served from the cache. It must be the MASKED node.
      const shared = { licenseKey: KEY, instanceId: "inst-1" };
      const out = redactSecrets({ a: shared, b: shared, c: [shared] }) as {
        a: unknown;
        b: unknown;
        c: unknown[];
      };
      const expected = { licenseKey: maskLicenseKey(KEY), instanceId: "inst-1" };
      assert.deepEqual(out.a, expected);
      assert.deepEqual(out.b, expected);
      assert.deepEqual(out.c[0], expected);
      assert.ok(!JSON.stringify(out).includes(KEY));
    });

    it("does not mutate the input", () => {
      const input = { licenseKey: KEY };
      redactSecrets(input);
      assert.equal(input.licenseKey, KEY);
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

describe("redact.js module graph", () => {
  // api.ts imports redactSecrets for its unrecognized-error-body fallback, and
  // wrapper.ts imports it for audit inputs. If anything redact.ts imports ever
  // leads back to redact.ts, ESM hands one side a module whose bindings are
  // not initialized yet -- and the side that loses is the redactor. This walks
  // the compiled relative imports (type-only imports are erased by tsc, so
  // they cannot form a runtime cycle) starting at redact.js and fails on any
  // path back to it.
  const distDir = dirname(fileURLToPath(import.meta.url));
  const IMPORT_RE =
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.[^"']+)["']|(?:^|\n)\s*import\s*["'](\.[^"']+)["']/g;

  function relativeImports(file: string): string[] {
    const src = readFileSync(resolve(distDir, file), "utf-8");
    return [...src.matchAll(IMPORT_RE)].map((m) =>
      posix.normalize(posix.join(posix.dirname(file), m[1] ?? m[2] ?? "")),
    );
  }

  it("the import scan sees api.js importing redact.js (the scan works)", () => {
    // Guards the test below against passing vacuously on a regex that
    // matches nothing.
    assert.ok(relativeImports("api.js").includes("redact.js"), "api.js should import ./redact.js");
  });

  it("no module reachable from redact.js imports redact.js back", () => {
    const seen = new Set<string>();
    const stack: { file: string; path: string[] }[] = [{ file: "redact.js", path: ["redact.js"] }];
    while (stack.length > 0) {
      const { file, path } = stack.pop() as { file: string; path: string[] };
      if (seen.has(file)) continue;
      seen.add(file);
      for (const target of relativeImports(file)) {
        assert.notEqual(target, "redact.js", `import cycle: ${[...path, target].join(" -> ")}`);
        stack.push({ file: target, path: [...path, target] });
      }
    }
  });
});

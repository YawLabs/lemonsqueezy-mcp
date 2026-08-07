import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  _resetGuardrailsForTest,
  checkClassAllowed,
  checkClassRateLimit,
  checkDestructiveRateLimit,
  checkRefundAmount,
  checkStoreAllowed,
  checkStoreScopedToolInput,
  GuardrailError,
  isDestructiveCall,
  isStoreAllowlistActive,
} from "./guardrails.js";

const ENV_KEYS = [
  "LEMONSQUEEZY_ALLOWED_STORE_IDS",
  "LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS",
  "LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT",
  "LEMONSQUEEZY_DISABLE_CLASSES",
  "LEMONSQUEEZY_RATE_LIMIT_PER_CLASS",
] as const;

function withEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    if (vars[k] !== undefined) process.env[k] = vars[k];
    else delete process.env[k];
  }
  try {
    _resetGuardrailsForTest();
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    _resetGuardrailsForTest();
  }
}

describe("checkStoreAllowed", () => {
  beforeEach(() => _resetGuardrailsForTest());
  afterEach(() => _resetGuardrailsForTest());

  it("no-op when allowlist unset", () => {
    withEnv({}, () => {
      assert.doesNotThrow(() => checkStoreAllowed("123"));
    });
  });

  it("allows store in list", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1,2,3" }, () => {
      assert.doesNotThrow(() => checkStoreAllowed("2"));
    });
  });

  it("rejects store not in list", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1,2,3" }, () => {
      assert.throws(() => checkStoreAllowed("99"), GuardrailError);
    });
  });

  it("trims whitespace in list", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: " 1 , 2 , 3 " }, () => {
      assert.doesNotThrow(() => checkStoreAllowed("2"));
    });
  });

  it("no-op when storeId undefined", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
      assert.doesNotThrow(() => checkStoreAllowed(undefined));
    });
  });

  it("no-op when allowlist is empty string", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "" }, () => {
      assert.doesNotThrow(() => checkStoreAllowed("anything"));
    });
  });
});

describe("checkRefundAmount", () => {
  beforeEach(() => _resetGuardrailsForTest());
  afterEach(() => _resetGuardrailsForTest());

  it("no-op when cap unset", () => {
    withEnv({}, () => {
      assert.doesNotThrow(() => checkRefundAmount(1_000_000));
    });
  });

  it("allows amount at cap", () => {
    withEnv({ LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS: "10000" }, () => {
      assert.doesNotThrow(() => checkRefundAmount(10000));
    });
  });

  it("rejects amount above cap", () => {
    withEnv({ LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS: "10000" }, () => {
      assert.throws(() => checkRefundAmount(10001), GuardrailError);
    });
  });

  it("throws on invalid cap value", () => {
    withEnv({ LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS: "not-a-number" }, () => {
      assert.throws(() => checkRefundAmount(1), /must be a non-negative number/);
    });
  });

  it("throws on negative cap value", () => {
    withEnv({ LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS: "-5" }, () => {
      assert.throws(() => checkRefundAmount(1), /must be a non-negative number/);
    });
  });

  it("a cap of 0 blocks every refund (0 is a valid value, not 'unset')", () => {
    // readNumber() treats "" / unset as null (no cap) but accepts "0" as a
    // real cap. The refund schema enforces amount >= 1, so a cap of 0 is a
    // deliberate kill switch. Pinned because "0 means unlimited" is the
    // opposite convention and an easy regression.
    withEnv({ LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS: "0" }, () => {
      assert.throws(() => checkRefundAmount(1), GuardrailError);
      assert.doesNotThrow(() => checkRefundAmount(0));
    });
  });
});

describe("checkDestructiveRateLimit", () => {
  beforeEach(() => _resetGuardrailsForTest());
  afterEach(() => _resetGuardrailsForTest());

  it("no-op when rate limit unset", () => {
    withEnv({}, () => {
      for (let i = 0; i < 100; i++) checkDestructiveRateLimit();
    });
  });

  it("enforces limit within window", () => {
    withEnv({ LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT: "3" }, () => {
      const t = 1_000_000;
      checkDestructiveRateLimit(t);
      checkDestructiveRateLimit(t + 1);
      checkDestructiveRateLimit(t + 2);
      assert.throws(() => checkDestructiveRateLimit(t + 3), GuardrailError);
    });
  });

  it("a limit of 0 blocks every destructive call", () => {
    // Same convention as the refund cap: "" / unset means no limit, "0" means
    // block everything. Documented in the README env table.
    withEnv({ LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT: "0" }, () => {
      assert.throws(() => checkDestructiveRateLimit(1_000_000), GuardrailError);
    });
  });

  it("a per-class limit of 0 blocks every call in that class", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:0/h" }, () => {
      assert.throws(() => checkClassRateLimit("money", 1_000_000), GuardrailError);
      // Unlisted classes remain unaffected.
      assert.doesNotThrow(() => checkClassRateLimit("read", 1_000_000));
    });
  });

  it("drops timestamps outside window", () => {
    withEnv({ LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT: "2" }, () => {
      const t = 1_000_000;
      checkDestructiveRateLimit(t);
      checkDestructiveRateLimit(t + 1);
      assert.throws(() => checkDestructiveRateLimit(t + 2), GuardrailError);
      // Advance past the 60s window — previous entries expire.
      assert.doesNotThrow(() => checkDestructiveRateLimit(t + 61_000));
      assert.doesNotThrow(() => checkDestructiveRateLimit(t + 61_001));
      assert.throws(() => checkDestructiveRateLimit(t + 61_002), GuardrailError);
    });
  });
});

describe("isStoreAllowlistActive", () => {
  beforeEach(() => _resetGuardrailsForTest());
  afterEach(() => _resetGuardrailsForTest());

  it("is false when env var unset", () => {
    withEnv({}, () => {
      assert.equal(isStoreAllowlistActive(), false);
    });
  });

  it("is false when env var is empty", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "" }, () => {
      assert.equal(isStoreAllowlistActive(), false);
    });
  });

  it("is true when env var has at least one id", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "42" }, () => {
      assert.equal(isStoreAllowlistActive(), true);
    });
  });
});

// Build a mock tool shape for the new checkStoreScopedToolInput signature.
// Only `inputSchema.shape` keys matter for the storeId branch; the values
// are unused so an empty `{}` per key is fine.
function mockTool(opts: { fields?: string[]; requiredFilters?: readonly string[] } = {}): {
  inputSchema: { shape: Record<string, unknown> };
  requiredFilters?: readonly string[];
} {
  const shape: Record<string, unknown> = {};
  for (const f of opts.fields ?? []) shape[f] = {};
  const tool: { inputSchema: { shape: Record<string, unknown> }; requiredFilters?: readonly string[] } = {
    inputSchema: { shape },
  };
  if (opts.requiredFilters) tool.requiredFilters = opts.requiredFilters;
  return tool;
}

describe("checkStoreScopedToolInput", () => {
  beforeEach(() => _resetGuardrailsForTest());
  afterEach(() => _resetGuardrailsForTest());

  it("no-op when tool does not accept storeId", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
      assert.doesNotThrow(() => checkStoreScopedToolInput(mockTool(), {}));
    });
  });

  it("no-op when allowlist unset and storeId omitted", () => {
    withEnv({}, () => {
      assert.doesNotThrow(() => checkStoreScopedToolInput(mockTool({ fields: ["storeId"] }), {}));
    });
  });

  it("requires storeId when allowlist is set and tool accepts it", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
      assert.throws(() => checkStoreScopedToolInput(mockTool({ fields: ["storeId"] }), {}), GuardrailError);
    });
  });

  it("rejects empty-string storeId when allowlist is set", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
      assert.throws(
        () => checkStoreScopedToolInput(mockTool({ fields: ["storeId"] }), { storeId: "" }),
        GuardrailError,
      );
    });
  });

  it("delegates to checkStoreAllowed when storeId is present", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1,2" }, () => {
      assert.doesNotThrow(() => checkStoreScopedToolInput(mockTool({ fields: ["storeId"] }), { storeId: "2" }));
      assert.throws(
        () => checkStoreScopedToolInput(mockTool({ fields: ["storeId"] }), { storeId: "99" }),
        GuardrailError,
      );
    });
  });

  it("coerces a numeric storeId to string before checking", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "42" }, () => {
      assert.doesNotThrow(() => checkStoreScopedToolInput(mockTool({ fields: ["storeId"] }), { storeId: 42 }));
      assert.throws(
        () => checkStoreScopedToolInput(mockTool({ fields: ["storeId"] }), { storeId: 99 }),
        GuardrailError,
      );
    });
  });

  describe("requiredFilters", () => {
    it("no-op when allowlist unset, even if no filters provided", () => {
      withEnv({}, () => {
        const tool = mockTool({ requiredFilters: ["x", "y"] });
        assert.doesNotThrow(() => checkStoreScopedToolInput(tool, {}));
      });
    });

    it("throws when allowlist set and no filters provided", () => {
      withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
        const tool = mockTool({ requiredFilters: ["x", "y"] });
        assert.throws(() => checkStoreScopedToolInput(tool, {}), GuardrailError);
      });
    });

    it("passes when allowlist set and only x provided", () => {
      withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
        const tool = mockTool({ requiredFilters: ["x", "y"] });
        assert.doesNotThrow(() => checkStoreScopedToolInput(tool, { x: "abc" }));
      });
    });

    it("passes when allowlist set and only y provided", () => {
      withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
        const tool = mockTool({ requiredFilters: ["x", "y"] });
        assert.doesNotThrow(() => checkStoreScopedToolInput(tool, { y: "abc" }));
      });
    });

    it("passes when allowlist set and both provided", () => {
      withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
        const tool = mockTool({ requiredFilters: ["x", "y"] });
        assert.doesNotThrow(() => checkStoreScopedToolInput(tool, { x: "abc", y: "def" }));
      });
    });

    it("throws when allowlist set and x is explicit undefined", () => {
      withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
        const tool = mockTool({ requiredFilters: ["x", "y"] });
        assert.throws(() => checkStoreScopedToolInput(tool, { x: undefined }), GuardrailError);
      });
    });

    it("throws when allowlist set and x is empty string", () => {
      withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
        const tool = mockTool({ requiredFilters: ["x", "y"] });
        assert.throws(() => checkStoreScopedToolInput(tool, { x: "" }), GuardrailError);
      });
    });

    it("throws when allowlist set and x is empty array", () => {
      withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
        const tool = mockTool({ requiredFilters: ["x", "y"] });
        assert.throws(() => checkStoreScopedToolInput(tool, { x: [] }), GuardrailError);
      });
    });

    it("accepts numeric zero as present (defensive)", () => {
      withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
        const tool = mockTool({ requiredFilters: ["x"] });
        assert.doesNotThrow(() => checkStoreScopedToolInput(tool, { x: 0 }));
      });
    });
  });
});

describe("checkClassAllowed", () => {
  beforeEach(() => _resetGuardrailsForTest());
  afterEach(() => _resetGuardrailsForTest());

  it("no-op when env unset", () => {
    withEnv({}, () => {
      assert.doesNotThrow(() => checkClassAllowed("money"));
      assert.doesNotThrow(() => checkClassAllowed("read"));
    });
  });

  it("rejects a single disabled class", () => {
    withEnv({ LEMONSQUEEZY_DISABLE_CLASSES: "money" }, () => {
      assert.throws(() => checkClassAllowed("money"), GuardrailError);
      assert.doesNotThrow(() => checkClassAllowed("recurring"));
    });
  });

  it("rejects multiple disabled classes", () => {
    withEnv({ LEMONSQUEEZY_DISABLE_CLASSES: "money,recurring,pii" }, () => {
      assert.throws(() => checkClassAllowed("money"), GuardrailError);
      assert.throws(() => checkClassAllowed("recurring"), GuardrailError);
      assert.throws(() => checkClassAllowed("pii"), GuardrailError);
      assert.doesNotThrow(() => checkClassAllowed("read"));
      assert.doesNotThrow(() => checkClassAllowed("webhook"));
    });
  });

  it("trims whitespace in list", () => {
    withEnv({ LEMONSQUEEZY_DISABLE_CLASSES: " money , recurring " }, () => {
      assert.throws(() => checkClassAllowed("money"), GuardrailError);
      assert.throws(() => checkClassAllowed("recurring"), GuardrailError);
    });
  });

  it("no-op when env is empty string", () => {
    withEnv({ LEMONSQUEEZY_DISABLE_CLASSES: "" }, () => {
      assert.doesNotThrow(() => checkClassAllowed("money"));
    });
  });

  it("throws at config load on unknown class", () => {
    withEnv({ LEMONSQUEEZY_DISABLE_CLASSES: "money,wat" }, () => {
      assert.throws(() => checkClassAllowed("money"), /unknown class/);
    });
  });
});

describe("checkClassRateLimit", () => {
  beforeEach(() => _resetGuardrailsForTest());
  afterEach(() => _resetGuardrailsForTest());

  it("no-op when env unset", () => {
    withEnv({}, () => {
      for (let i = 0; i < 100; i++) checkClassRateLimit("money");
    });
  });

  it("enforces per-class limit per minute (bare number = minutes)", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:2" }, () => {
      const t = 1_000_000;
      checkClassRateLimit("money", t);
      checkClassRateLimit("money", t + 1);
      assert.throws(() => checkClassRateLimit("money", t + 2), GuardrailError);
    });
  });

  it("supports per-minute units explicitly", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:2/m" }, () => {
      const t = 1_000_000;
      checkClassRateLimit("money", t);
      checkClassRateLimit("money", t + 1);
      assert.throws(() => checkClassRateLimit("money", t + 2), GuardrailError);
      // After 60s the window slides
      assert.doesNotThrow(() => checkClassRateLimit("money", t + 61_000));
    });
  });

  it("supports per-hour units", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:2/h" }, () => {
      const t = 1_000_000;
      checkClassRateLimit("money", t);
      checkClassRateLimit("money", t + 1);
      assert.throws(() => checkClassRateLimit("money", t + 2), GuardrailError);
      // 30 minutes later still over limit
      assert.throws(() => checkClassRateLimit("money", t + 30 * 60_000), GuardrailError);
      // After 1 hour the oldest entry slides
      assert.doesNotThrow(() => checkClassRateLimit("money", t + 60 * 60_000 + 1));
    });
  });

  it("each class tracks its own window independently", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:1/m,recurring:1/m" }, () => {
      const t = 1_000_000;
      checkClassRateLimit("money", t);
      // money is now at its limit
      assert.throws(() => checkClassRateLimit("money", t + 1), GuardrailError);
      // recurring is still fresh
      assert.doesNotThrow(() => checkClassRateLimit("recurring", t + 1));
      assert.throws(() => checkClassRateLimit("recurring", t + 2), GuardrailError);
    });
  });

  it("no-op for classes not listed in the env var", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:1/m" }, () => {
      for (let i = 0; i < 100; i++) checkClassRateLimit("read");
    });
  });

  it("throws on missing colon", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money" }, () => {
      assert.throws(() => checkClassRateLimit("money"), /missing colon/);
    });
  });

  it("throws on unknown class", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "wat:5/m" }, () => {
      assert.throws(() => checkClassRateLimit("money"), /unknown class/);
    });
  });

  it("throws on invalid number", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:abc/m" }, () => {
      assert.throws(() => checkClassRateLimit("money"), /invalid number/);
    });
  });

  it("throws on invalid unit", () => {
    withEnv({ LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:5/d" }, () => {
      assert.throws(() => checkClassRateLimit("money"), /invalid unit/);
    });
  });

  it("class limit and destructive limit compose (both must pass)", () => {
    withEnv(
      {
        LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:5/m",
        LEMONSQUEEZY_DESTRUCTIVE_RATE_LIMIT: "2",
      },
      () => {
        const t = 1_000_000;
        // class limit allows 5, destructive limit allows 2 -- destructive wins
        checkClassRateLimit("money", t);
        checkDestructiveRateLimit(t);
        checkClassRateLimit("money", t + 1);
        checkDestructiveRateLimit(t + 1);
        // class still has room (2 of 5 used) but destructive is exhausted
        checkClassRateLimit("money", t + 2);
        assert.throws(() => checkDestructiveRateLimit(t + 2), GuardrailError);
      },
    );
  });
});

describe("isDestructiveCall", () => {
  it("uses the static destructiveHint when no isDestructive override", () => {
    const tool = { annotations: { destructiveHint: true } };
    assert.equal(isDestructiveCall(tool, {}), true);

    const readOnly = { annotations: { destructiveHint: false } };
    assert.equal(isDestructiveCall(readOnly, {}), false);
  });

  it("returns false when annotations omit destructiveHint entirely", () => {
    assert.equal(isDestructiveCall({ annotations: {} }, {}), false);
    assert.equal(isDestructiveCall({}, {}), false);
  });

  it("uses the runtime predicate when present, ignoring static hint", () => {
    const tool = {
      annotations: { destructiveHint: false },
      isDestructive: (input: Record<string, unknown>) => input.disabled === true,
    };
    assert.equal(isDestructiveCall(tool, { disabled: true }), true);
    assert.equal(isDestructiveCall(tool, { disabled: false }), false);
    assert.equal(isDestructiveCall(tool, {}), false);
  });
});

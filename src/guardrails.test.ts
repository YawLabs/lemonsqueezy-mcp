import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  _resetGuardrailsForTest,
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

describe("checkStoreScopedToolInput", () => {
  beforeEach(() => _resetGuardrailsForTest());
  afterEach(() => _resetGuardrailsForTest());

  it("no-op when tool does not accept storeId", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
      assert.doesNotThrow(() => checkStoreScopedToolInput(false, {}));
    });
  });

  it("no-op when allowlist unset and storeId omitted", () => {
    withEnv({}, () => {
      assert.doesNotThrow(() => checkStoreScopedToolInput(true, {}));
    });
  });

  it("requires storeId when allowlist is set and tool accepts it", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
      assert.throws(() => checkStoreScopedToolInput(true, {}), GuardrailError);
    });
  });

  it("rejects empty-string storeId when allowlist is set", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1" }, () => {
      assert.throws(() => checkStoreScopedToolInput(true, { storeId: "" }), GuardrailError);
    });
  });

  it("delegates to checkStoreAllowed when storeId is present", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "1,2" }, () => {
      assert.doesNotThrow(() => checkStoreScopedToolInput(true, { storeId: "2" }));
      assert.throws(() => checkStoreScopedToolInput(true, { storeId: "99" }), GuardrailError);
    });
  });

  it("coerces a numeric storeId to string before checking", () => {
    withEnv({ LEMONSQUEEZY_ALLOWED_STORE_IDS: "42" }, () => {
      assert.doesNotThrow(() => checkStoreScopedToolInput(true, { storeId: 42 }));
      assert.throws(() => checkStoreScopedToolInput(true, { storeId: 99 }), GuardrailError);
    });
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

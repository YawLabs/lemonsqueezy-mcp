import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  GuardrailError,
  _resetGuardrailsForTest,
  checkDestructiveRateLimit,
  checkRefundAmount,
  checkStoreAllowed,
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

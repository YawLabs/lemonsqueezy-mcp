import assert from "node:assert/strict";
import { test } from "node:test";
import { annotatePricePayload, computeEffectivePrice } from "./effective-price.js";

/**
 * Fixtures are REAL payloads from a live store (ids scrubbed), because the
 * defect only shows up in real data: three per-seat products whose price
 * records all report `unit_price: 2000` while billing $25, $100 and $200.
 * A hand-made fixture would have had three different unit_prices and proved
 * nothing.
 */
const TEAM = { scheme: "volume", unit_price: 2000, tiers: [{ last_unit: "inf", unit_price: 2500, fixed_fee: 0 }] };
const TEAM_MAX = { scheme: "volume", unit_price: 2000, tiers: [{ last_unit: "inf", unit_price: 10000, fixed_fee: 0 }] };
const TEAM_ULTRA = {
  scheme: "volume",
  unit_price: 2000,
  tiers: [{ last_unit: "inf", unit_price: 20000, fixed_fee: 0 }],
};
const SOLO_MAX = { scheme: "standard", unit_price: 10000 };

test("tiered: reports the tier price, not the vestigial unit_price", () => {
  assert.equal(computeEffectivePrice(TEAM).effective_unit_price, 2500);
  assert.equal(computeEffectivePrice(TEAM_MAX).effective_unit_price, 10000);
  assert.equal(computeEffectivePrice(TEAM_ULTRA).effective_unit_price, 20000);
});

test("tiered: three products sharing one unit_price are told apart", () => {
  // The exact failure this module exists to prevent: identical `unit_price`
  // across products that bill 1x / 4x / 8x. If a future refactor reads
  // unit_price again, these collapse to one value and this fails.
  const prices = [TEAM, TEAM_MAX, TEAM_ULTRA].map((p) => computeEffectivePrice(p).effective_unit_price);
  assert.deepEqual(prices, [2500, 10000, 20000]);
  assert.equal(new Set(prices).size, 3, "three distinct prices must stay distinct");
  assert.equal(new Set([TEAM, TEAM_MAX, TEAM_ULTRA].map((p) => p.unit_price)).size, 1);
});

test("tiered: flags that unit_price is not charged, and says so in the note", () => {
  const got = computeEffectivePrice(TEAM_MAX);
  assert.equal(got.unit_price_is_not_charged, true);
  assert.match(got.effective_unit_price_note, /tiers\[0\]\.unit_price/);
  assert.match(got.effective_unit_price_note, /NOT charged/);
});

test("standard: unit_price IS the charged amount and carries no warning flag", () => {
  const got = computeEffectivePrice(SOLO_MAX);
  assert.equal(got.effective_unit_price, 10000);
  assert.equal(got.unit_price_is_not_charged, undefined);
});

test("prefers unit_price_decimal for sub-cent precision", () => {
  const got = computeEffectivePrice({
    scheme: "volume",
    unit_price: 2000,
    tiers: [{ last_unit: "inf", unit_price: 3, unit_price_decimal: "2.5" }],
  });
  assert.equal(got.effective_unit_price, 2.5, "the rounded integer must not win over the decimal");
});

test("tiered with no usable tiers: refuses to guess rather than falling back", () => {
  for (const attrs of [
    { scheme: "volume", unit_price: 2000, tiers: [] },
    { scheme: "volume", unit_price: 2000, tiers: null },
    { scheme: "graduated", unit_price: 2000, tiers: [{ last_unit: "inf", unit_price: null }] },
  ]) {
    const got = computeEffectivePrice(attrs);
    assert.equal(got.effective_unit_price, null, "must be null, never the unit_price fallback");
    assert.notEqual(got.effective_unit_price, 2000);
    assert.equal(got.unit_price_is_not_charged, true);
  }
});

test("multi-tier: reports the first tier and says the rate varies", () => {
  const got = computeEffectivePrice({
    scheme: "graduated",
    unit_price: 2000,
    tiers: [
      { last_unit: 10, unit_price: 5000 },
      { last_unit: "inf", unit_price: 4000 },
    ],
  });
  assert.equal(got.effective_unit_price, 5000);
  assert.match(got.effective_unit_price_note, /varies with quantity/);
});

test("annotates a list payload and leaves raw fields intact", () => {
  const out = annotatePricePayload({
    meta: { page: { total: 2 } },
    data: [
      { type: "prices", id: "1", attributes: TEAM_MAX },
      { type: "prices", id: "2", attributes: SOLO_MAX },
    ],
  }) as { meta: unknown; data: Array<{ id: string; attributes: Record<string, unknown> }> };

  assert.equal(out.data[0].attributes.effective_unit_price, 10000);
  assert.equal(out.data[1].attributes.effective_unit_price, 10000);
  // Additive only: the upstream shape survives untouched.
  assert.equal(out.data[0].attributes.unit_price, 2000);
  assert.deepEqual(out.data[0].attributes.tiers, TEAM_MAX.tiers);
  assert.deepEqual(out.meta, { page: { total: 2 } });
  assert.equal(out.data[0].id, "1");
});

test("annotates a single-resource payload", () => {
  const out = annotatePricePayload({ data: { type: "prices", id: "1", attributes: TEAM } }) as {
    data: { attributes: Record<string, unknown> };
  };
  assert.equal(out.data.attributes.effective_unit_price, 2500);
});

test("passes through payloads with nothing to annotate", () => {
  // An error body must reach the caller unreshaped.
  const err = { errors: [{ status: "404", detail: "Not found" }] };
  assert.deepEqual(annotatePricePayload(err), err);
  assert.equal(annotatePricePayload(null), null);
  assert.equal(annotatePricePayload("nope"), "nope");
  assert.deepEqual(annotatePricePayload({ data: [] }), { data: [] });
  // A resource with no attributes object is left alone rather than crashing.
  const odd = { data: [{ type: "prices", id: "1" }] };
  assert.deepEqual(annotatePricePayload(odd), odd);
});

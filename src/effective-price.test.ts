import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotateEmbeddedPrices,
  annotatePricePayload,
  computeEffectivePrice,
  withEffectivePrice,
} from "./effective-price.js";

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

/**
 * `package` pricing. Per the API docs, `tiers` is returned only "when using
 * volume and graduated pricing" and `unit_price` is "not used for volume and
 * graduated pricing (tier data is used instead)" -- so on a package scheme
 * `unit_price` IS charged, for a block of `package_size` units. Treating it as
 * tiered discarded a price the record actually carries and told the reader not
 * to trust the one correct field.
 */
test("package: reports the per-unit price derived from package_size", () => {
  const got = computeEffectivePrice({ scheme: "package", unit_price: 5000, package_size: 5, tiers: null });
  assert.equal(got.effective_unit_price, 1000);
  assert.equal(got.unit_price_is_per_package, true, "a reader must be told 5000 buys 5 units, not 1");
  // unit_price IS charged here, so the tiered flag would be a lie.
  assert.equal(got.unit_price_is_not_charged, undefined);
  assert.match(got.effective_unit_price_note, /charged 5000 cents \(from unit_price\) per package of 5 unit/);
});

test("package: is never treated as tiered, even with tiers absent", () => {
  const got = computeEffectivePrice({ scheme: "package", unit_price: 5000, package_size: 5, tiers: null });
  assert.notEqual(got.effective_unit_price, null, "refusing to report a price the record carries is the bug");
  assert.doesNotMatch(got.effective_unit_price_note, /Do NOT fall back to unit_price/);
  assert.doesNotMatch(got.effective_unit_price_note, /is tiered but no usable tiers/);
});

test("package: package_size 1 is a plain per-unit price with no package flag", () => {
  const got = computeEffectivePrice({ scheme: "package", unit_price: 5000, package_size: 1 });
  assert.equal(got.effective_unit_price, 5000);
  assert.equal(got.unit_price_is_per_package, undefined);
});

test("package: an unusable package_size assumes 1 and discloses the assumption", () => {
  for (const package_size of [null, 0, undefined, Number.NaN]) {
    const got = computeEffectivePrice({ scheme: "package", unit_price: 5000, package_size });
    assert.equal(got.effective_unit_price, 5000, "never divide by a size the record did not give us");
    assert.match(got.effective_unit_price_note, /so 1 was assumed/);
  }
});

test("package: prefers unit_price_decimal and keeps precision through the division", () => {
  const got = computeEffectivePrice({ scheme: "package", unit_price: 3, unit_price_decimal: "2.5", package_size: 2 });
  assert.equal(got.effective_unit_price, 1.25);
});

test("package: no usable price field returns null without a tiered warning", () => {
  const got = computeEffectivePrice({ scheme: "package", unit_price: null, package_size: 5 });
  assert.equal(got.effective_unit_price, null);
  assert.equal(got.unit_price_is_not_charged, undefined);
  assert.equal(got.unit_price_is_per_package, undefined);
});

/**
 * Fees that ride alongside the per-unit rate. They stay OUT of
 * `effective_unit_price` (a period or one-off fee is not a per-unit rate) but
 * must not vanish from a number documented as "actually charged".
 */
test("tiered: a non-zero fixed_fee is named in the note, not silently dropped", () => {
  const got = computeEffectivePrice({
    scheme: "graduated",
    unit_price: 2000,
    tiers: [{ last_unit: "inf", unit_price: 5000, fixed_fee: 1500 }],
  });
  assert.equal(got.effective_unit_price, 5000, "the fee must stay out of the per-unit figure");
  assert.match(got.effective_unit_price_note, /fixed_fee of 1500 cents/);
});

test("an enabled setup_fee is named in the note on a flat price", () => {
  const got = computeEffectivePrice({
    scheme: "standard",
    unit_price: 10000,
    setup_fee: 2500,
    setup_fee_enabled: true,
  });
  assert.equal(got.effective_unit_price, 10000);
  assert.match(got.effective_unit_price_note, /setup_fee of 2500 cents/);
});

test("no fee text when fees are zero, absent, or disabled", () => {
  // TEAM's real tier carries fixed_fee: 0 -- a zero fee is noise, not a note.
  assert.doesNotMatch(computeEffectivePrice(TEAM).effective_unit_price_note, /fixed_fee|setup_fee/);
  assert.doesNotMatch(computeEffectivePrice(SOLO_MAX).effective_unit_price_note, /fixed_fee|setup_fee/);
  assert.doesNotMatch(
    computeEffectivePrice({ scheme: "standard", unit_price: 10000, setup_fee: 2500, setup_fee_enabled: false })
      .effective_unit_price_note,
    /setup_fee/,
  );
});

/**
 * `included[]`. A subscription item is the only resource with a `price`
 * relationship, so `?include=price` there is the one route outside the price
 * tools that hands back price records -- and it is the seat-based-billing
 * route, where the raw `unit_price` is most likely to be read as a per-seat
 * rate.
 */
const SUB_ITEM_WITH_PRICE = {
  data: { type: "subscription-items", id: "9", attributes: { quantity: 4, price_id: 1 } },
  included: [
    { type: "subscriptions", id: "3", attributes: { status: "active" } },
    { type: "prices", id: "1", attributes: TEAM_MAX },
  ],
};

test("embedded: an included price record is annotated, its host resource is not", () => {
  const out = annotateEmbeddedPrices(SUB_ITEM_WITH_PRICE) as {
    data: { attributes: Record<string, unknown> };
    included: Array<{ type: string; attributes: Record<string, unknown> }>;
  };
  assert.equal(out.included[1].attributes.effective_unit_price, 10000);
  assert.equal(out.included[1].attributes.unit_price, 2000, "additive only");
  // Inventing an effective_unit_price on a subscription item would be worse
  // than leaving it off -- it has no price fields to derive from.
  assert.equal(out.data.attributes.effective_unit_price, undefined);
  assert.equal(out.data.attributes.quantity, 4);
  // A non-price include is untouched.
  assert.deepEqual(out.included[0], SUB_ITEM_WITH_PRICE.included[0]);
});

test("embedded: nothing to annotate is a pass-through", () => {
  const bare = { data: { type: "subscription-items", id: "9", attributes: { quantity: 4 } } };
  assert.deepEqual(annotateEmbeddedPrices(bare), bare);
  assert.equal(annotateEmbeddedPrices(null), null);
  const err = { errors: [{ status: "404", detail: "Not found" }] };
  assert.deepEqual(annotateEmbeddedPrices(err), err);
});

test("price payload: included price records are annotated, non-prices are not", () => {
  const out = annotatePricePayload({
    data: [{ type: "prices", id: "1", attributes: TEAM }],
    included: [{ type: "variants", id: "7", attributes: { price: 2000 } }],
  }) as {
    data: Array<{ attributes: Record<string, unknown> }>;
    included: Array<{ attributes: Record<string, unknown> }>;
  };
  assert.equal(out.data[0].attributes.effective_unit_price, 2500);
  assert.equal(out.included[0].attributes.effective_unit_price, undefined, "a variant is not a price record");
});

test("wrapper: preserves handler metadata and passes a failure through untouched", async () => {
  // listHandler attaches `filterMap`; the allowlist-alignment invariants in
  // tools/tools.test.ts SKIP a handler that has none, so a wrapper that drops
  // it removes the tool from the gate without failing anything.
  const inner = Object.assign(async () => ({ ok: false, status: 404, error: "nope" }), {
    filterMap: { variantId: "variant_id" },
  });
  const wrapped = withEffectivePrice(inner);
  assert.deepEqual(wrapped.filterMap, { variantId: "variant_id" });
  assert.deepEqual(await wrapped(), { ok: false, status: 404, error: "nope" });
});

test("wrapper: annotates a successful price response", async () => {
  const inner = async () => ({
    ok: true,
    status: 200,
    data: { data: { type: "prices", id: "1", attributes: TEAM } },
  });
  const res = await withEffectivePrice(inner)();
  const body = res.data as unknown as { data: { attributes: Record<string, unknown> } };
  assert.equal(body.data.attributes.effective_unit_price, 2500);
});

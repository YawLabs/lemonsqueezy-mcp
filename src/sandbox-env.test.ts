import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Same import.meta.url hop as release-metadata.test.ts: the file sits one level
// below the repo root in both layouts (src/ under vitest, dist/ for the
// compiled node:test run), so this reaches the root either way.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const LAUNCHER = "bin/lemonsqueezy-mcp.mjs";
const BUNDLE = "dist/index.js";

/** Every LEMONSQUEEZY_* name granted by the launcher's --allow-env list. */
function grantedEnv(): Set<string> {
  const src = readFileSync(resolve(repoRoot, LAUNCHER), "utf-8");
  const m = src.match(/const env = \[([\s\S]*?)\]/);
  assert.ok(m, `could not find the --allow-env array in ${LAUNCHER}`);
  return new Set([...m[1].matchAll(/"([A-Z0-9_]+)"/g)].map((x) => x[1]).filter((n) => n.startsWith("LEMONSQUEEZY_")));
}

/** Every LEMONSQUEEZY_* name the SHIPPED bundle reads from process.env. */
function bundleReadsEnv(): Set<string> {
  const src = readFileSync(resolve(repoRoot, BUNDLE), "utf-8");
  const names = new Set<string>();
  // esbuild emits both `process.env.NAME` and `process.env["NAME"]` shapes
  // depending on how the source spelled it; cover both.
  for (const m of src.matchAll(/process\.env\.(LEMONSQUEEZY_[A-Z0-9_]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/process\.env\["(LEMONSQUEEZY_[A-Z0-9_]+)"\]/g)) names.add(m[1]);
  return names;
}

describe("sandbox --allow-env allow-list", () => {
  // The gap this exists to prevent shipped in 0.13.0: LEMONSQUEEZY_TEST_API_KEY
  // was read by src/secret.ts but absent from the allow-list, and the failure is
  // SILENT by design -- oam denies a non-granted variable by making it ABSENT
  // from process.env rather than throwing, so `if (testRaw && ...)` simply took
  // the false branch. Test mode quietly fell through to the prod key, or, with
  // only the test key set, loadApiKey() threw "API_KEY ... is required" while
  // the key was in fact configured.
  //
  // Asserting against the built bundle rather than src/ is deliberate: it is the
  // published artifact that runs under the sandbox, and it excludes *.test.ts
  // reads (LEMONSQUEEZY_TEST_STORE_ID is test-only and correctly NOT granted).
  it("grants every LEMONSQUEEZY_* variable the shipped bundle reads", () => {
    const granted = grantedEnv();
    const read = bundleReadsEnv();

    // Guard against a vacuous pass if a regex stops matching after a refactor.
    assert.ok(granted.size > 0, "parsed an empty allow-list -- the regex no longer matches");
    assert.ok(read.size > 0, `found no process.env.LEMONSQUEEZY_* reads in ${BUNDLE} -- is it built?`);

    const missing = [...read].filter((n) => !granted.has(n)).sort();
    assert.deepEqual(
      missing,
      [],
      `these variables are read by ${BUNDLE} but not granted by the sandbox allow-list, ` +
        `so they read as UNSET under LEMONSQUEEZY_MCP_SANDBOX=1: ${missing.join(", ")}`,
    );
  });

  // The inverse direction is a lint, not a failure: granting a variable nothing
  // reads widens the sandbox for no benefit. Reported rather than asserted,
  // because a grant can legitimately land a release ahead of the code that uses
  // it.
  it("reports allow-list entries the bundle never reads", () => {
    const granted = grantedEnv();
    const read = bundleReadsEnv();
    const unused = [...granted].filter((n) => !read.has(n)).sort();
    if (unused.length > 0) {
      console.warn(`  note: granted but unread by ${BUNDLE}: ${unused.join(", ")}`);
    }
    assert.ok(true);
  });
});

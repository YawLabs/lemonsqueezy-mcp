#!/usr/bin/env node
// Fail `npm run test:integration` up front when its credentials are missing.
//
// src/integration/integration.test.ts runs only when LEMONSQUEEZY_TEST_API_KEY
// and LEMONSQUEEZY_TEST_STORE_ID are both set, and marks every suite `skip`
// otherwise so that `npm test` (whose dist/**/*.test.js glob picks up the same
// file) stays quiet without credentials. Through the dedicated script that
// skip is a trap: node:test reports each suite as SKIP, the summary reads
// "# tests 0 ... # fail 0 ... # skipped 0", and the run exits 0 -- a green
// result that exercised nothing, on the run CLAUDE.md requires before any
// release that touches src/api.ts or a tool handler.
//
// Why the check is a separate script:
//   * Not a root before() in the test file: when every suite is skipped,
//     node:test reports a throwing before() as SKIP (failureType hookFailed)
//     and still exits 0.
//   * Not an inline `VAR=1 node ...` flag in package.json: npm runs scripts
//     through cmd.exe on Windows (script-shell unset), which rejects that
//     syntax.
//
// Same rule as the test file: an empty value counts as unset.
//
// Wired in as the first command of `npm run test:integration`, before the
// build. `npm test` never runs it.

const REQUIRED = ["LEMONSQUEEZY_TEST_API_KEY", "LEMONSQUEEZY_TEST_STORE_ID"];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`test:integration: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set.`);
  console.error("Without both, the integration suite skips every test and the run would still exit 0.");
  console.error(`Set ${REQUIRED.join(" and ")} (see src/integration/integration.test.ts), then re-run.`);
  process.exit(1);
}

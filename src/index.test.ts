/**
 * Boot-path tests for the server entry point.
 *
 * `src/index.ts` cannot be imported the way every other module here is: at
 * import time it registers 64 tools and opens a stdio transport, so an
 * `import` would hang the test runner. These tests spawn the built entry
 * point as a child process instead and assert on its exit code and stderr.
 *
 * That makes them the only coverage for three operator-facing behaviours:
 * the `version` subcommand, the boot-time guardrail config parse, and the
 * deliberate absence of a stack trace when that parse fails.
 *
 * The subject is `dist/index.js` -- the esbuild bundle, i.e. the artifact
 * that actually ships -- resolved relative to this compiled test file.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ENTRY = fileURLToPath(new URL("./index.js", import.meta.url));
const { version: PKG_VERSION } = createRequire(import.meta.url)("../package.json") as { version: string };

type RunResult = { code: number; stdout: string; stderr: string };

/**
 * Run the entry point with a scrubbed environment. Every LEMONSQUEEZY_* var is
 * dropped first so a developer's real shell config (an API key command, a
 * store allowlist) cannot change what the child does; `overrides` then adds
 * back exactly what the case under test needs.
 */
async function runEntry(args: string[], overrides: Record<string, string> = {}): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("LEMONSQUEEZY_")) continue;
    if (v !== undefined) env[k] = v;
  }
  Object.assign(env, overrides);

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENTRY, ...args], {
      env,
      timeout: 20_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("entry point -- version subcommand", () => {
  it("`version` prints the package version and exits 0", async () => {
    const { code, stdout } = await runEntry(["version"]);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), PKG_VERSION);
  });

  it("`--version` behaves identically", async () => {
    const { code, stdout } = await runEntry(["--version"]);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), PKG_VERSION);
  });

  it("the version subcommand does not require any credentials", async () => {
    // It must short-circuit before the guardrail parse and before any key
    // load, so `npx @yawlabs/lemonsqueezy-mcp version` works on a bare
    // machine. The scrubbed env in runEntry already guarantees no key is set.
    const { code, stderr } = await runEntry(["version"]);
    assert.equal(code, 0);
    assert.doesNotMatch(stderr, /LEMONSQUEEZY_API_KEY/);
  });
});

describe("entry point -- boot-time guardrail config", () => {
  it("exits 1 on an unknown authority class", async () => {
    const { code, stderr } = await runEntry([], { LEMONSQUEEZY_DISABLE_CLASSES: "money,wat" });
    assert.equal(code, 1);
    assert.match(stderr, /unknown class/);
    assert.match(stderr, /"wat"/);
  });

  it("prints only the message, with no stack trace", async () => {
    // index.ts catches the parse error specifically so operators see the
    // actionable line instead of an uncaught-exception dump. A regression
    // that drops the try/catch still exits non-zero, so the exit code alone
    // would not catch it -- the absence of a trace is the assertion.
    const { stderr } = await runEntry([], { LEMONSQUEEZY_DISABLE_CLASSES: "nope" });
    assert.doesNotMatch(stderr, /^\s+at /m, `expected no stack frames, got:\n${stderr}`);
    assert.doesNotMatch(stderr, /Error:/);
    assert.ok(stderr.trim().split("\n").length <= 2, `expected a one-line diagnostic, got:\n${stderr}`);
  });

  it("exits 1 on a malformed per-class rate limit", async () => {
    const { code, stderr } = await runEntry([], { LEMONSQUEEZY_RATE_LIMIT_PER_CLASS: "money:5/d" });
    assert.equal(code, 1);
    assert.match(stderr, /invalid unit/);
  });

  it("exits 1 on a non-numeric refund cap", async () => {
    const { code, stderr } = await runEntry([], { LEMONSQUEEZY_MAX_REFUND_AMOUNT_CENTS: "lots" });
    assert.equal(code, 1);
    assert.match(stderr, /must be a non-negative number/);
  });

  it("a bad config fails fast even though no API key is set", async () => {
    // Config validation must precede credential loading: a typo'd class name
    // should surface as the class error, not as "API key required".
    const { code, stderr } = await runEntry([], { LEMONSQUEEZY_DISABLE_CLASSES: "bogus" });
    assert.equal(code, 1);
    assert.match(stderr, /unknown class/);
    assert.doesNotMatch(stderr, /LEMONSQUEEZY_API_KEY/);
  });
});

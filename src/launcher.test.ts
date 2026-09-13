/**
 * Runtime-selection tests for the npm `bin` launcher, bin/lemonsqueezy-mcp.mjs.
 *
 * The launcher is not importable: its module body resolves a runtime at import
 * time and either spawns oam or imports the server, so an `import` from a test
 * would launch a server. Making it importable would mean gating that body behind
 * an entry-point check -- a behaviour change to a shipped runtime artifact whose
 * failure mode (the guard reads false under an npm shim, and the launcher
 * silently does nothing) is worse than the gap this closes. So the decision is
 * tested by evaluating its real source text, and the wiring by running the real
 * bin as a child process, the same way index.test.ts covers the entry point.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Same import.meta.url hop as sandbox-env.test.ts: the compiled file sits in
// dist/, one level below the repo root, whatever the working directory is.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = resolve(repoRoot, "bin", "lemonsqueezy-mcp.mjs");
const PKG_VERSION = (JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8")) as { version: string })
  .version;

type Plan = "in-process" | "discover";
type RuntimePlan = (ctx: { mode: string; hostOam: string | undefined; sandbox: boolean }) => Plan;

/**
 * Evaluate the REAL `runtimePlan` source, together with the declarations it
 * closes over, without importing the launcher.
 *
 * Extracting the text exercises the shipped logic rather than a copy that can
 * drift, and a failed extraction is a loud assertion, not a silent skip. This is
 * the same idiom tailscale-mcp's launcher test uses.
 */
function loadRuntimePlan(): RuntimePlan {
  const source = readFileSync(LAUNCHER, "utf-8");
  const pieces = [
    /const OAM_MIN = \[[^\]]*\];/,
    /function parseVersion\(text\) \{[\s\S]*?\n\}/,
    /function atLeast\(v, min\) \{[\s\S]*?\n\}/,
    /function runtimePlan\(\{ mode, hostOam, sandbox \}\) \{[\s\S]*?\n\}/,
  ].map((pattern) => {
    const match = source.match(pattern);
    assert.ok(match, `could not extract ${pattern} from bin/lemonsqueezy-mcp.mjs -- renamed or reformatted?`);
    return match[0];
  });
  return new Function(`${pieces.join("\n")}\nreturn runtimePlan;`)() as RuntimePlan;
}

describe("launcher runtimePlan()", () => {
  const runtimePlan = loadRuntimePlan();

  it("serves in-process when already hosted on an oam at or above the floor", () => {
    // The bug this exists for: a host that launches `oam run bin/lemonsqueezy-mcp.mjs`
    // got a SECOND oam, because the launcher discovered and spawned one without
    // asking what it was already running on. `auto` and `oam` both have to take
    // the shortcut -- `oam` demands oam, and the host already is one.
    //
    // 0.9.0 pins the floor as inclusive (it IS the supported release), and
    // 0.10.0 pins a numeric compare: it sorts BEFORE 0.9.0 as a string, so a
    // compare over the raw text would spawn a nested oam on every 0.10+ host.
    for (const mode of ["auto", "oam"]) {
      for (const hostOam of ["0.9.0", "0.10.0", "0.15.1", "1.0.0", "0.16.0-dev"]) {
        assert.equal(runtimePlan({ mode, hostOam, sandbox: false }), "in-process", `mode=${mode} hostOam=${hostOam}`);
      }
    }
  });

  it("keeps spawning a fresh oam when the sandbox is requested, even on oam", () => {
    // `--permission` is a process-level flag: only a FRESH oam can apply it.
    // Serving in-process here would silently drop the sandbox the user asked
    // for -- a security downgrade that no other symptom would reveal.
    for (const mode of ["auto", "oam"]) {
      assert.equal(runtimePlan({ mode, hostOam: "0.15.1", sandbox: true }), "discover", `mode=${mode}`);
    }
  });

  it("leaves a host oam below the floor on the discovery path", () => {
    // Same floor as a discovered binary. Below it, behaviour is exactly what it
    // was before the shortcut existed.
    for (const mode of ["auto", "oam"]) {
      for (const hostOam of ["0.8.9", "0.8.2", "0.0.1"]) {
        assert.equal(runtimePlan({ mode, hostOam, sandbox: false }), "discover", `mode=${mode} hostOam=${hostOam}`);
      }
    }
  });

  it("discovers as before on Node, where process.versions has no oam key", () => {
    // An unreadable value must not count as "new enough" either: that would
    // skip discovery on a host that never proved it is a supported oam.
    for (const mode of ["auto", "oam"]) {
      for (const hostOam of [undefined, "", "dev"]) {
        assert.equal(runtimePlan({ mode, hostOam, sandbox: false }), "discover", `mode=${mode} hostOam=${hostOam}`);
      }
    }
  });

  it("runs LEMONSQUEEZY_MCP_RUNTIME=node in-process whatever the host is", () => {
    for (const hostOam of [undefined, "0.8.2", "0.15.1"]) {
      assert.equal(runtimePlan({ mode: "node", hostOam, sandbox: false }), "in-process", `hostOam=${hostOam}`);
    }
  });
});

type LauncherRun = { code: number; stdout: string; stderr: string };

/**
 * Run the REAL bin under Node, optionally posing as oam by preloading a
 * `process.versions.oam` key, and return what it wrote.
 *
 * The unit tests above prove the decision; these prove the launcher WIRES it --
 * that the call site actually reads `process.versions.oam` and the sandbox grant
 * list -- which no amount of testing `runtimePlan` in isolation can. A real oam
 * cannot be assumed on every box this suite runs on, and the preload changes
 * exactly the one fact the launcher branches on.
 *
 * OAM_BIN is pinned to the Node binary running this test, which makes the two
 * outcomes unmistakable without a real oam. In-process, `--version` reaches
 * dist/index.js and prints the package version with exit 0. On the discovery
 * path, findOam returns that pinned Node, `node --version` clears the floor, and
 * the launcher spawns `node [flags] run <entry>` -- which has no `run`
 * subcommand, prints no version and exits non-zero. It also keeps a real oam
 * installed on the developer's box out of reach, since findOam checks the
 * override first and never scans past it.
 *
 * Environment is scrubbed the same way index.test.ts scrubs it: every
 * LEMONSQUEEZY_* var is dropped so a developer's shell (a runtime choice, the
 * sandbox, a sink URL) cannot change what is being asserted, and `extraEnv`
 * adds back exactly what the case needs. The rest is kept rather than
 * whitelisted, because a Windows child stripped of SystemRoot and friends is a
 * different failure than the one under test.
 */
async function runLauncher(hostOam: string | undefined, extraEnv: Record<string, string> = {}): Promise<LauncherRun> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("LEMONSQUEEZY_") || k === "OAM_BIN") continue;
    if (v !== undefined) env[k] = v;
  }
  Object.assign(env, { OAM_BIN: process.execPath }, extraEnv);

  const preload =
    hostOam === undefined
      ? []
      : [
          "--import",
          `data:text/javascript,${encodeURIComponent(
            `Object.defineProperty(process.versions, "oam", { value: ${JSON.stringify(hostOam)}, enumerable: true });`,
          )}`,
        ];

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [...preload, LAUNCHER, "--version"], {
      env,
      // Each case boots one to three Node processes, and a bare Node start has
      // been measured at ~11s on a contended Windows box. Generous on purpose:
      // this turns a hang into a failure, it is not a performance budget.
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const servedInProcess = (run: LauncherRun) => run.code === 0 && run.stdout.trim() === PKG_VERSION;

describe("launcher on an oam host", () => {
  // No skip when dist/index.js is missing: this file only runs compiled, from
  // dist/, and `npm test` builds the bundle in the same step. A missing bundle
  // fails the in-process case loudly, with the import error in its message.

  it("control: on plain Node the launcher still discovers and spawns", async () => {
    // Without this, the in-process cases below would also pass for a launcher
    // that ALWAYS runs in-process and never uses oam at all.
    const run = await runLauncher(undefined);
    assert.equal(servedInProcess(run), false, `expected a spawn, got ${JSON.stringify(run)}`);
    assert.notEqual(run.code, 0);
  });

  it("serves in-process instead of spawning a nested oam", async () => {
    const envs: Record<string, string>[] = [{}, { LEMONSQUEEZY_MCP_RUNTIME: "oam" }];
    for (const extraEnv of envs) {
      const run = await runLauncher("0.15.1", extraEnv);
      assert.equal(servedInProcess(run), true, `${JSON.stringify(extraEnv)} -> ${JSON.stringify(run)}`);
    }
  });

  it("still spawns under LEMONSQUEEZY_MCP_SANDBOX=1, so --permission is not dropped", async () => {
    const run = await runLauncher("0.15.1", { LEMONSQUEEZY_MCP_SANDBOX: "1" });
    assert.equal(servedInProcess(run), false, `the sandbox must force a spawn, got ${JSON.stringify(run)}`);
    assert.notEqual(run.code, 0);
    // A spawned child failing, not the launcher diagnosing: every launcher
    // message starts with `lemonsqueezy-mcp: `.
    assert.doesNotMatch(run.stderr, /^lemonsqueezy-mcp: /m);
  });

  it("still discovers when the host oam is below the floor", async () => {
    const run = await runLauncher("0.8.9");
    assert.equal(servedInProcess(run), false, `a below-floor host must not shortcut, got ${JSON.stringify(run)}`);
    assert.notEqual(run.code, 0);
  });
});

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
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

type Plan = "in-process" | "discover" | "handoff-node";
type RuntimePlan = (ctx: { mode: string; hostOam: string | undefined; sandbox: boolean }) => Plan;
type Candidate = { path: string; version: number[] | null };
type PickNewest = (candidates: Candidate[]) => Candidate | null;

/**
 * Pull named declarations out of the launcher source, loudly.
 *
 * Extracting the text exercises the shipped logic rather than a copy that can
 * drift, and a failed extraction is a loud assertion, not a silent skip. This is
 * the same idiom tailscale-mcp's launcher test uses.
 */
function extract(patterns: RegExp[]): string {
  const source = readFileSync(LAUNCHER, "utf-8");
  return patterns
    .map((pattern) => {
      const match = source.match(pattern);
      assert.ok(match, `could not extract ${pattern} from bin/lemonsqueezy-mcp.mjs -- renamed or reformatted?`);
      return match[0];
    })
    .join("\n");
}

const OAM_MIN_DECL = /const OAM_MIN = \[[^\]]*\];/;
const ATLEAST_DECL = /function atLeast\(v, min\) \{[\s\S]*?\n\}/;

/** Evaluate the REAL `runtimePlan` source, with the declarations it closes over. */
function loadRuntimePlan(): RuntimePlan {
  const pieces = extract([
    OAM_MIN_DECL,
    /function parseVersion\(text\) \{[\s\S]*?\n\}/,
    ATLEAST_DECL,
    /function runtimePlan\(\{ mode, hostOam, sandbox \}\) \{[\s\S]*?\n\}/,
  ]);
  return new Function(`${pieces}\nreturn runtimePlan;`)() as RuntimePlan;
}

/** Evaluate the REAL `pickNewest` source, and expose the floor it holds candidates to. */
function loadPickNewest(): { pickNewest: PickNewest; floor: number[] } {
  const pieces = extract([OAM_MIN_DECL, ATLEAST_DECL, /function pickNewest\(candidates\) \{[\s\S]*?\n\}/]);
  return new Function(`${pieces}\nreturn { pickNewest, floor: OAM_MIN };`)() as {
    pickNewest: PickNewest;
    floor: number[];
  };
}

describe("launcher runtimePlan()", () => {
  const runtimePlan = loadRuntimePlan();

  it("serves in-process when already hosted on an oam at or above the floor", () => {
    // The bug this exists for: a host that launches `oam run bin/lemonsqueezy-mcp.mjs`
    // got a SECOND oam, because the launcher discovered and spawned one without
    // asking what it was already running on. `auto` and `oam` both have to take
    // the shortcut -- `oam` demands oam, and the host already is one.
    //
    // 0.15.2 pins the floor as inclusive (it IS the supported release), and
    // 0.100.0 pins a numeric compare: it sorts BEFORE 0.15.2 as a string, so a
    // compare over the raw text would treat a newer oam as too old.
    for (const mode of ["auto", "oam"]) {
      for (const hostOam of ["0.15.2", "0.16.0", "0.100.0", "1.0.0", "0.16.0-dev"]) {
        assert.equal(runtimePlan({ mode, hostOam, sandbox: false }), "in-process", `mode=${mode} hostOam=${hostOam}`);
      }
    }
  });

  it("keeps spawning a fresh oam when the sandbox is requested, even on a supported oam", () => {
    // `--permission` is a process-level flag: only a FRESH oam can apply it.
    // Serving in-process here would silently drop the sandbox the user asked
    // for -- a security downgrade that no other symptom would reveal.
    for (const mode of ["auto", "oam"]) {
      for (const hostOam of ["0.15.2", "1.0.0"]) {
        assert.equal(runtimePlan({ mode, hostOam, sandbox: true }), "discover", `mode=${mode} hostOam=${hostOam}`);
      }
    }
  });

  it("never serves in-process on a host oam below the floor", () => {
    // Below the floor the host must hand off. Serving there was the bug: an oam
    // older than 0.9.0 runs this server's key-command arguments through a shell,
    // and anything older than the latest release is not what the server is
    // verified on.
    for (const mode of ["auto", "oam"]) {
      for (const sandbox of [false, true]) {
        for (const hostOam of ["0.15.1", "0.9.0", "0.8.2", "0.0.1"]) {
          assert.equal(
            runtimePlan({ mode, hostOam, sandbox }),
            "discover",
            `mode=${mode} hostOam=${hostOam} sandbox=${sandbox}`,
          );
        }
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

  it("runs LEMONSQUEEZY_MCP_RUNTIME=node on Node: in-process on a Node host, handed off from any oam host", () => {
    for (const sandbox of [false, true]) {
      assert.equal(runtimePlan({ mode: "node", hostOam: undefined, sandbox }), "in-process", `sandbox=${sandbox}`);
      for (const hostOam of ["0.8.2", "0.15.2", "1.0.0", "dev"]) {
        assert.equal(
          runtimePlan({ mode: "node", hostOam, sandbox }),
          "handoff-node",
          `hostOam=${hostOam} sandbox=${sandbox}`,
        );
      }
    }
  });
});

describe("launcher pickNewest()", () => {
  const { pickNewest, floor } = loadPickNewest();
  const at = (path: string, version: number[] | null): Candidate => ({ path, version });

  it("pins the floor to the latest oam release", () => {
    assert.deepEqual(floor, [0, 15, 2]);
  });

  it("takes the newest usable oam, not the first one found", () => {
    // The bug: discovery stopped at the first binary that existed, so an older
    // copy in an earlier location (the installed dir is searched before PATH)
    // hid a newer one later.
    const chosen = pickNewest([at("installed", [0, 15, 2]), at("path-a", [0, 16, 0]), at("path-b", [0, 15, 9])]);
    assert.equal(chosen?.path, "path-a");
  });

  it("compares numerically and keeps search order on a tie", () => {
    assert.equal(pickNewest([at("a", [0, 16, 0]), at("b", [0, 100, 0])])?.path, "b");
    assert.equal(pickNewest([at("first", [0, 15, 2]), at("second", [0, 15, 2])])?.path, "first");
  });

  it("skips binaries below the floor or with no readable version", () => {
    assert.equal(pickNewest([at("old", [0, 9, 0]), at("broken", null), at("good", [0, 15, 2])])?.path, "good");
    assert.equal(pickNewest([at("old", [0, 15, 1]), at("broken", null)]), null);
    assert.equal(pickNewest([]), null);
  });
});

type LauncherRun = { code: number; stdout: string; stderr: string };

/** The scrubbed launcher environment; see runLauncher. */
function launcherEnv(extraEnv: Record<string, string>): Record<string, string> {
  const overrides = { OAM_BIN: process.execPath, ...extraEnv };
  const replaced = new Set(Object.keys(overrides).map((k) => k.toUpperCase()));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("LEMONSQUEEZY_") || replaced.has(k.toUpperCase())) continue;
    if (v !== undefined) env[k] = v;
  }
  return Object.assign(env, overrides);
}

/** The `--import` preload: exit marker, optional oam pose, then `extraPreload`; see runLauncher. */
function launcherPreload(hostOam: string | undefined, extraPreload: string): string[] {
  const exitMarker = `import { writeSync } from "node:fs"; process.on("exit", () => { try { writeSync(2, "LAUNCHER_ARGV1=" + process.argv[1] + "\\n"); } catch {} });`;
  const posing =
    hostOam === undefined
      ? ""
      : `Object.defineProperty(process.versions, "oam", { value: ${JSON.stringify(hostOam)}, enumerable: true });`;
  return ["--import", `data:text/javascript,${encodeURIComponent(`${exitMarker}${posing}${extraPreload}`)}`];
}

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
 * path, the pinned Node answers `--version` with v22.x, which clears the floor,
 * so it is chosen and the launcher spawns `node [flags] run <entry>` -- which
 * has no `run` subcommand, prints no version and exits non-zero. A usable
 * OAM_BIN is taken before discovery runs, so a real oam on the developer's box
 * is never reached either.
 *
 * Every run also reports, at exit, what the LAUNCHER process's argv[1] ended up
 * as. runInProcess points it at dist/index.js; a handoff leaves it on the
 * launcher. That is the only way to tell "served in-process" from "handed off
 * to a child that printed the same version".
 *
 * Environment is scrubbed the same way index.test.ts scrubs it: every
 * LEMONSQUEEZY_* var is dropped so a developer's shell (a runtime choice, the
 * sandbox, a sink URL) cannot change what is being asserted, and `extraEnv`
 * adds back exactly what the case needs, replacing any existing key that
 * differs only in case (Windows spells it `Path`). The rest is kept rather than
 * whitelisted, because a Windows child stripped of SystemRoot and friends is a
 * different failure than the one under test.
 *
 * `extraPreload` is appended to the preload module, for a case that has to
 * change how the launcher's own process behaves (a spawn that fails).
 */
async function runLauncher(
  hostOam: string | undefined,
  extraEnv: Record<string, string> = {},
  extraPreload = "",
): Promise<LauncherRun> {
  try {
    const args = [...launcherPreload(hostOam, extraPreload), LAUNCHER, "--version"];
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      env: launcherEnv(extraEnv),
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

type LiveRun = { code: number | null; stdout: string; stderr: string; answered: number[] };

/**
 * Run the REAL bin as a stdio MCP server (no `--version`) and prove it keeps
 * serving past a given point, which `--version` exits too quickly to show.
 *
 * `initialize` (id 1) is written the moment the launcher starts, the way an MCP
 * host writes it. Once it is answered AND `after` has matched stderr, `ping`
 * (id 2) is sent; once that is answered too, stdin is closed and the run ends
 * when the launcher exits. `answered` lists the ids that got a response. A
 * launcher that dies early simply never answers, so every outcome resolves --
 * the 60s guard only turns a genuine hang into a failure.
 */
function runLauncherLive(
  hostOam: string | undefined,
  extraEnv: Record<string, string>,
  extraPreload: string,
  after: RegExp,
): Promise<LiveRun> {
  const request = (id: number, method: string, params: object) =>
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [...launcherPreload(hostOam, extraPreload), LAUNCHER], {
      env: launcherEnv(extraEnv),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const answered: number[] = [];
    let pinged = false;
    const guard = setTimeout(() => child.kill(), 60_000);
    const step = () => {
      for (const id of [1, 2]) {
        if (!answered.includes(id) && new RegExp(`"id":${id}[,}]`).test(stdout)) answered.push(id);
      }
      if (!pinged && answered.includes(1) && after.test(stderr)) {
        pinged = true;
        child.stdin.write(request(2, "ping", {}));
      }
      if (answered.includes(2)) child.stdin.end();
    };
    // A launcher that has already exited closes its stdin; that EPIPE is the
    // failure being observed, not a harness error.
    child.stdin.on("error", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      step();
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      step();
    });
    child.on("close", (code) => {
      clearTimeout(guard);
      resolvePromise({ code, stdout, stderr, answered });
    });
    child.stdin.write(
      request(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "launcher-test", version: "0" },
      }),
    );
  });
}

const servedInProcess = (run: LauncherRun) =>
  run.code === 0 && run.stdout.trim() === PKG_VERSION && /LAUNCHER_ARGV1=.*dist[\\/]index\.js/.test(run.stderr);

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
      const run = await runLauncher("0.15.2", extraEnv);
      assert.equal(servedInProcess(run), true, `${JSON.stringify(extraEnv)} -> ${JSON.stringify(run)}`);
    }
  });

  it("still spawns under LEMONSQUEEZY_MCP_SANDBOX=1, so --permission is not dropped", async () => {
    const run = await runLauncher("0.15.2", { LEMONSQUEEZY_MCP_SANDBOX: "1" });
    assert.equal(servedInProcess(run), false, `the sandbox must force a spawn, got ${JSON.stringify(run)}`);
    assert.notEqual(run.code, 0);
    // A spawned child failing, not the launcher diagnosing: every launcher
    // message starts with `lemonsqueezy-mcp: `.
    assert.doesNotMatch(run.stderr, /^lemonsqueezy-mcp: /m);
  });

  it("still discovers when the host oam is below the floor", async () => {
    const run = await runLauncher("0.15.1");
    assert.equal(servedInProcess(run), false, `a below-floor host must not shortcut, got ${JSON.stringify(run)}`);
    assert.notEqual(run.code, 0);
    assert.doesNotMatch(run.stderr, /^lemonsqueezy-mcp: /m);
  });
});

describe("launcher with no usable oam", () => {
  /**
   * An environment with no oam anywhere: HOME and LOCALAPPDATA point at an
   * empty directory, so the installed locations are empty, and PATH holds only
   * the directory of the Node running this test. Keeps a real oam on the
   * developer's box out of reach.
   */
  function isolated(extra: Record<string, string> = {}): Record<string, string> {
    const empty = mkdtempSync(join(tmpdir(), "lemonsqueezy-mcp-launcher-home-"));
    return {
      PATH: dirname(process.execPath),
      USERPROFILE: empty,
      HOME: empty,
      LOCALAPPDATA: empty,
      OAM_BIN: join(tmpdir(), "no-such-dir", "oam.exe"),
      ...extra,
    };
  }

  it("names an OAM_BIN that does not exist instead of falling back silently", async () => {
    const run = await runLauncher(undefined, isolated());
    assert.equal(servedInProcess(run), true, JSON.stringify(run));
    assert.match(run.stderr, /^lemonsqueezy-mcp: OAM_BIN=.*does not exist; using Node instead\.$/m);
  });

  it("hands a below-floor oam host off to Node rather than serving on it", async () => {
    const run = await runLauncher("0.9.0", isolated());
    assert.equal(run.code, 0, JSON.stringify(run));
    assert.equal(run.stdout.trim(), PKG_VERSION, "the Node child must still serve");
    assert.match(
      run.stderr,
      /this process is oam 0\.9\.0, older than 0\.15\.2, and no newer oam was found; running on .*node/,
    );
    // Served by the child, not in the launcher process: argv[1] was never
    // pointed at dist/index.js.
    assert.match(run.stderr, /LAUNCHER_ARGV1=.*lemonsqueezy-mcp\.mjs/);
  });

  it("hands a below-floor oam host off to Node under the sandbox too", async () => {
    const run = await runLauncher("0.9.0", isolated({ LEMONSQUEEZY_MCP_SANDBOX: "1" }));
    assert.equal(run.code, 0, JSON.stringify(run));
    assert.equal(run.stdout.trim(), PKG_VERSION);
    assert.match(run.stderr, /LAUNCHER_ARGV1=.*lemonsqueezy-mcp\.mjs/);
  });

  it("refuses to serve on a below-floor oam host when there is no Node either", async () => {
    const noNode = mkdtempSync(join(tmpdir(), "lemonsqueezy-mcp-launcher-nopath-"));
    const run = await runLauncher("0.9.0", isolated({ PATH: noNode, OAM_BIN: join(noNode, "oam.exe") }));
    assert.equal(run.code, 1, JSON.stringify(run));
    assert.equal(run.stdout.trim(), "", "nothing may be served");
    assert.match(run.stderr, /no Node was found on PATH/);
  });

  it("hands LEMONSQUEEZY_MCP_RUNTIME=node off to Node even on a supported oam host", async () => {
    const run = await runLauncher("0.15.2", isolated({ LEMONSQUEEZY_MCP_RUNTIME: "node" }));
    assert.equal(run.code, 0, JSON.stringify(run));
    assert.equal(run.stdout.trim(), PKG_VERSION);
    assert.match(run.stderr, /LAUNCHER_ARGV1=.*lemonsqueezy-mcp\.mjs/);
  });

  it("serves a sandboxed supported oam host in-process, without --permission, when no fresh oam exists", async () => {
    // The sandbox is a preference for a fresh oam, not a guarantee of one: under
    // auto, a supported host with nothing to spawn still serves, as it always
    // has. The OAM_BIN note says why no fresh oam was used.
    const run = await runLauncher("0.15.2", isolated({ LEMONSQUEEZY_MCP_SANDBOX: "1" }));
    assert.equal(servedInProcess(run), true, JSON.stringify(run));
    assert.match(
      run.stderr,
      /^lemonsqueezy-mcp: OAM_BIN=.*does not exist; serving on this oam 0\.15\.2 without --permission\.$/m,
    );
  });

  it("exits instead under LEMONSQUEEZY_MCP_RUNTIME=oam when the sandbox has no fresh oam", async () => {
    const run = await runLauncher(
      "0.15.2",
      isolated({ LEMONSQUEEZY_MCP_SANDBOX: "1", LEMONSQUEEZY_MCP_RUNTIME: "oam" }),
    );
    assert.equal(run.code, 1, JSON.stringify(run));
    assert.equal(run.stdout.trim(), "", "nothing may be served");
    assert.match(run.stderr, /LEMONSQUEEZY_MCP_RUNTIME=oam but no usable oam \(0\.15\.2 or newer\) was found/);
  });

  /**
   * Preload that makes the launcher's FIRST spawn target a path that does not
   * exist, and lets every later spawn through. The chosen oam has already
   * passed its `--version` probe (that is execFileSync, not spawn), so this is
   * a binary deleted or replaced between the probe and the spawn.
   *
   * A failed spawn emits 'error' and then 'close' with the negative errno. On an
   * oam host the launcher pipes stdio and waits for 'close', so an unguarded
   * close handler process.exit()ed the launcher in the middle of the fallback
   * onLaunchFailed had just started.
   *
   * The failed child's 'close' is marked on stderr. This listener is attached
   * inside spawn(), before the launcher attaches its own, so the marker is
   * written before the launcher's handler runs: a launcher still answering
   * after the marker has survived that 'close'.
   */
  const FAILED_SPAWN_CLOSED = "FAILED_SPAWN_CLOSED";
  const failFirstSpawn = [
    'import childProcess from "node:child_process";',
    'import { syncBuiltinESMExports } from "node:module";',
    'import { writeSync as writeMarker } from "node:fs";',
    "const realSpawn = childProcess.spawn;",
    "let failed = false;",
    "childProcess.spawn = function (cmd, args, opts) {",
    "  if (failed) return realSpawn.call(this, cmd, args, opts);",
    "  failed = true;",
    '  const child = realSpawn.call(this, cmd + ".does-not-exist", args, opts);',
    `  child.on("close", () => writeMarker(2, ${JSON.stringify(FAILED_SPAWN_CLOSED)} + String.fromCharCode(10)));`,
    "  return child;",
    "};",
    "syncBuiltinESMExports();",
  ].join("\n");

  it("still falls back when the chosen oam fails to spawn on an oam host", async () => {
    // Below the floor: the fallback is a handoff to Node, which the failed
    // child's 'close' used to kill before it could serve.
    const run = await runLauncher("0.9.0", isolated({ OAM_BIN: process.execPath }), failFirstSpawn);
    assert.equal(run.code, 0, JSON.stringify(run));
    assert.equal(run.stdout.trim(), PKG_VERSION, "the Node fallback must still serve");
    assert.match(
      run.stderr,
      /^lemonsqueezy-mcp: failed to launch oam at .*; this process is oam 0\.9\.0, older than 0\.15\.2; running on .*node.* instead\.$/m,
    );
    // A newer oam WAS found -- it is the one that failed to launch.
    assert.doesNotMatch(run.stderr, /no newer oam was found/);
    assert.match(run.stderr, /LAUNCHER_ARGV1=.*lemonsqueezy-mcp\.mjs/);
  });

  it("keeps serving a sandboxed supported oam host in-process after the fresh oam fails to spawn", async () => {
    // At the floor with the sandbox on, the fallback is in-process on the host,
    // without --permission. `--version` cannot show this regression: it exits
    // before the failed child's 'close' arrives. A live server can -- the
    // failed child's 'close' used to exit the launcher with the negative errno
    // underneath the server it had just started.
    const run = await runLauncherLive(
      "0.15.2",
      isolated({ LEMONSQUEEZY_MCP_SANDBOX: "1", OAM_BIN: process.execPath }),
      failFirstSpawn,
      new RegExp(FAILED_SPAWN_CLOSED),
    );
    assert.deepEqual(
      run.answered,
      [1, 2],
      `must answer before AND after the failed child closes: ${JSON.stringify(run)}`,
    );
    assert.equal(run.code, 0, JSON.stringify(run));
    assert.match(run.stderr, /LAUNCHER_ARGV1=.*dist[\\/]index\.js/, "served in-process, not by a child");
    assert.match(
      run.stderr,
      /^lemonsqueezy-mcp: failed to launch oam at .*; serving on this oam 0\.15\.2 without --permission\.$/m,
    );
  });
});

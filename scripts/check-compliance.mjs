#!/usr/bin/env node
/**
 * Grade the built server with @yawlabs/mcp-compliance, the suite Yaw MCP grades
 * every upstream with (yaw-mcp `compliance` / `audit`, and the spawn gate behind
 * YAW_MCP_MIN_COMPLIANCE). The devDependency is pinned to the same version line
 * yaw-mcp depends on, so this run and yaw-mcp's grade use one rubric.
 *
 * It runs the published entry point, bin/lemonsqueezy-mcp.mjs, with
 * LEMONSQUEEZY_MCP_RUNTIME=node, against the dist/ bundle on disk -- so run it
 * after a build (release.sh calls it right after `npm test`, which builds).
 * Every LEMONSQUEEZY_* variable is scrubbed from the server's environment: the
 * suite calls tools, and with a real API key in the shell those calls would
 * reach a real store.
 *
 * Outcomes:
 *   exit 1   graded, and a required check failed or the grade is below
 *            LEMONSQUEEZY_MCP_MIN_COMPLIANCE (default A)
 *   exit 0   graded at or above it. Checks that measured nothing (skips) and
 *            the suite's own warnings are printed as WARNING lines, never
 *            folded silently into the pass.
 *   exit 0   NOT graded -- the suite is not installed, would not start, or
 *            printed no report -- with a WARNING that says so. A missing
 *            dependency or a broken suite should not block a release on its
 *            own, but it must never read as a pass.
 *            LEMONSQUEEZY_MCP_COMPLIANCE_STRICT=1 makes this exit 1 instead.
 *
 * Usage: node scripts/check-compliance.mjs
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUITE_DIR = join(REPO_ROOT, "node_modules", "@yawlabs", "mcp-compliance");
const LAUNCHER = join(REPO_ROOT, "bin", "lemonsqueezy-mcp.mjs");
const BUNDLE = join(REPO_ROOT, "dist", "index.js");
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const GRADES = ["A", "B", "C", "D", "F"];

/**
 * Decide what a parsed report means. Pure, so the test can drive it.
 * Returns { failures: string[], warnings: string[], summaryLine: string }.
 */
export function evaluate(report, minGrade = "A") {
  const failures = [];
  const warnings = [];
  const grade = typeof report?.grade === "string" ? report.grade : "?";
  const s = report?.summary ?? {};
  const summaryLine =
    `grade ${grade}, score ${report?.score ?? "?"}, spec ${report?.specVersion ?? "?"}: ` +
    `${s.passed ?? "?"}/${s.total ?? "?"} passed, ${s.failed ?? "?"} failed, ` +
    `required ${s.requiredPassed ?? "?"}/${s.required ?? "?"}, ${s.skipped ?? 0} skipped`;

  if (!GRADES.includes(grade)) {
    failures.push(`the report carries no letter grade (${JSON.stringify(report?.grade)})`);
  } else if (GRADES.indexOf(grade) > GRADES.indexOf(minGrade)) {
    failures.push(`grade ${grade} is below the required ${minGrade}`);
  }
  if (typeof s.required === "number" && typeof s.requiredPassed === "number" && s.requiredPassed < s.required) {
    failures.push(`${s.required - s.requiredPassed} required check(s) failed`);
  }
  for (const t of Array.isArray(report?.tests) ? report.tests : []) {
    if (t && t.passed === false) {
      (t.required ? failures : warnings).push(`${t.required ? "required" : "optional"} ${t.id} failed: ${t.details}`);
    }
  }
  const skipped = (Array.isArray(report?.tests) ? report.tests : []).filter((t) => t?.skipped);
  if (skipped.length > 0) {
    warnings.push(`${skipped.length} check(s) measured nothing (skipped): ${skipped.map((t) => t.id).join(", ")}`);
  }
  if (s.total === 0 || (typeof s.skipped === "number" && s.skipped === s.total)) {
    failures.push("no check measured anything");
  }
  for (const w of Array.isArray(report?.warnings) ? report.warnings : []) warnings.push(`suite: ${w}`);
  return { failures, warnings, summaryLine };
}

function suiteBin() {
  try {
    const pkg = JSON.parse(readFileSync(join(SUITE_DIR, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["mcp-compliance"];
    return typeof bin === "string" ? { script: join(SUITE_DIR, bin), version: pkg.version } : null;
  } catch {
    return null;
  }
}

/** Not graded: say so loudly, and fail only under STRICT. */
function notGraded(reason) {
  console.error(`WARNING: mcp-compliance did NOT grade this server: ${reason}`);
  if (process.env.LEMONSQUEEZY_MCP_COMPLIANCE_STRICT === "1") {
    console.error("  LEMONSQUEEZY_MCP_COMPLIANCE_STRICT=1 is set -- failing.");
    process.exit(1);
  }
  console.error("  Continuing. Set LEMONSQUEEZY_MCP_COMPLIANCE_STRICT=1 to make this a failure.");
  process.exit(0);
}

function runSuite(script) {
  // The server's environment: this one, minus every LEMONSQUEEZY_* (see the
  // header), plus the runtime pin. The suite passes its own env to the target.
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.toUpperCase().startsWith("LEMONSQUEEZY_") && v !== undefined) env[k] = v;
  }
  env.LEMONSQUEEZY_MCP_RUNTIME = "node";
  const args = [script, "test", "--format", "json", "--", process.execPath, LAUNCHER];
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(process.execPath, args, { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolvePromise({ error: err });
      return;
    }
    const guard = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (d) => {
      stdout += d;
    });
    child.stderr.setEncoding("utf8").on("data", (d) => {
      stderr += d;
    });
    child.on("error", (error) => {
      clearTimeout(guard);
      resolvePromise({ error });
    });
    child.on("close", (code, signal) => {
      clearTimeout(guard);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

async function main() {
  const minGrade = (process.env.LEMONSQUEEZY_MCP_MIN_COMPLIANCE ?? "A").toUpperCase();
  if (!GRADES.includes(minGrade)) {
    console.error(`LEMONSQUEEZY_MCP_MIN_COMPLIANCE=${minGrade} is not one of ${GRADES.join(", ")}`);
    process.exit(1);
  }
  if (!existsSync(BUNDLE)) notGraded(`${BUNDLE} does not exist -- run npm run build first`);
  const suite = suiteBin();
  if (!suite || !existsSync(suite.script)) {
    notGraded("@yawlabs/mcp-compliance is not installed in node_modules (run npm ci)");
  }

  console.log(`mcp-compliance ${suite.version}: grading bin/lemonsqueezy-mcp.mjs on Node (min grade ${minGrade})`);
  const run = await runSuite(suite.script);
  if (run.error) notGraded(`the suite would not start (${run.error.message ?? run.error})`);

  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    const tail = run.stderr.trim().split("\n").slice(-5).join("\n  ");
    notGraded(`no JSON report (exit ${run.code ?? run.signal})${tail ? `; stderr ends:\n  ${tail}` : ""}`);
  }

  const { failures, warnings, summaryLine } = evaluate(report, minGrade);
  console.log(`  ${summaryLine}`);
  for (const w of warnings) console.error(`WARNING: ${w}`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    process.exit(1);
  }
  console.log("  compliance gate passed");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

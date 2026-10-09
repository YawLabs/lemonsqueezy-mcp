import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Same one-level hop as src/oam-floor.test.ts: the subject lives in scripts/,
// which tsconfig does not include, so it is imported at run time by URL.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = pathToFileURL(join(repoRoot, "scripts", "check-compliance.mjs")).href;

type Verdict = { failures: string[]; warnings: string[]; summaryLine: string };
type Evaluate = (report: unknown, minGrade?: string) => Verdict;

async function loadEvaluate(): Promise<Evaluate> {
  return ((await import(GATE)) as { evaluate: Evaluate }).evaluate;
}

const test = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  required: false,
  passed: true,
  details: "ok",
  ...over,
});

function report(over: Record<string, unknown> = {}) {
  return {
    grade: "A",
    score: 98,
    specVersion: "2025-11-25",
    summary: { total: 3, passed: 3, failed: 0, required: 1, requiredPassed: 1, skipped: 0 },
    tests: [test("lifecycle-init", { required: true }), test("tools-list"), test("resources-read")],
    warnings: [],
    ...over,
  };
}

describe("check-compliance evaluate()", () => {
  it("passes a clean A", async () => {
    const evaluate = await loadEvaluate();
    const v = evaluate(report());
    assert.deepEqual(v.failures, []);
    assert.deepEqual(v.warnings, []);
    assert.match(v.summaryLine, /^grade A, score 98/);
  });

  it("fails a grade below the minimum", async () => {
    const evaluate = await loadEvaluate();
    assert.match(evaluate(report({ grade: "B" })).failures.join("\n"), /grade B is below the required A/);
    assert.deepEqual(evaluate(report({ grade: "B" }), "B").failures, []);
  });

  it("fails a failed required check even at grade A", async () => {
    const evaluate = await loadEvaluate();
    const v = evaluate(
      report({
        summary: { total: 3, passed: 2, failed: 1, required: 1, requiredPassed: 0, skipped: 0 },
        tests: [test("lifecycle-init", { required: true, passed: false, details: "no answer" })],
      }),
    );
    assert.match(v.failures.join("\n"), /required lifecycle-init failed: no answer/);
    assert.match(v.failures.join("\n"), /1 required check\(s\) failed/);
  });

  it("warns, never silently passes, on skips and optional failures", async () => {
    // A skip measured nothing; it must be visible, not folded into the pass.
    const evaluate = await loadEvaluate();
    const v = evaluate(
      report({
        summary: { total: 3, passed: 2, failed: 1, required: 1, requiredPassed: 1, skipped: 1 },
        tests: [
          test("lifecycle-init", { required: true }),
          test("lifecycle-logging", { skipped: true }),
          test("resources-read", { passed: false, details: "missing text" }),
        ],
        warnings: ["auto-detected"],
      }),
    );
    assert.deepEqual(v.failures, []);
    assert.match(v.warnings.join("\n"), /1 check\(s\) measured nothing \(skipped\): lifecycle-logging/);
    assert.match(v.warnings.join("\n"), /optional resources-read failed: missing text/);
    assert.match(v.warnings.join("\n"), /suite: auto-detected/);
  });

  it("fails a run in which nothing was measured, or with no grade", async () => {
    const evaluate = await loadEvaluate();
    const allSkipped = evaluate(
      report({ summary: { total: 2, passed: 2, failed: 0, required: 0, requiredPassed: 0, skipped: 2 } }),
    );
    assert.match(allSkipped.failures.join("\n"), /no check measured anything/);
    assert.match(evaluate(report({ grade: undefined })).failures.join("\n"), /no letter grade/);
  });
});

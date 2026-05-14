import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { _resetApiKeyCacheForTest, invalidateApiKeyCache, loadApiKey } from "./secret.js";

const ENV_KEYS = ["LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_API_KEY_COMMAND", "LEMONSQUEEZY_TEST_API_KEY"] as const;

type WriteFn = typeof process.stderr.write;

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr) as WriteFn;
  const override = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as WriteFn;
  process.stderr.write = override;
  return {
    lines,
    restore: () => {
      process.stderr.write = original;
    },
  };
}

function saveEnv() {
  const snapshot: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snapshot[k] = process.env[k];
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

const isWindows = process.platform === "win32";

function writeScript(content: string, ext: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-mcp-secret-"));
  const file = path.join(dir, `script${ext}`);
  fs.writeFileSync(file, content);
  if (!isWindows) fs.chmodSync(file, 0o755);
  return file;
}

function writeJsScript(content: string): string {
  return writeScript(content, ".js");
}

describe("loadApiKey", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    _resetApiKeyCacheForTest();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    _resetApiKeyCacheForTest();
  });

  it("reads from LEMONSQUEEZY_API_KEY when set", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "sk_live_abc";
    const key = await loadApiKey();
    assert.equal(key, "sk_live_abc");
  });

  it("throws when neither var is set", async () => {
    await assert.rejects(loadApiKey(), /LEMONSQUEEZY_API_KEY.*required/);
  });

  it("throws when LEMONSQUEEZY_API_KEY is whitespace", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "   ";
    await assert.rejects(loadApiKey(), /empty/);
  });

  it("prefers LEMONSQUEEZY_API_KEY_COMMAND over raw key", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "raw_key";
    const scriptPath = writeJsScript("console.log('cmd_key');");
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    const key = await loadApiKey();
    assert.equal(key, "cmd_key");
  });

  it("caches command output", async () => {
    const counterDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-mcp-secret-"));
    const counterFile = path.join(counterDir, "count");
    fs.writeFileSync(counterFile, "0");
    const escapedCounter = counterFile.replace(/\\/g, "\\\\");
    const scriptPath = writeJsScript(
      `const fs=require('fs');const p='${escapedCounter}';const n=parseInt(fs.readFileSync(p,'utf8'))+1;fs.writeFileSync(p,String(n));console.log('key_'+n);`,
    );
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = `"${process.execPath}" "${scriptPath}"`;

    const k1 = await loadApiKey();
    const k2 = await loadApiKey();
    assert.equal(k1, "key_1");
    assert.equal(k2, "key_1");
    assert.equal(fs.readFileSync(counterFile, "utf8"), "1");
  });

  it("rejects empty command output", async () => {
    const scriptPath = writeJsScript("");
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    await assert.rejects(loadApiKey(), /empty output/);
  });

  it("reports command failure clearly", async () => {
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = "this-command-definitely-does-not-exist-xyz123";
    await assert.rejects(loadApiKey(), /LEMONSQUEEZY_API_KEY_COMMAND failed/);
  });

  it("treats empty command env var as absent", async () => {
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = "   ";
    process.env.LEMONSQUEEZY_API_KEY = "fallback_key";
    const key = await loadApiKey();
    assert.equal(key, "fallback_key");
  });

  it("re-runs the command when LEMONSQUEEZY_API_KEY_COMMAND changes mid-process", async () => {
    const counterDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-mcp-secret-"));
    const counterFile = path.join(counterDir, "count");
    fs.writeFileSync(counterFile, "0");
    const escapedCounter = counterFile.replace(/\\/g, "\\\\");

    const scriptA = writeJsScript(
      `const fs=require('fs');const p='${escapedCounter}';const n=parseInt(fs.readFileSync(p,'utf8'))+1;fs.writeFileSync(p,String(n));console.log('A_'+n);`,
    );
    const scriptB = writeJsScript(
      `const fs=require('fs');const p='${escapedCounter}';const n=parseInt(fs.readFileSync(p,'utf8'))+1;fs.writeFileSync(p,String(n));console.log('B_'+n);`,
    );

    process.env.LEMONSQUEEZY_API_KEY_COMMAND = `"${process.execPath}" "${scriptA}"`;
    const k1 = await loadApiKey();
    assert.equal(k1, "A_1");

    // Switch to a different command -- fingerprint mismatch must invalidate
    // the cached A_1 entry; otherwise we'd keep returning the stale value.
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = `"${process.execPath}" "${scriptB}"`;
    const k2 = await loadApiKey();
    assert.equal(k2, "B_2");
  });

  it("re-reads env when LEMONSQUEEZY_API_KEY changes mid-process", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "first_key";
    const k1 = await loadApiKey();
    assert.equal(k1, "first_key");

    process.env.LEMONSQUEEZY_API_KEY = "rotated_key";
    const k2 = await loadApiKey();
    assert.equal(k2, "rotated_key");
  });

  it("invalidateApiKeyCache forces a re-read on the next call", async () => {
    const counterDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-mcp-secret-"));
    const counterFile = path.join(counterDir, "count");
    fs.writeFileSync(counterFile, "0");
    const escapedCounter = counterFile.replace(/\\/g, "\\\\");
    const scriptPath = writeJsScript(
      `const fs=require('fs');const p='${escapedCounter}';const n=parseInt(fs.readFileSync(p,'utf8'))+1;fs.writeFileSync(p,String(n));console.log('key_'+n);`,
    );
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = `"${process.execPath}" "${scriptPath}"`;

    const k1 = await loadApiKey();
    assert.equal(k1, "key_1");

    invalidateApiKeyCache();
    const k2 = await loadApiKey();
    assert.equal(k2, "key_2");
    assert.equal(fs.readFileSync(counterFile, "utf8"), "2");
  });

  it("reads from LEMONSQUEEZY_TEST_API_KEY when set alone", async () => {
    process.env.LEMONSQUEEZY_TEST_API_KEY = "sk_test_xyz";
    const cap = captureStderr();
    try {
      const key = await loadApiKey();
      assert.equal(key, "sk_test_xyz");
    } finally {
      cap.restore();
    }
  });

  it("prefers LEMONSQUEEZY_TEST_API_KEY over LEMONSQUEEZY_API_KEY when both are set", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "prod_key";
    process.env.LEMONSQUEEZY_TEST_API_KEY = "test_key";
    const cap = captureStderr();
    try {
      const key = await loadApiKey();
      assert.equal(key, "test_key");
    } finally {
      cap.restore();
    }
  });

  it("LEMONSQUEEZY_API_KEY_COMMAND still wins over the test key when all three are set", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "prod_key";
    process.env.LEMONSQUEEZY_TEST_API_KEY = "test_key";
    const scriptPath = writeJsScript("console.log('cmd_key');");
    process.env.LEMONSQUEEZY_API_KEY_COMMAND = `"${process.execPath}" "${scriptPath}"`;
    const cap = captureStderr();
    try {
      const key = await loadApiKey();
      assert.equal(key, "cmd_key");
      // No test_mode notice should be printed when the command path wins.
      const testModeLines = cap.lines.filter((l) => l.includes('"event":"test_mode"'));
      assert.equal(testModeLines.length, 0);
    } finally {
      cap.restore();
    }
  });

  it("treats a whitespace-only LEMONSQUEEZY_TEST_API_KEY as unset", async () => {
    process.env.LEMONSQUEEZY_TEST_API_KEY = "   ";
    process.env.LEMONSQUEEZY_API_KEY = "prod_fallback";
    const cap = captureStderr();
    try {
      const key = await loadApiKey();
      assert.equal(key, "prod_fallback");
      // No test_mode notice should fire when test key is whitespace.
      const testModeLines = cap.lines.filter((l) => l.includes('"event":"test_mode"'));
      assert.equal(testModeLines.length, 0);
    } finally {
      cap.restore();
    }
  });

  it("invalidates the cache when switching from test key to prod key mid-process", async () => {
    process.env.LEMONSQUEEZY_TEST_API_KEY = "test_key";
    const cap = captureStderr();
    try {
      const k1 = await loadApiKey();
      assert.equal(k1, "test_key");

      // Drop the test var entirely; fingerprint flips from test: to env:.
      delete process.env.LEMONSQUEEZY_TEST_API_KEY;
      process.env.LEMONSQUEEZY_API_KEY = "prod_key";
      const k2 = await loadApiKey();
      assert.equal(k2, "prod_key");
    } finally {
      cap.restore();
    }
  });

  it("invalidateApiKeyCache works in test mode", async () => {
    process.env.LEMONSQUEEZY_TEST_API_KEY = "test_initial";
    const cap = captureStderr();
    try {
      const k1 = await loadApiKey();
      assert.equal(k1, "test_initial");

      // Rotate the test key value upstream; invalidate -> next call re-reads.
      process.env.LEMONSQUEEZY_TEST_API_KEY = "test_rotated";
      invalidateApiKeyCache();
      const k2 = await loadApiKey();
      assert.equal(k2, "test_rotated");
    } finally {
      cap.restore();
    }
  });

  it("prints the test_mode notice to stderr exactly once per process", async () => {
    process.env.LEMONSQUEEZY_TEST_API_KEY = "test_key";
    const cap = captureStderr();
    try {
      await loadApiKey();
      await loadApiKey();
      invalidateApiKeyCache();
      await loadApiKey();

      const testModeLines = cap.lines.filter((l) => l.includes('"event":"test_mode"'));
      assert.equal(testModeLines.length, 1, "test_mode notice must be emitted exactly once");
      const parsed = JSON.parse((testModeLines[0] ?? "").trim());
      assert.equal(parsed.event, "test_mode");
      assert.equal(parsed.message, "Using LEMONSQUEEZY_TEST_API_KEY (test mode)");
      assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok((testModeLines[0] ?? "").endsWith("\n"));
    } finally {
      cap.restore();
    }
  });

  it("does not print the test_mode notice in prod mode", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "prod_key";
    const cap = captureStderr();
    try {
      await loadApiKey();
      await loadApiKey();
      const testModeLines = cap.lines.filter((l) => l.includes('"event":"test_mode"'));
      assert.equal(testModeLines.length, 0);
    } finally {
      cap.restore();
    }
  });
});

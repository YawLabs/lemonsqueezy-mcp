import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { _resetApiKeyCacheForTest, invalidateApiKeyCache, loadApiKey } from "./secret.js";

const ENV_KEYS = ["LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_API_KEY_COMMAND"] as const;

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
});

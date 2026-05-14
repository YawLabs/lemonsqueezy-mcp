import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 60 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_MAX_BUFFER = 64 * 1024;

// The cache fingerprint encodes both the source mode (cmd vs test vs env) and
// the raw source value. If LEMONSQUEEZY_API_KEY_COMMAND, LEMONSQUEEZY_TEST_API_KEY,
// or LEMONSQUEEZY_API_KEY changes mid-process, the fingerprint changes too and
// the next loadApiKey() call refreshes from the new source instead of returning
// a stale entry. Also lets `invalidateApiKeyCache()` (called from api.ts on
// 401/403) behave uniformly across all three source modes.
type CachedKey = { fingerprint: string; key: string; expiresAt: number };

let cached: CachedKey | null = null;

// Module-level flag: print the "test mode" notice exactly once per process,
// the first time LEMONSQUEEZY_TEST_API_KEY is selected as the active source.
// Survives cache hits -- the flag is set on the first selection and never
// re-printed even if the test key is later re-loaded after invalidation.
let testModeAnnounced = false;

function announceTestModeOnce(): void {
  if (testModeAnnounced) return;
  testModeAnnounced = true;
  const line = `${JSON.stringify({
    ts: new Date().toISOString(),
    event: "test_mode",
    message: "Using LEMONSQUEEZY_TEST_API_KEY (test mode)",
  })}\n`;
  process.stderr.write(line);
}

// Minimal shell-style tokenizer: bare words, single-quoted, and double-quoted
// strings, split on whitespace. No backslash escapes inside quotes, no shell
// expansion ($vars, backticks, globs), no command substitution. Kept narrow
// so this file stays dependency-free and the package ships with zero runtime
// deps. Covers typical vault-CLI invocations (`vault read -field=key path`,
// `op item get --fields password`).
function parseCommand(cmd: string): { command: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (quote) throw new Error("LEMONSQUEEZY_API_KEY_COMMAND has an unterminated quote");
  if (current) parts.push(current);
  if (parts.length === 0) throw new Error("LEMONSQUEEZY_API_KEY_COMMAND is empty");
  return { command: parts[0] as string, args: parts.slice(1) };
}

function fromCache(fingerprint: string): string | null {
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
    return cached.key;
  }
  return null;
}

function intoCache(fingerprint: string, key: string): void {
  cached = { fingerprint, key, expiresAt: Date.now() + CACHE_TTL_MS };
}

export async function loadApiKey(): Promise<string> {
  const cmdStr = process.env.LEMONSQUEEZY_API_KEY_COMMAND;

  if (cmdStr && cmdStr.trim() !== "") {
    const fingerprint = `cmd:${cmdStr}`;
    const hit = fromCache(fingerprint);
    if (hit !== null) return hit;

    const { command, args } = parseCommand(cmdStr);
    let stdout: string;
    try {
      const result = await execFileAsync(command, args, {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER,
      });
      stdout = result.stdout;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`LEMONSQUEEZY_API_KEY_COMMAND failed: ${msg}`);
    }
    const key = stdout.trim();
    if (!key) throw new Error("LEMONSQUEEZY_API_KEY_COMMAND produced empty output");
    intoCache(fingerprint, key);
    return key;
  }

  // Test key takes precedence over the prod key when both are set. Empty /
  // whitespace-only values are treated as absent, matching the existing
  // LEMONSQUEEZY_API_KEY handling, so a developer can leave the var defined
  // but blank to disable test mode without unsetting it.
  const testRaw = process.env.LEMONSQUEEZY_TEST_API_KEY;
  if (testRaw && testRaw.trim() !== "") {
    const fingerprint = `test:${testRaw}`;
    const hit = fromCache(fingerprint);
    if (hit !== null) {
      // Cache hit -- but if this is the first time the test source is being
      // returned in this process (e.g. announcement was suppressed earlier
      // somehow), still ensure the notice fires once. In practice the
      // announce happens on the first miss below and this branch is a no-op
      // because the flag is already set, but we guard it for safety.
      announceTestModeOnce();
      return hit;
    }
    announceTestModeOnce();
    intoCache(fingerprint, testRaw);
    return testRaw;
  }

  const raw = process.env.LEMONSQUEEZY_API_KEY;
  if (!raw) {
    throw new Error("LEMONSQUEEZY_API_KEY or LEMONSQUEEZY_API_KEY_COMMAND environment variable is required.");
  }
  if (raw.trim() === "") {
    throw new Error("LEMONSQUEEZY_API_KEY is set but empty. Provide a valid API key.");
  }

  // Env reads are free, but we still cache for parity with the command
  // path: the fingerprint check picks up a mid-process env mutation
  // automatically, and invalidateApiKeyCache() works the same way for
  // both modes (clears any stale entry; next call re-reads the env).
  const fingerprint = `env:${raw}`;
  const hit = fromCache(fingerprint);
  if (hit !== null) return hit;
  intoCache(fingerprint, raw);
  return raw;
}

/**
 * Drop the cached API key. Called by the API client on 401/403 so a key
 * rotated upstream takes effect on the next request without waiting for
 * the 1h TTL. Safe to call when no entry is cached -- no-op.
 */
export function invalidateApiKeyCache(): void {
  cached = null;
}

export function _resetApiKeyCacheForTest(): void {
  cached = null;
  testModeAnnounced = false;
}

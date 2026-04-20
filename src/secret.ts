import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 60 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_MAX_BUFFER = 64 * 1024;

let cached: { key: string; expiresAt: number } | null = null;

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

export async function loadApiKey(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const cmdStr = process.env.LEMONSQUEEZY_API_KEY_COMMAND;
  if (cmdStr && cmdStr.trim() !== "") {
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
    cached = { key, expiresAt: Date.now() + CACHE_TTL_MS };
    return key;
  }

  const key = process.env.LEMONSQUEEZY_API_KEY;
  if (!key) {
    throw new Error("LEMONSQUEEZY_API_KEY or LEMONSQUEEZY_API_KEY_COMMAND environment variable is required.");
  }
  if (key.trim() === "") {
    throw new Error("LEMONSQUEEZY_API_KEY is set but empty. Provide a valid API key.");
  }
  return key;
}

export function _resetApiKeyCacheForTest(): void {
  cached = null;
}

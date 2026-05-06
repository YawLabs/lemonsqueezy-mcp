export type LogEntry = {
  event: "tool_call" | "http_call";
  tool?: string;
  method?: string;
  path?: string;
  status?: number | string;
  latency_ms?: number;
  request_id?: string;
  error?: string;
  audit?: boolean;
  inputs?: unknown;
};

type LogLevel = "off" | "error" | "audit" | "all";

// Backwards compatibility: `LEMONSQUEEZY_LOG=json` (the original switch)
// still means "log everything" so existing deployments don't change behavior.
// New values let long-running deployments trim volume:
//   - `error`: only entries that represent a failure (4xx/5xx, timeout,
//             network error, exception, guardrail block, or any entry with
//             a populated `error` field).
//   - `audit`: errors plus destructive-call audit entries (`audit: true`).
//             Recommended for production where you must keep an audit trail
//             but don't need every successful read in your log pipeline.
//   - `all` / `json`: emit every entry. Useful for debugging.
//   - unset / any other value: no logs at all.
function getLogLevel(): LogLevel {
  const v = process.env.LEMONSQUEEZY_LOG;
  if (v === "json" || v === "all") return "all";
  if (v === "audit") return "audit";
  if (v === "error") return "error";
  return "off";
}

const ERROR_STATUS_TAGS = new Set(["error", "exception", "guardrail_block", "timeout", "network_error"]);

function isErrorEntry(entry: LogEntry): boolean {
  if (entry.error !== undefined) return true;
  if (typeof entry.status === "string") return ERROR_STATUS_TAGS.has(entry.status);
  if (typeof entry.status === "number") return entry.status >= 400;
  return false;
}

function shouldLog(entry: LogEntry, level: LogLevel): boolean {
  switch (level) {
    case "off":
      return false;
    case "all":
      return true;
    case "audit":
      return entry.audit === true || isErrorEntry(entry);
    case "error":
      return isErrorEntry(entry);
  }
}

export function logEvent(entry: LogEntry): void {
  const level = getLogLevel();
  if (!shouldLog(entry, level)) return;
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    process.stderr.write(`${line}\n`);
    return;
  } catch {
    // Inputs (the only `unknown`-typed field) likely contained a circular ref
    // or BigInt; emit a degraded entry that omits inputs so destructive calls
    // still produce an audit trail.
  }
  try {
    const fallback = JSON.stringify({
      ts: new Date().toISOString(),
      event: entry.event,
      tool: entry.tool,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      latency_ms: entry.latency_ms,
      request_id: entry.request_id,
      audit: entry.audit,
      error: entry.error,
      log_error: "inputs_not_serializable",
    });
    process.stderr.write(`${fallback}\n`);
  } catch {
    // Never let logging kill a request.
  }
}

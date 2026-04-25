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

function isEnabled(): boolean {
  return process.env.LEMONSQUEEZY_LOG === "json";
}

export function logEvent(entry: LogEntry): void {
  if (!isEnabled()) return;
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
